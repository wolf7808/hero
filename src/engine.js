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

  const ASSET_BASE = "./assets/";
  const STATS_META_URL = ASSET_BASE + "Stats.json";
  const ITEMS_URL = ASSET_BASE + "Items.json";

  // Magic tab: fixed number of spell slots
  const SPELLBOOK_SLOTS = 6;

  const TALE_BASE = "./assets/Img/"; // folder where 000.webp, blank.webp, tale*.webp live

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

  let musicVolume = __readVol(LS_MUSIC_VOL, 0.6);
  // NOTE: musicVolume is persisted separately from save/load.
  // Save/Load must NEVER overwrite it; they only restart playback.
  let sfxVolume   = __readVol(LS_SFX_VOL, 0.9);

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

  // ---------- Core actions ----
