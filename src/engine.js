// engine.js (rewrite v2)
// Owns game state, parses and runs actions, including battle.
// Stats start at 0 and remain 0 until (stats) is executed.
(() => {
  "use strict";

  const LOG = "ENGINE";
  const __log = (window.HeroLog && window.HeroLog.make) ? window.HeroLog.make(LOG) : null;
  function logInfo(...args){ if (__log) __log.info(...args); else console.log("[" + LOG + "]", ...args); }
  function logWarn(...args){ if (__log) __log.warn(...args); else console.warn("[" + LOG + "]", ...args); }

  const STORAGE_KEY = "hero_save_v1";

  const ASSET_BASE = (() => {
    try{
      if (window.HERO_ASSET_BASE) {
        const base = String(window.HERO_ASSET_BASE);
        return base.endsWith("/") ? base : base + "/";
      }
    }catch(_){ }
    return "./assets/";
  })();
  const STATS_META_URL = ASSET_BASE + "Stats.json";
  const ITEMS_URL = ASSET_BASE + "Items.json";
  const MENU_URL = ASSET_BASE + "Menu.json";

  // Magic tab: fixed number of spell slots
  const SPELLBOOK_SLOTS = 6;

  const TALE_BASE = ASSET_BASE + "Img/"; // folder where 000.webp, blank.webp, tale*.webp live

  // Cache-bust version for tale frames (and other image assets loaded by engine).
  // Priority:
  // 1) window.HERO_ASSET_VER (optional global set by index)
  // 2) ?v=... from the engine.js script tag (e.g. engine.js?v=fix30)
  // 3) Date.now() (stable per page load)
  const ENGINE_ASSET_VER = (() => {
    try{
      if (window.HERO_ASSET_VER != null) return String(window.HERO_ASSET_VER);
    }catch(_){ }

    try{
      const ss = document.getElementsByTagName("script");
      for (let i = 0; i < ss.length; i++){
        const src = ss[i] && ss[i].src ? String(ss[i].src) : "";
        if (!src) continue;
        if (!src.includes("engine.js")) continue;
        try{
          const u = new URL(src, window.location.href);
          const v = u.searchParams.get("v");
          if (v) return String(v);
        }catch(_){}
      }
    }catch(_){}

    return String(Date.now());
  })();


  // Keep filenames exactly as on disk (including spaces), but URL-encode them for src.
  function taleUrl(fileName){
    const fn = String(fileName || "");
    // Encode spaces and non-ascii safely (do not encode the folder slash).
    return TALE_BASE + encodeURIComponent(fn).replace(/%2F/g, "/") + "?v=" + encodeURIComponent(ENGINE_ASSET_VER);
  }

  const TALE = Object.freeze({
    f1:  taleUrl("tale1.webp"),
    f2:  taleUrl("tale2.webp"),
    f3:  taleUrl("tale3.webp"),
    f4:  taleUrl("tale4.webp"),
    f5:  taleUrl("tale5.webp"),
    f6a: taleUrl("tale6_a.webp"), // hero takes damage
    f6b: taleUrl("tale6_b.webp"), // enemy takes damage
    f7:  taleUrl("tale7.webp"),
    f8:  taleUrl("tale8.webp"),
  f8a: taleUrl("tale8_a.webp"), // hero died (end screen)
    f8b: taleUrl("tale8_b.webp"), // all enemies defeated (end screen)
  });

  function setBattleTaleSrc(url){
    const img = document.getElementById("bfTaleImg");
    if (!img) return;
    img.src = String(url || TALE.f1);
  }

  // Plays (one-shot, 170ms step, no loop until next click):
  // tale1 → tale 2 → tale 3 → tale4 → tale5 → tale6_(a|b) → tale7 → tale8 → tale1
  // Use tale6_a if damage is applied to HERO, tale6_b if damage is applied to ENEMY.
  function playBattleTaleOnce(hitTarget, endFrame){
    const battle = state.battle;
    if (!battle) return;

    const hit = String(hitTarget || "");
    const f6 = (hit === "enemy") ? TALE.f6b : TALE.f6a;

    const end = String(endFrame || TALE.f1);

    const frames = [TALE.f1, TALE.f2, TALE.f3, TALE.f4, TALE.f5, f6, TALE.f7, TALE.f8, end];

    // cancel previous run (if user clicks again)
    battle._taleRun = (battle._taleRun|0) + 1;
    const runId = battle._taleRun;

    const step = 60;

    for (let k = 0; k < frames.length; k++){
      setTimeout(() => {
        if (!state.battle) return;
        if ((state.battle._taleRun|0) !== runId) return;
        setBattleTaleSrc(frames[k]);
      }, k * step);
    }
  }


  // SFX (cache-bust each play so replaced files apply immediately)
  const SFX = {
    victory: ASSET_BASE + "victory.wav",
    loose:   ASSET_BASE + "loose.wav",
    take:    ASSET_BASE + "take.wav",
    battle:  ASSET_BASE + "battle.wav",
    battlewin:  ASSET_BASE + "battlewin.wav",
    battleloose: ASSET_BASE + "battleloose.wav",
  };

  const DEFAULT_STATS = Object.freeze({
    Strength: 0,
    Dexterity: 0,
    Charisma: 0,
    Reaction: 0,
    Luck: 0,
  });

  const STATS_BY_SUM = Object.freeze({
    2:  { Strength: 22, Dexterity:  8, Charisma: 8, Reaction: 5, Luck: 9 },
    3:  { Strength: 20, Dexterity: 10, Charisma: 6, Reaction: 5, Luck: 9 },
    4:  { Strength: 16, Dexterity: 12, Charisma: 5, Reaction: 5, Luck: 9 },
    5:  { Strength: 18, Dexterity:  9, Charisma: 8, Reaction: 5, Luck: 9 },
    6:  { Strength: 20, Dexterity: 11, Charisma: 6, Reaction: 5, Luck: 9 },
    7:  { Strength: 20, Dexterity:  9, Charisma: 7, Reaction: 5, Luck: 9 },
    8:  { Strength: 16, Dexterity: 10, Charisma: 7, Reaction: 5, Luck: 9 },
    9:  { Strength: 24, Dexterity:  8, Charisma: 7, Reaction: 5, Luck: 9 },
    10: { Strength: 22, Dexterity:  9, Charisma: 6, Reaction: 5, Luck: 9 },
    11: { Strength: 18, Dexterity: 10, Charisma: 7, Reaction: 5, Luck: 9 },
    12: { Strength: 20, Dexterity: 11, Charisma: 5, Reaction: 5, Luck: 9 },
  });

  // ---------- RNG ----------
  function randInt(minInclusive, maxInclusive) {
    const min = minInclusive | 0;
    const max = maxInclusive | 0;
    const span = (max - min + 1) >>> 0;
    if (span <= 1) return min;

    const cryptoObj = (window.crypto || window.msCrypto);
    if (cryptoObj && cryptoObj.getRandomValues) {
      const buf = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / span) * span;
      while (true) {
        cryptoObj.getRandomValues(buf);
        const x = buf[0] >>> 0;
        if (x < limit) return min + (x % span);
      }
    }
    return min + Math.floor(Math.random() * span);
  }
  const rollD6 = () => randInt(1,6);
  const roll1d6 = () => rollD6();
  const roll2d6 = () => {
    const a = rollD6(), b = rollD6();
    return { a, b, sum: a+b };
  };

  // ---------- Audio ----------
  let audioUnlocked = false;
  function unlockAudioFromGesture(){
    if (audioUnlocked) return;
    audioUnlocked = true;
    try{
      const a = new Audio();
      a.muted = true;
      a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
      const p = a.play();
      if (p && p.catch) p.catch(()=>{});
      a.pause();
    }catch(_){}
  }
  function playSfx(url){
    if (!url) return;
    const a = new Audio(url + "?v=" + Date.now());
    a.preload = "auto";
    try{ a.volume = sfxVolume; }catch(_){ }
    a.playsInline = true;
    try{
      const p = a.play();
      if (p && p.catch) p.catch(()=>{});
    }catch(_){}
  }

  
  // ---------- Volume + Music ----------
  // Two independent volumes:
  //  - musicVolume: background looping music (Maintheme.mp3)
  //  - sfxVolume:   all one-shot sound effects (battle/paper/take/etc.)
  //
  // Stored in localStorage so settings persist between reloads.
  const LS_MUSIC_VOL = "hero_music_volume_v1";
  const LS_SFX_VOL   = "hero_sfx_volume_v1";

  function __readVol(key, fallback){
    try{
      const v = Number(localStorage.getItem(key));
      if (!Number.isFinite(v)) return fallback;
      return Math.max(0, Math.min(1, v));
    }catch(_){}
    return fallback;
  }
  function __writeVol(key, v){
    try{ localStorage.setItem(key, String(Math.max(0, Math.min(1, Number(v)||0)))); }catch(_){}
  }

  let musicVolume = __readVol(LS_MUSIC_VOL, 0.5);
  // NOTE: musicVolume is persisted separately from save/load.
  // Save/Load must NEVER overwrite it; they only restart playback.
  let sfxVolume   = __readVol(LS_SFX_VOL, 1.0);

  // Background music element is created lazily after a user gesture (mobile autoplay policies).
  let __musicEl = null;
  const MUSIC_URL = "./assets/Maintheme.mp3";

  function __ensureMusic(){
    // Music is owned by pageflip.js. Engine does NOT create/own Audio for Maintheme.mp3.
    return null;
  }

  function playMusic(){
    // Ask PageFlip layer to start (or resume) background music.
    try{ window.dispatchEvent(new CustomEvent("hero:music-play")); }catch(_){ }
    return true;
  }
  function stopMusic(){
    // Ask PageFlip layer to stop background music.
    try{ window.dispatchEvent(new CustomEvent("hero:music-stop")); }catch(_){ }
  }

  function setMusicVolume(v, persist=true){
    musicVolume = Math.max(0, Math.min(1, Number(v)||0));
    if (persist) __writeVol(LS_MUSIC_VOL, musicVolume);    // Notify PageFlip (Maintheme.mp3 volume)
    try{ window.dispatchEvent(new CustomEvent("hero:volume-music", { detail:{ value: musicVolume } })); }catch(_){ }
  }
  function getMusicVolume(){ return musicVolume; }

  function setSfxVolume(v, persist=true){
    sfxVolume = Math.max(0, Math.min(1, Number(v)||0));
    if (persist) __writeVol(LS_SFX_VOL, sfxVolume);
    // Notify PageFlip (paper.wav) and allow other systems to sync
    try{ window.dispatchEvent(new CustomEvent("hero:volume-sfx", { detail:{ value: sfxVolume } })); }catch(_){ }
  }
  function getSfxVolume(){ return sfxVolume; }

  function getVolumes(){ return { music: getMusicVolume(), sfx: getSfxVolume() }; }

// ---------- State ----------
  const state = {
    stats: { ...DEFAULT_STATS }, // always start at 0
    meta: null,
    strings: Object.create(null),

    // Last navigated page id (e.g. "-012"). Updated from hero:navigate events.
    page: "000",

    // ================= INVENTORY / EQUIPMENT =================
    // Inventory is 7 slots (backpack). Each slot stores an itemId string or null.
    // Equipment has 3 special slots selected by item.option:
    //   1 => "Ножны" (sheaths)
    //   2 => "На человеке" (on body)
    //   3 => "Одежда" (clothes)
    //
    // IMPORTANT: Keep inventory UI in textfield.v2.js driven by events
    // (hero:inventory-changed). This avoids tight coupling between UI and state shape.
    inventory: Array(7).fill(null),
    equip: { 1:null, 2:null, 3:null },

    // ================= SPELLBOOK (Magic tab) =================
    // 6 slots. Any item id starting with "spell_" OR Items.json type:"spell"
    // goes here (NOT to backpack inventory).
    spellbook: Array(SPELLBOOK_SLOTS).fill(null),
    // =========================================================

    // Track items that were ever taken in this session/save.
    // Rule: the same itemId can only be taken once, even if it was later deleted/used.
    taken: Object.create(null),

    // Strength is "current HP". Food restores Strength but MUST NOT exceed
    // the initial Strength rolled by (stats) for this session.
    maxStrength: 0,

    // Lazy-loaded items database from Items.json:
    // { Item_apple: { Item_apple:"Яблоко", type:"food", option:"10" }, ... }
    itemsDb: null,
    // ==========================================================

    mode: "NORMAL", // "NORMAL" | "BATTLE"
    battle: null,
  };

  function save(){
    // Unified autosave: use the same snapshot as manual Save.
    // This guarantees that stats/inventory/spellbook/page/settings/volumes are persisted together.
    try{ saveNow(); }catch(_){ }
  }

  function resetToZero(saveToDisk = true){
    // IMPORTANT: Do NOT autosave on boot.
    // Previously, boot() called resetToZero() which called save() and overwrote an existing save
    // before the player could press "Load". That made Load appear broken (page/stats were wiped).
    state.stats = { ...DEFAULT_STATS };
    state.inventory = Array(7).fill(null);
    state.equip = { 1:null, 2:null, 3:null };
    state.spellbook = Array(SPELLBOOK_SLOTS).fill(null);
    state.taken = Object.create(null);
    state.maxStrength = 0;

    // Reset page to the default start page.
    state.page = "000";

    if (saveToDisk){
      // Manual/new-game reset: persist immediately.
      try{ saveNow(); }catch(_){}
    }

    pushInventoryToUI();
    pushToUI();
    syncUI();
  }

  // ---------- UI sync ----------
  function pushToUI(){
    const ht = window.HeroTextfield;
    if (!ht) return false;
    try{
      if (Array.isArray(state.meta) && typeof ht.setStatsMeta === "function") ht.setStatsMeta(state.meta);
      if (typeof ht.setStatsValues === "function") ht.setStatsValues(state.stats);
      return true;
    }catch(e){
      logWarn("pushToUI failed", e);
      return false;
    }
  }

  // Push inventory/equipment changes to UI.
  // This is intentionally *event based* (CustomEvent) so UI layers can subscribe
  // without importing engine internals (prevents future refactors from breaking
  // click flow and the "?" help system).
  function pushInventoryToUI(){
    try{
      window.dispatchEvent(new CustomEvent("hero:inventory-changed", {
        detail: buildInventoryView()
      }));
    }catch(_){}
  }

  async function loadMeta(){
    if (state.meta) return state.meta;

    let arr = null;
    try{
      const r = await fetch(STATS_META_URL + "?v=" + Date.now(), { cache:"no-store" });
      if (r.ok) arr = await r.json();
    }catch(err){ logWarn("Stats.json fetch failed", err); }

    if (!Array.isArray(arr) || !arr.length || !validateKeyedArray(arr, "Stats.json")) {
      logWarn("Stats.json: invalid or empty");
      arr = [
        { Strength:"Strength" },
        { Dexterity:"Dexterity" },
        { Charisma:"Charisma" },
        { Reaction:"Reaction" },
        { Luck:"Luck" },
      ];
    }

    // Stats.json is used for BOTH:
    // 1) labels for stat keys (top stats panel)
    // 2) battle log phrases (Turn, Dexgood, etc.)
    // We must NOT treat non-stat keys as numeric stats.
    const labels = Object.create(null);
    for (const item of arr){
      if (!item || typeof item !== "object") continue;
      const k = Object.keys(item)[0];
      if (!k) continue;
      labels[k] = String(item[k] ?? k);
    }
    state.strings = labels;

    const meta = [];
    for (const k of Object.keys(DEFAULT_STATS)){
      meta.push({ key: k, label: String(labels[k] ?? k) });
      if (!(k in state.stats)) state.stats[k] = 0;
    }

    state.meta = meta;
    return meta;
  }

  // ---------- Items / Inventory ----------
  async function preloadMenu(){
    try{ await fetch(MENU_URL + "?v=" + Date.now(), { cache:"no-store" }); }catch(err){ logWarn("Menu.json fetch failed", err); }
  }

  async function ensureItemsDb(){
    if (state.itemsDb) return state.itemsDb;
    let arr = null;
    try{
      const r = await fetch(ITEMS_URL + "?v=" + Date.now(), { cache:"no-store" });
      if (r.ok) arr = await r.json();
    }catch(err){ logWarn("Items.json fetch failed", err); }

    // Expected format: array of objects, each object describes one item:
    //   {"Item_apple":"Яблоко","type":"food","option":"10"}
    // We store it as a map by itemId.
    const db = Object.create(null);
    if (!Array.isArray(arr) || !arr.length || !validateKeyedArray(arr, "Items.json")) {
      logWarn("Items.json: invalid or empty");
    }
    if (Array.isArray(arr)){
      for (const obj of arr){
        if (!obj || typeof obj !== "object") continue;
        const id = Object.keys(obj)[0];
        if (!id) continue;
        db[String(id)] = obj;
      }
    }
    state.itemsDb = db;
    return db;
  }

  function getItemDef(itemId){
    const id = String(itemId||"");
    if (!id) return null;
    const db = state.itemsDb;
    if (db && id in db) return db[id];
    return null;
  }

  function itemLabel(itemId){
    const def = getItemDef(itemId);
    if (def){
      const k = Object.keys(def)[0];
      if (k && def[k] != null) return String(def[k]);
    }
    return String(itemId||"");
  }

  function isSpellId(itemId){
  // Hard rule: any id that starts with "spell_" is a spell (goes to spellbook),
  // even if Items.json is missing/incorrect.
  return /^spell_/i.test(String(itemId||""));
}

function itemType(itemId){
    if (isSpellId(itemId)) return "spell";
    const def = getItemDef(itemId);
    const t = def && def.type != null ? String(def.type) : "";
    return t.toLowerCase();
  }

  function itemOption(itemId){
    const def = getItemDef(itemId);
    const opt = def && def.option != null ? String(def.option) : "";
    return opt;
  }

  function buildInventoryView(){
    // View model shipped to UI.
    const slots = state.inventory.map((id, idx) => {
      if (!id) return { slot: idx+1, id: null, label: "", type:"", option:"" };
      return { slot: idx+1, id: String(id), label: itemLabel(id), type: itemType(id), option: itemOption(id) };
    });
    const equip = {};
    for (const k of [1,2,3]){
      const id = state.equip && state.equip[k] ? state.equip[k] : null;
      equip[k] = id ? { slot:k, id:String(id), label:itemLabel(id), type:itemType(id), option:itemOption(id) } : { slot:k, id:null, label:"", type:"", option:"" };
    }
    const spellbook = (state.spellbook || Array(SPELLBOOK_SLOTS).fill(null)).map((id, idx) => {
  if (!id) return { slot: idx+1, id: null, label: "", type:"", option:"" };
  return { slot: idx+1, id: String(id), label: itemLabel(id), type: itemType(id), option: itemOption(id) };
});
return { slots, equip, spellbook, maxStrength: Number(state.maxStrength||0) };
  }

  function t(key, fallback){
    const k = String(key||"");
    const v = state.strings && k in state.strings ? state.strings[k] : null;
    return (v != null && v !== "") ? String(v) : (fallback != null ? String(fallback) : k);
  }

  function escapeHtml(s){
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

function validateKeyedArray(arr, context){
  if (!Array.isArray(arr)) return false;
  let ok = 0;
  for (let i = 0; i < arr.length; i++) {
    const obj = arr[i];
    if (!obj || typeof obj !== "object") {
      logWarn(context + " entry is not object at index", i);
      continue;
    }
    const k = Object.keys(obj)[0];
    if (!k) {
      logWarn(context + " entry has no key at index", i);
      continue;
    }
    ok++;
  }
  return ok > 0;
}

  function nav(pageId){
    if (!pageId) return;
    window.dispatchEvent(new CustomEvent("hero:navigate", { detail:{ page:String(pageId) } }));
  }

  // ---------- Action parsing ----------
  function parseActionSpec(specRaw){
    const spec = String(specRaw||"").trim();
    if (!spec) return null;

    // Name only
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(spec)){
      return { name: spec.toLowerCase(), args: [] };
    }

    // battle:[...];WIN;LOSE  OR luck;-013;-012 OR reac:1;-015;-016
    const parts = spec.split(";").map(s=>s.trim()).filter(Boolean);
    if (!parts.length) return null;

    const head = parts[0];
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)(?::(.+))?$/.exec(head);
    if (!m) return null;

    const name = m[1].toLowerCase();
    const args = [];
    if (m[2] != null && m[2] !== "") args.push(m[2].trim());
    for (let i=1;i<parts.length;i++) args.push(parts[i]);
    return { name, args };
  }

  // ---------- Core actions ----------
  function action_stats(){
    const r = roll2d6();
    const picked = STATS_BY_SUM[r.sum] || STATS_BY_SUM[7];
    state.stats = { ...state.stats, ...picked };
    ensureMaxStrengthFromStats();
    save();
    pushToUI();
    pushInventoryToUI();
    logInfo("stats(): rolled", r.a, "+", r.b, "=", r.sum, "=>", picked);
    return { roll:r, stats:{...state.stats} };
  }

  function action_luck(successPage, failPage){
    const r = roll2d6();
    const curLuck = Number(state.stats.Luck ?? 0);
    const ok = r.sum <= curLuck;

    playSfx(ok ? SFX.victory : SFX.loose);

    state.stats.Luck = Math.max(0, curLuck - 1);
    save();
    pushToUI();

    nav(ok ? successPage : failPage);
    return { roll:r, ok, stats:{...state.stats} };
  }

  function action_reac(threshold, successPage, failPage){
    const thr = Number(threshold);
    const need = Number.isFinite(thr) ? thr : 0;

    const cur = Number(state.stats.Reaction ?? 0);
    const ok = cur >= need;

    playSfx(ok ? SFX.victory : SFX.loose);

    // after check, Reaction += 1 (always)
    state.stats.Reaction = cur + 1;
    save();
    pushToUI();

    nav(ok ? successPage : failPage);
    return { ok, need, stats:{...state.stats} };
  }

  // ---------- Inventory actions ----------
  function findFirstEmptySpellSlot(){
  if (!Array.isArray(state.spellbook)) state.spellbook = Array(SPELLBOOK_SLOTS).fill(null);
  for (let i=0;i<state.spellbook.length;i++){
    if (!state.spellbook[i]) return i;
  }
  return -1;
}

function findFirstEmptySlot(){
    for (let i=0;i<state.inventory.length;i++){
      if (!state.inventory[i]) return i;
    }
    return -1;
  }

  function action_take(itemId, _fromEnsure){
    const id = String(itemId||"").trim();
    if (!id) return null;

    // Rule: the same item can only be taken once per session/save.
    // We enforce this BEFORE any slot logic, so the UI stays consistent.
    if (!state.taken) state.taken = Object.create(null);
    if (state.taken[id]){
      // already taken earlier -> ignore silently (no sound, no UI change)
      return { ok:false, reason:"already", id };
    }

    // Load Items.json lazily if it was not available at boot.
    // NOTE: take() can be invoked from page text links, so it MUST NOT throw.
    if (!state.itemsDb && !_fromEnsure) {
      // Items.json not ready: load then retry once to preserve item typing.
      ensureItemsDb().then(() => { action_take(id, true); }).catch(()=>{});
      return { ok:false, reason:"items_pending", id };
    }

    const typ = itemType(id);
    const opt = Number(itemOption(id));
    


    // MAGIC ROUTE: spells go to spellbook (6 slots), NEVER to backpack inventory.
    if (typ === "spell" || isSpellId(id)){
      if (!Array.isArray(state.spellbook)) state.spellbook = Array(SPELLBOOK_SLOTS).fill(null);
      const si = findFirstEmptySpellSlot();
      if (si < 0){
        pushInventoryToUI();
        return { ok:false, reason:"spellbook_full", id };
      }
      state.spellbook[si] = id;
      state.taken[id] = 1;
      save();
      playSfx(SFX.take);
      pushInventoryToUI();
      return { ok:true, spell:true, slot: si+1, id };
    }
if (typ === "equip" && (opt === 1 || opt === 2 || opt === 3)){
  // Equip items NEVER occupy backpack slots (1–7).
  // They go directly into equipment slot by option:
  //   1 = Sheath (Ножны), 2 = Worn (На человеке), 3 = Clothes (Одежда)
  //
  // IMPORTANT RULE (user requirement):
  //   If the target equipment slot is already occupied,
  //   the new item OVERWRITES that slot.
  //   The previously equipped item is NOT moved into inventory.
  //   (This prevents equip items from "leaking" into backpack.)
  state.equip[opt] = id;

  // Enforce "take only once" for equip items too.
  state.taken[id] = 1;

  save();
  playSfx(SFX.take);
  pushInventoryToUI();
  return { ok:true, equipped:true, slot:opt, id };
}

// Normal items: put into backpack (7 slots) (7 slots)
    const empty = findFirstEmptySlot();
    if (empty < 0){
      // No space. Do nothing.
      pushInventoryToUI();
      return { ok:false, reason:"full", id };
    }

    state.inventory[empty] = id;
    state.taken[id] = 1;
    save();
    playSfx(SFX.take);
    pushInventoryToUI();
    return { ok:true, equipped:false, slot:empty+1, id };
  }

  function action_delete(slotIndex){
    const n = Number(slotIndex);
    const idx = Number.isFinite(n) ? (n|0) - 1 : -1;
    if (idx < 0 || idx >= state.inventory.length) return { ok:false };
    const id = state.inventory[idx];
    if (!id) return { ok:false, empty:true };
    state.inventory[idx] = null;
    save();
    pushInventoryToUI();
    return { ok:true, id, slot:idx+1 };
  }

  function action_usage(slotIndex){
    // "usage" is used for food items.
    const n = Number(slotIndex);
    const idx = Number.isFinite(n) ? (n|0) - 1 : -1;
    if (idx < 0 || idx >= state.inventory.length) return { ok:false };
    const id = state.inventory[idx];
    if (!id) return { ok:false, empty:true };

    const typ = itemType(id);
    if (typ !== "food") return { ok:false, notFood:true };

    const add = Number(itemOption(id));
    const delta = Number.isFinite(add) ? (add|0) : 0;

    const cur = Number(state.stats.Strength ?? 0);
    const maxS = Number(state.maxStrength ?? 0) || cur; // fallback: if not set, cap to current
    const next = Math.min(maxS, cur + Math.max(0, delta));
    state.stats.Strength = next;

    // Consumed: remove from inventory.
    state.inventory[idx] = null;

    save();
    pushToUI();
    pushInventoryToUI();
    return { ok:true, id, slot:idx+1, strength:{ before:cur, after:next, max:maxS } };
  }

  // Keep maxStrength in sync once the player rolls initial stats.
  // This is the ONLY time maxStrength should be (re)defined automatically.
  function ensureMaxStrengthFromStats(){
    const s = Number(state.stats.Strength ?? 0);
    if (!Number.isFinite(s)) return;
    if (!state.maxStrength || state.maxStrength <= 0){
      state.maxStrength = s|0;
    }
  }

  // ---------- Battle ----------
  function stageRect(){
    const st = window.__HERO_STAGE || document.querySelector(".hpf-stage");
    if (!st) return null;
    const r = st.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return r;
  }

  function pageMin(){
    const cs = getComputedStyle(document.documentElement);
    const w = parseFloat(cs.getPropertyValue("--page-w")) || 1024;
    const h = parseFloat(cs.getPropertyValue("--page-h")) || 1536;
    return { w, h };
  }

  function clampWidthToMin(r){
    const min = pageMin();
    const enforce = window.innerWidth >= min.w && window.innerHeight >= min.h;
    const w0 = Math.round(r.width);
    if (!enforce) return { width: w0, left: Math.round(r.left) };
    const w = Math.max(min.w, w0);
    const left = Math.round(r.left + (r.width - w) / 2);
    return { width: w, left };
  }

  function ensureBattleUI(){
    let bf = document.getElementById("battlefield");
    if (!bf){
      bf = document.createElement("div");
      bf.id = "battlefield";
      bf.innerHTML = `<div id="battlefield__inner"></div>`;
      document.body.appendChild(bf);
    }
    return bf;
  }


  // Hide/show non-battle UI fields when battle overlay is visible.
  // We hide the bottom text field and top stats field (and start button if present),
  // then restore their previous inline display values after battle ends.
  
/* ============================================================
   BATTLE MODE UI HIDING (INTERACTS WITH "?" HELP BUTTON)
   ------------------------------------------------------------
   When entering battle mode we MUST hide the normal UI panels:
     - #textfield (bottom story)
     - #statsfield (top stats + "?" button)
     - #startGameBtn (start overlay)
   so they do not overlap with #battlefield and do not intercept clicks.

   Implementation detail:
     - We store previous inline display value in data-prevDisplay.
     - We restore it verbatim when battle ends.
     - This is intentionally symmetric with the help overlay's __hideUiPanels()
       in textfield.v2.js. Keep them aligned to avoid "forgot to restore" bugs. fileciteturn1file14turn1file4

   IMPORTANT FOR FUTURE EDITS:
     - Do NOT replace display:none with opacity/visibility only.
       Hidden-but-clickable layers are the #1 reason the "?" becomes dead.
     - If you add new UI ids that must be hidden during battle (e.g. inventory panel),
       add them here in the ids[] list AND store/restore their previous display.
   ============================================================ */
  function setNonBattleFieldsHidden(hidden){
    const ids = ["textfield", "statsfield", "startGameBtn"];
    for (const id of ids){
      const el = document.getElementById(id);
      if (!el) continue;

      if (hidden){
        if (el.dataset && el.dataset.prevDisplay === undefined){
          el.dataset.prevDisplay = el.style.display || "";
        }
        el.style.display = "none";
      } else {
        const prev = (el.dataset && el.dataset.prevDisplay !== undefined) ? el.dataset.prevDisplay : "";
        el.style.display = prev;
        if (el.dataset) delete el.dataset.prevDisplay;
      }
    }
  }

  function positionBattleUI(){
    const bf = ensureBattleUI();
    const inner = document.getElementById("battlefield__inner");
    const r = stageRect();
    if (!r) return;

    const h = Math.round(r.height * 0.50);
    const dim = clampWidthToMin(r);
    const w = dim.width;
    const left = dim.left;
    const top = Math.round(r.top + (r.height - h) / 2);

    bf.style.left = left + "px";
    bf.style.top = top + "px";
    bf.style.width = w + "px";
    bf.style.height = h + "px";

    if (inner) inner.style.pointerEvents = "auto";
  }

  function flashStatValue(key){
    const el = document.querySelector(`#statsfield__inner [data-stat-val="${CSS.escape(String(key))}"]`);
    if (!el) return;
    el.classList.add("flash-red");
    setTimeout(()=>el.classList.remove("flash-red"), 450);
  }

  function flashBattleEl(el){
    if (!el) return;
    el.classList.add("flash-red");
    setTimeout(()=>el.classList.remove("flash-red"), 450);
  }

  // --- battle HP label flashing (works even when renderBattle rebuilds DOM) ---
  function queueBattleFlashPlayer(){
    const battle = state.battle;
    if (!battle) return;
    battle._flashPlayer = true;
  }
  function queueBattleFlashEnemy(idx){
    const battle = state.battle;
    if (!battle) return;
    if (!battle._flashEnemies) battle._flashEnemies = {};
    battle._flashEnemies[String(idx)] = true;
  }
  function applyBattleFlashAfterRender(){
    const battle = state.battle;
    if (!battle) return;

    const toFlash = [];

    if (battle._flashPlayer){
      const pHpEl = document.getElementById("bfPlayerHPLabel");
      if (pHpEl) toFlash.push(pHpEl);
    }

    if (battle._flashEnemies){
      for (const k of Object.keys(battle._flashEnemies)){
        if (!battle._flashEnemies[k]) continue;
        const hpEl = document.querySelector(`.bf-hplabel[data-ehp="${CSS.escape(String(k))}"]`);
        if (hpEl) toFlash.push(hpEl);
      }
    }

    // clear flags now (DOM will handle visual timeout)
    battle._flashPlayer = false;
    battle._flashEnemies = null;

    for (const el of toFlash){
      el.classList.add("flash-red");
      setTimeout(()=>el.classList.remove("flash-red"), 450);
    }
  }

  function parseBattleArgs(arg0){
    // arg0 expected like "[8,7|6,9|10,5]" (may be with spaces)
    const s = String(arg0||"").trim();
    const m = /^\[(.*)\]$/.exec(s);
    if (!m) return null;
    const body = m[1].trim();
    if (!body) return null;

    const enemies = body.split("|").map(x=>x.trim()).filter(Boolean).map(pair=>{
      const mm = /^\s*([0-9]+)\s*,\s*([0-9]+)\s*$/.exec(pair);
      if (!mm) return null;
      return { str: Number(mm[1]), dex: Number(mm[2]), alive:true, fled:false };
    }).filter(Boolean);

    if (!enemies.length || enemies.length > 3) return null;
    return enemies;
  }

  function battleLayoutRows(count){
    // indices -> row (1..3). player always row 2.
    if (count === 1) return [2];
    if (count === 2) return [2,1]; // enemy0 row2, enemy1 row1 (your rule)
    return [1,2,3]; // 3 enemies
  }

  function renderBattle(){
    const battle = state.battle;
    if (!battle) return;
    syncBattleTarget();

    const inner = document.getElementById("battlefield__inner");
    if (!inner) return;

    const rows = battleLayoutRows(battle.enemies.length);

    // build 3-row grid
    const slots = [null,null,null]; // row1..row3 store enemy index
    for (let i=0;i<rows.length;i++){
      const row = rows[i];
      slots[row-1] = i;
    }

    const playerStr = battle.playerStr;
    const playerDex = battle.playerDex;
    const locked = !!battle.finished;

    function enemyCard(enemyIdx){
      const E = battle.enemies[enemyIdx];
      if (!E || !E.alive) return ""; // defeated/fled enemies disappear

      const lockedLocal = !!battle.finished;
      const checked = (battle.target === enemyIdx) ? "checked" : "";
      const disabled = (lockedLocal || battle.enemies.length === 1) ? "disabled" : "";

      return `
        <div class="bf-enemy" data-e="${enemyIdx}">
          <div class="bf-enemyRow">
            <input class="bf-radio" type="radio" name="bfTarget" value="${enemyIdx}" ${checked} ${disabled}>
            <div class="bf-enemyBody">
              <div class="bf-title">Противник</div>
              <div class="bf-statline">
                <span class="bf-hplabel" data-ehp="${enemyIdx}">HP</span>
                <span class="bf-val" data-eval="${enemyIdx}">${E.str}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const playerCell = `
      <div class="bf-player">
        <div class="bf-title">Вы</div>
        <div class="bf-statline">
          <span class="bf-hplabel" id="bfPlayerHPLabel">HP</span>
          <span class="bf-val" id="bfPlayerVal">${playerStr}</span>
        </div>
      </div>
    `;

    const enemiesHtml = battle.enemies
      .map((_, i) => enemyCard(i))
      .filter(Boolean)
      .join("");

    const taleCell = `
      <div class="bf-taleWrap">
        <img id="bfTaleImg" class="bf-tale" src="${TALE.f1}" alt="battle frame">
      </div>
    `;

    const actions = `
      <div class="bf-actions">
        <button class="bf-btn" type="button" data-move="lunge" ${locked ? "disabled" : ""}>?????</button>
        <button class="bf-btn" type="button" data-move="pirouette" ${locked ? "disabled" : ""}>??????</button>
      </div>
    `;

    const grid = `
      <div class="bf-grid">
        <div class="bf-playerCol">${playerCell}</div>
        <div class="bf-centerCol">
          ${taleCell}
          ${actions}
        </div>
        <div class="bf-enemies">${enemiesHtml}</div>
      </div>
    `;

    const logLines = Array.isArray(battle.log) ? battle.log : ["","","","",""];
    const log = `
      <div class="bf-log" aria-label="battle log">
        <div class="bf-logline" data-ln="0">${escapeHtml(logLines[0] || "")}</div>
        <div class="bf-logline" data-ln="1">${escapeHtml(logLines[1] || "")}</div>
        <div class="bf-logline" data-ln="2">${escapeHtml(logLines[2] || "")}</div>
        <div class="bf-logline" data-ln="3">${escapeHtml(logLines[3] || "")}</div>
        <div class="bf-logline ${battle.clickableEnd ? "bf-logline--clickable" : ""}" data-ln="4">${escapeHtml(logLines[4] || "")}</div>
      </div>
    `;

    inner.innerHTML = `<div class="bf-main">${grid}</div>${log}`;

    // target radios + click-to-select enemy
    inner.querySelectorAll('input[name="bfTarget"]').forEach(inp=>{
      inp.addEventListener("change", () => {
        battle.target = Number(inp.value);
        syncBattleTarget();
        // re-render so the checked state is always in sync and any per-target UI updates apply
        renderBattle();
      });
    });

    // allow clicking the whole enemy block to select it (not just the small radio)
    inner.querySelectorAll(".bf-enemy").forEach(box=>{
      box.addEventListener("click", (ev) => {
        if (locked || (battle.enemies.length === 1)) return;
        const idx = Number(box.getAttribute("data-e"));
        if (!Number.isFinite(idx)) return;
        battle.target = idx;
        syncBattleTarget();
        renderBattle();
        ev.preventDefault();
      });
    });

    // move buttons
    inner.querySelectorAll(".bf-btn").forEach(btn=>{
      btn.addEventListener("click", () => {
        const move = btn.getAttribute("data-move");
        battleTurn(move);
      });
    });

    // clickable end line
    const endLine = inner.querySelector('.bf-logline[data-ln="4"]');
    if (endLine && battle.clickableEnd){
      endLine.addEventListener("click", () => {
        if (!state.battle || !state.battle.finished || !state.battle.clickableEnd) return;
        battleEndFinalize(!!state.battle.win);
      });
    }

    // apply HP label flashes (if any) after rebuilding DOM
    applyBattleFlashAfterRender();

  }

  function updateBattleNumbers(prevPlayerStr, prevEnemyStrs){
    const battle = state.battle;
    if (!battle) return;

    // player
    const pValEl = document.getElementById("bfPlayerVal");
    const pHpEl  = document.getElementById("bfPlayerHPLabel");
    if (pValEl){
      if (battle.playerStr !== prevPlayerStr) flashBattleEl(pHpEl || pValEl);
      pValEl.textContent = String(battle.playerStr);
    }

    // enemies
    for (let i=0;i<battle.enemies.length;i++){
      const valEl = document.querySelector(`[data-eval="${i}"]`);
      const hpEl  = document.querySelector(`[data-ehp="${i}"]`);
      const E = battle.enemies[i];
      const v = E.alive ? E.str : 0;
      if (valEl){
        if (prevEnemyStrs[i] !== v) flashBattleEl(hpEl || valEl);
        valEl.textContent = String(v);
      }
    }
  }

  function pickNextAliveTarget(){
    const battle = state.battle;
    if (!battle) return;
    const n = battle.enemies.length;
    for (let i=0;i<n;i++){
      if (battle.enemies[i].alive) { battle.target = i; return; }
    }
    battle.target = 0;
  }


  function syncBattleTarget(){
    const battle = state.battle;
    if (!battle) return;

    // ensure target points to a living enemy
    const n = battle.enemies.length;
    let t = Number(battle.target);
    if (!Number.isFinite(t) || t < 0 || t >= n || !battle.enemies[t] || !battle.enemies[t].alive){
      // pick first alive
      t = 0;
      for (let i=0;i<n;i++){
        if (battle.enemies[i] && battle.enemies[i].alive){ t = i; break; }
      }
      battle.target = t;
    }

    const heroDex = Number((state.stats.Dexterity ?? state.stats.Dex ?? state.stats.DEX ?? battle.playerDex ?? 0));
    const enemy = battle.enemies[battle.target];
    const enemyDex = Number((enemy?.dex ?? enemy?.Dexterity ?? enemy?.Dex ?? enemy?.DEX ?? 0));

    battle.playerDex = heroDex;
    battle.targetDex = enemyDex;
    battle.dexAdv = (heroDex > enemyDex);
    battle.dexDis = (heroDex < enemyDex);

    // precompute thresholds for UI/log correctness
    battle.thrustMax = battle.dexAdv ? 4 : 3;   // "Выпад" success if r <= thrustMax
    battle.pirMin    = battle.dexAdv ? 3 : 4;   // "Пируэт" success if r >= pirMin
  }

  function battleSetFinished(win){
    const battle = state.battle;
    if (!battle) return;
    if (battle.finished) return;

    battle.finished = true;
    battle.win = !!win;
    battle.clickableEnd = true;

    // play outcome sound once (no auto-close)
    playSfx(battle.win ? SFX.battlewin : SFX.battleloose);

    renderBattle();
  }

  function battleEndFinalize(win){
    const battle = state.battle;
    if (!battle) return;

    state.battle = null;
    state.mode = "NORMAL";
    window.dispatchEvent(new CustomEvent("hero:mode", { detail:{ mode:"NORMAL" } }));

    const bf = document.getElementById("battlefield");
    if (bf){
      bf.classList.remove("is-visible");
      bf.style.display = "none";
    }

    // show panels and then navigate (let index flip)
    setNonBattleFieldsHidden(false);
    window.dispatchEvent(new CustomEvent("hero:ui-show", { detail:{ delayMs: 1000 } }));
    nav(win ? battle.winPage : battle.losePage);
  }

  function battleTurn(move){
    const battle = state.battle;
    if (!battle) return;
    if (battle.finished) return;

    unlockAudioFromGesture();
    playSfx(SFX.battle);

    // increment turn on every player action
    battle.turn = (battle.turn | 0) + 1;

    const tIdx = battle.target;
    const enemy = battle.enemies[tIdx];
    if (!enemy || !enemy.alive) { pickNextAliveTarget(); renderBattle(); return; }

    // always re-sync on action (target may have changed)
    syncBattleTarget();
    const dexAdv = !!battle.dexAdv;
    const r = roll1d6();

    // Determine success ranges
    let success = false;
    let need = 0;
    let op = ""; // "≤" or "≥" for log
    if (move === "lunge"){
      // base 1-3; if dexAdv 1-4  => r ≤ need
      need = battle.thrustMax;
      op = "≤";
      success = (r>=1 && r<=need);
    } else {
      // pirouette base 4-6; if dexAdv 3-6  => r ≥ need
      need = battle.pirMin;
      op = "≥";
      success = (r>=need && r<=6);
    }

    let dmgDone = 0;
    let dmgTaken = 0;
    let enemyFled = false;

    if (success){
      // damage
      if (dexAdv) dmgDone += 1;
      dmgDone += Math.floor(battle.playerStr / 4);

      const prevE = enemy.str;
      enemy.str = Math.max(0, enemy.str - dmgDone);
      if (enemy.str !== prevE) queueBattleFlashEnemy(tIdx);
      if (enemy.str === 0){
        enemy.alive = false; // defeated -> disappears
      }

      // flee check (only if still alive)
      const fleeRoll = roll1d6();
      if (enemy.alive && enemy.str < fleeRoll){
        enemy.alive = false;
        enemy.fled = true;
        enemyFled = true;
      }
    } else {
      // enemy hits player
      dmgTaken = Math.floor(enemy.str / 4);
      const prevP = battle.playerStr;
      battle.playerStr = Math.max(0, battle.playerStr - dmgTaken);
      if (battle.playerStr !== prevP) queueBattleFlashPlayer();

      // sync Strength back to global stats
      state.stats.Strength = battle.playerStr;
      save();
      pushToUI();
      if (dmgTaken > 0) flashStatValue("Strength");

      // flee check (only if still alive)
      const fleeRoll = roll1d6();
      if (enemy.alive && enemy.str < fleeRoll){
        enemy.alive = false;
        enemy.fled = true;
        enemyFled = true;
      }
    }

    // pick next target if current is gone
    if (!enemy.alive) pickNextAliveTarget();

    // ---- build 5-line log (exactly) ----
    const line1 = `${t("Turn","Turn") } ${battle.turn}`;
    const line2 = dexAdv ? t("Dexgood","Dex good") : t("Dexbad","Dex bad");
    const reason = `(${r}${op}${need})`;
    const line3 = success
      ? `${t("Hitgood","Hit good")} ${dmgDone} ${reason}`
      : `${t("Hitbad","Hit bad")} ${dmgTaken} ${reason}`;

    // line4: enemy defeated has priority over flee status
    const enemyDied = (success && enemy.str === 0);
    const line4 = enemyDied
      ? t("Enemydie","Enemy defeated")
      : (enemyFled ? t("Fleebad","Flee bad") : t("Fleegood","Flee good"));

    // outcome line 5
    const anyAlive = battle.enemies.some(e => e.alive);
    let outcomeKey = "battlecont";
    if (!anyAlive && battle.playerStr > 0) outcomeKey = "battlevict";
    else if (battle.playerStr <= 0 && anyAlive) outcomeKey = "battledie";

    const line5 = t(outcomeKey, outcomeKey);

    // If battle ended, keep final frame on the proper ending still.
    let endFrame = TALE.f1;
    if (outcomeKey === "battledie") endFrame = TALE.f8a;
    else if (outcomeKey === "battlevict") endFrame = TALE.f8b;

    // Play battle animation once per action (frame 6 depends on who takes damage).
    playBattleTaleOnce(success ? "enemy" : "hero", endFrame);

    battle.log = [line1, line2, line3, line4, line5];
    battle.clickableEnd = (outcomeKey === "battlevict" || outcomeKey === "battledie");

    // mark finished but DO NOT close automatically
    if (outcomeKey === "battlevict") battleSetFinished(true);
    else if (outcomeKey === "battledie") battleSetFinished(false);

    renderBattle();
  }

  function action_battle(arg0, winPage, losePage){
    const enemies = parseBattleArgs(arg0);
    if (!enemies){
      logWarn("battle: bad args", arg0);
      return null;
    }

    // enter battle mode
    state.mode = "BATTLE";
    window.dispatchEvent(new CustomEvent("hero:mode", { detail:{ mode:"BATTLE" } }));
    window.dispatchEvent(new CustomEvent("hero:ui-hide"));
    setNonBattleFieldsHidden(true);

    // show under page as current page (no change) - do nothing

    // create battle state
    state.battle = {
      enemies,
      target: 0,
      turn: 0,
      log: ["","","","",""], // empty until first move
      finished: false,
      win: false,
      clickableEnd: false,
      playerStr: Number(state.stats.Strength ?? 0),
      playerDex: Number((state.stats.Dexterity ?? state.stats.Dex ?? 0)),
      winPage: String(winPage || ""),
      losePage: String(losePage || ""),
    };

    const bf = ensureBattleUI();
    positionBattleUI();
    bf.style.display = "block";
    bf.classList.add("is-visible");
    pickNextAliveTarget();
    syncBattleTarget();
    renderBattle();

    // keep positioned on resize
    return { enemiesCount: enemies.length };
  }

  // ---------- Registry ----------
  const registry = Object.create(null);
  registry.stats = () => action_stats();
  registry.luck  = (args) => action_luck(args[0], args[1]);
  registry.reac  = (args) => action_reac(args[0], args[1], args[2]);
  registry.take   = (args) => action_take(args[0]);
  registry.delete = (args) => action_delete(args[0]);
  registry.usage  = (args) => action_usage(args[0]);
  registry.battle = (args) => action_battle(args[0], args[1], args[2]);

  function runAction(specRaw, linkPageFallback){
    const parsed = parseActionSpec(specRaw);
    if (!parsed){
      logWarn("bad action spec:", specRaw);
      return null;
    }

    unlockAudioFromGesture();

    const fn = registry[parsed.name];
    if (typeof fn !== "function"){
      logWarn("unknown action:", parsed.name, "spec:", specRaw);
      return null;
    }

    const res = fn(parsed.args);

    // If stats accompanies a link, navigate after setting stats.
    if (parsed.name === "stats" && linkPageFallback){
      nav(linkPageFallback);
    }

    return res;
  }

  // ---------- Events ----------
  window.addEventListener("pointerdown", unlockAudioFromGesture, { passive:true, capture:true });

  window.addEventListener("hero:action", (e) => {
    const d = e && e.detail ? e.detail : null;
    if (!d) return;
    const nameOrSpec = (d.name != null ? String(d.name) : "");
    const pageFallback = (d.page != null ? String(d.page) : "");
    if (!nameOrSpec) return;
    try{ runAction(nameOrSpec, pageFallback); }catch(err){ console.error(err); }
  });

  function syncUI(){
    // keep panels + battle positioned when visible
    if (window.HeroTextfield && typeof window.HeroTextfield.sync === "function") window.HeroTextfield.sync();
    if (state.mode === "BATTLE"){
      positionBattleUI();
    }
  }

  window.addEventListener("resize", () => { if (state.mode==="BATTLE") positionBattleUI(); }, { passive:true });
  if (window.visualViewport){
    window.visualViewport.addEventListener("resize", () => { if (state.mode==="BATTLE") positionBattleUI(); }, { passive:true });
    window.visualViewport.addEventListener("scroll", () => { if (state.mode==="BATTLE") positionBattleUI(); }, { passive:true });
  }

  // ---------- Boot ----------
  async function boot(){
    resetToZero(false);
    await loadMeta();
    await ensureItemsDb();
    pushInventoryToUI();

    // push meta+zeros as soon as textfield exists
    const t0 = performance.now();
    const timer = setInterval(() => {
      if (pushToUI()) clearInterval(timer);
      if (performance.now() - t0 > 6000) clearInterval(timer);
    }, 60);
  }

  
  // Track current page (for Save/Load)
  window.addEventListener("hero:navigate", (e) => {
    try{
      const p = e && e.detail && e.detail.page;
      if (p !== undefined) state.page = String(p);
    }catch(_){}
  }, true);

  // Allow external UIs (options/start) to control volumes even if they don't call methods directly.
  window.addEventListener("hero:set-music-volume", (e) => {
    try{ setMusicVolume(e.detail && e.detail.value); }catch(_){}
  });
  window.addEventListener("hero:set-sfx-volume", (e) => {
    try{ setSfxVolume(e.detail && e.detail.value); }catch(_){}
  });

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  } else {
    boot();
  }

  
  // ---------- Save / Load ----------
  // Stores engine state + current page to localStorage.
  const LS_SAVE = STORAGE_KEY;

  function __snapshot(){
    return {
      v: 1,
      ts: Date.now(),
      page: String(state.page || "000"),
      stats: { ...state.stats },
      meta: state.meta,
      inventory: Array.isArray(state.inventory) ? state.inventory.slice() : [],
      equip: { ...state.equip },
      spellbook: Array.isArray(state.spellbook) ? state.spellbook.slice() : [],
      taken: { ...state.taken },
      maxStrength: Number(state.maxStrength || 0),
    };
  }

  function saveNow(){
    try{
      const snap = __snapshot();
      localStorage.setItem(LS_SAVE, JSON.stringify(snap));
      return true;
    }catch(_){}
    return false;
  }

  function loadNow(){
    let raw = null;
    try{ raw = localStorage.getItem(LS_SAVE); }catch(_){}
    if (!raw) return false;
    try{
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return false;

      // Restore pieces defensively
      if (obj.stats && typeof obj.stats === "object") state.stats = { ...DEFAULT_STATS, ...obj.stats };
      if (typeof obj.maxStrength === "number") state.maxStrength = Math.max(0, obj.maxStrength|0);

      if (Array.isArray(obj.inventory)) state.inventory = obj.inventory.slice(0, 7).concat(Array(Math.max(0, 7-obj.inventory.length)).fill(null)).slice(0,7);
      if (obj.equip && typeof obj.equip === "object") state.equip = { 1: obj.equip[1] ?? null, 2: obj.equip[2] ?? null, 3: obj.equip[3] ?? null };

      if (Array.isArray(obj.spellbook)) state.spellbook = obj.spellbook.slice(0, SPELLBOOK_SLOTS).concat(Array(Math.max(0, SPELLBOOK_SLOTS-obj.spellbook.length)).fill(null)).slice(0,SPELLBOOK_SLOTS);
      if (obj.taken && typeof obj.taken === "object") state.taken = { ...obj.taken };
// NOTE: volumes are NOT stored in save slots; they live in localStorage volume keys.
      // We only re-sync current volumes to PageFlip after loading.
      try{ window.dispatchEvent(new CustomEvent("hero:volume-music", { detail:{ value: musicVolume } })); }catch(err){ logWarn("Stats.json fetch failed", err); }
      try{ window.dispatchEvent(new CustomEvent("hero:volume-sfx", { detail:{ value: sfxVolume } })); }catch(err){ logWarn("Stats.json fetch failed", err); }

      if (obj.page) state.page = String(obj.page);

      // Push UI update immediately
      pushToUI();
      pushInventoryToUI();
      syncUI();
// Ensure background music does not layer on load.
// Music params are NOT loaded from save. We restart the current track cleanly.


// Navigate to saved page
      window.dispatchEvent(new CustomEvent("hero:navigate", { detail:{ page: state.page } }));
      // Restart music cleanly (stop old + start from beginning).
      try{ window.dispatchEvent(new CustomEvent("hero:music-restart")); }catch(err){ logWarn("Stats.json fetch failed", err); }
      return true;
    }catch(_){}
    return false;
  }

  function clearSave(){
    try{ localStorage.removeItem(LS_SAVE); }catch(_){}
  }

window.HeroEngine = Object.freeze({
    state,
    roll2d6,
    roll1d6,
    run: runAction,
    syncUI,
    // Audio
    playMusic,
    stopMusic,
    setMusicVolume,
    getMusicVolume,
    setSfxVolume,
    getSfxVolume,
    getVolumes,
    // Save/Load
    saveNow,
    loadNow,
    clearSave,
    // Soft reset (does not clear save on disk).
    newGame(){ resetToZero(false); },

    register(name, fn){
      const k = String(name||"").trim().toLowerCase();
      if (!k || typeof fn !== "function") return;
      registry[k] = fn;
    }
  });
})();
