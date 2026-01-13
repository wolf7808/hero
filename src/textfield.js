// textfield.v2.js (rewrite v3)
// Bottom text panel + top stats panel shell.
// Renders markup: *Label*(TARGET) where TARGET can be:
//   - page id: "-010"
//   - action spec: "luck;-013;-012" or "reac:1;-015;-016" or "battle:[...];WIN;LOSE"
// Optional standalone action after link: (stats) => attached to the single link.
(() => {
  "use strict";

  const __log = (window.HeroLog && window.HeroLog.make) ? window.HeroLog.make("TEXTFIELD") : null;
  function logWarn(...args){ if (__log) __log.warn(...args); else console.warn("[TEXTFIELD]", ...args); }

/* ============================================================
   textfield.v2.js — UI LAYERS + PARSER CONTRACT (added 2026-01-11)
   ------------------------------------------------------------
   RESPONSIBILITIES
   A) Narrative text panel (#textfield)
      - Renders text from Game.json
      - Supports link markup: *Label*(TARGET)
      - Supports "standalone directives" after the link:
          (take:Item_apple)(stats)(-002)
        Those directives are REMOVED from visible text and executed in order.

   B) Stats top panel (#statsfield)
      - Renders stats from engine via HeroTextfield.setStatsValues()
      - Injects the "?" help button (.statsHelp)
      - Uses ONE delegated click handler on #statsfield__inner for "?"

   C) Help system (Menu.json)
      - Click "?" -> dropdown (#heroHelpMenu) with items from:
          HERO_MENU_KEYS = ["character","magic","options"]
      - Click an item -> centered help overlay (#helpfield)
      - When help is open: hide ONLY UI panels (stats/text/start/errors),
        DO NOT hide the page image (#app) so the book remains visible.

   D) Inventory / Spellbook UI (event-driven)
      - Listens for engine event: hero:inventory-changed
      - Updates inventory slots (1..7), equip slots (1..3) and spellbook (1..6)

   CRITICAL POINTER SAFETY
   - "?" button failures are almost always caused by:
       * an overlay left with opacity:0 but still pointer-events:auto
       * a global capture listener calling stopImmediatePropagation()
   - Keep closed overlays display:none (preferred).

   EVENT CONTRACT (this file emits)
   - hero:navigate   { page:"-012" }
   - hero:action     { name:"take:Item_apple" } OR { name:"stats" } OR battle specs
   - hero:stats-help (internal) => opens help dropdown
   ============================================================ */


  const SHOW_DELAY_MS = 1000;
  const TEXT_HEIGHT_FRAC = 0.25;
  const STATS_HEIGHT_FRAC = 0.05;

  let tf, tfInner, sf, sfInner;
  let visible = false;
  let showTimer = 0;

  let statsMeta = null;
  const statsValues = Object.create(null);

  function stageRect(){
    const st = window.__HERO_STAGE || document.querySelector(".hpf-stage");
    if (!st) return null;
    const r = st.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return r;
  }

  function clampWidthToMin(r){
    const width = Math.round(r.width);
    const left = Math.round(r.left);
    return { width, left };
  }

  function escapeHtml(s) {
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
      console.warn(context + " entry is not object at index", i);
      continue;
    }
    const k = Object.keys(obj)[0];
    if (!k) {
      console.warn(context + " entry has no key at index", i);
      continue;
    }
    ok++;
  }
  return ok > 0;
}

  function isActionTarget(t){
    const s = String(t||"").trim();
    // action spec starts with word then ':' or ';'
    return /^[a-zA-Z_][a-zA-Z0-9_]*\s*(?:[:;])/.test(s);
  }


function isPageToken(t){
  const s = String(t||"").trim();
  return /^-\d+$/.test(s);
}

const DIRECTIVE_NAMES = new Set(["stats","take","delete","usage","luck","reac","battle"]);

function isDirectiveToken(t){
  const s = String(t||"").trim();
  if (!s) return false;
  // Action spec: word then ':' or ';' (take:..., reac:..., battle:..., luck;... etc)
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*(?:[:;])/.test(s)) return true;
  // Name-only action like (stats) but only for known directives
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) return DIRECTIVE_NAMES.has(s.toLowerCase());
  // Page token like (-002)
  if (isPageToken(s)) return true;
  return false;
}

function extractStandaloneDirectivesKeepingText(raw){
  // We want to support chains like:
  //   *Label*(take:spell_good)(take:spell_faith)(-002)
  // The extra (...) are directives and MUST NOT appear in the visible text.
  //
  // IMPORTANT: Do NOT remove normal parentheses used as narrative.
  // We only treat (...) as directives if their inside matches isDirectiveToken().
  const str = String(raw||"");

  // Protect link markup "*...*(...)" so we don't treat its "(...)" as standalone.
  const protectedLinks = [];
  const tmp = str.replace(/\*[^*]+\*\([^)]+\)/g, (m) => {
    protectedLinks.push(m);
    return `{{{HERO_LM_${protectedLinks.length-1}}}}`;
  });

  const directives = [];
  // Collect only directive-looking (...) from the non-link parts.
  tmp.replace(/\(([^)]+)\)/g, (_, inner) => {
    const s = String(inner||"").trim();
    if (isDirectiveToken(s)) directives.push(s);
    return _;
  });

  // Build visible text: remove ONLY directive-looking "(...)" from tmp.
  const visibleTmp = tmp.replace(/\(([^)]+)\)/g, (m, inner) => {
    const s = String(inner||"").trim();
    return isDirectiveToken(s) ? "" : m;
  });

  // Restore link markup.
  const visible = visibleTmp.replace(/\{\{\{HERO_LM_(\d+)\}\}\}/g, (m, n) => protectedLinks[Number(n)] || m);

  return { directives, visible };
}



  function buildHtmlFromText(text) {
    const raw = String(text || "");

    const _p = extractStandaloneDirectivesKeepingText(raw);

    const standalone = _p.directives;
    const stripped = _p.visible;
let safe = escapeHtml(stripped);

    const links = [];
    safe = safe.replace(/\*([^*]+)\*\(([^)]+)\)/g, (m, label, target) => {
      const lab = String(label||"").trim();
      const tgt = String(target||"").trim();
      const idx = links.length;
      links.push({ label: lab, target: tgt });
      return `{{{HERO_LINK_${idx}}}}`;
    });

    const attachActions = (links.length === 1 && standalone.length) ? standalone.map(a => String(a||"").trim()).filter(Boolean) : [];
for (let i=0;i<links.length;i++){
      const L = links[i];
      const tgt = L.target;
      const isAct = isActionTarget(tgt);
      const attrs = [];

      if (isAct) attrs.push(`data-action-spec="${escapeHtml(tgt)}"`);
      else attrs.push(`data-page="${escapeHtml(tgt)}"`);

      if (i === 0 && attachActions.length) attrs.push(`data-actions="${escapeHtml(JSON.stringify(attachActions))}"`);
safe = safe.replace(`{{{HERO_LINK_${i}}}}`,
        `<a href="#" class="tf-link" ${attrs.join(" ")}>${escapeHtml(L.label)}</a>`
      );
    }

    return safe;
  }

  function ensure(){
    if (!tf){
      tf = document.getElementById("textfield");
      if (!tf){
        tf = document.createElement("div");
        tf.id = "textfield";
        document.body.appendChild(tf);
      }
    }
    if (!tfInner){
      tfInner = document.getElementById("textfield__inner");
      if (!tfInner){
        tfInner = document.createElement("div");
        tfInner.id = "textfield__inner";
        tf.appendChild(tfInner);
      }
    }

    if (!sf){
      sf = document.getElementById("statsfield");
      if (!sf){
        sf = document.createElement("div");
        sf.id = "statsfield";
        document.body.appendChild(sf);
      }
    }
    if (!sfInner){
      sfInner = document.getElementById("statsfield__inner");
      if (!sfInner){
        sfInner = document.createElement("div");
        sfInner.id = "statsfield__inner";
        sf.appendChild(sfInner);
      }
    }

    if (!tfInner.__heroBound){
      tfInner.__heroBound = true;

      // Scroll 1 line per wheel notch
      tfInner.addEventListener("wheel", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const lh = parseFloat(getComputedStyle(tfInner).lineHeight) || 18;
        const dir = e.deltaY > 0 ? 1 : (e.deltaY < 0 ? -1 : 0);
        if (dir) tfInner.scrollTop += dir * lh;
      }, { passive:false });

      tfInner.addEventListener("click", (e) => {
        const a = e.target && e.target.closest ? e.target.closest("a.tf-link") : null;
        if (!a) return;

        e.preventDefault();
        e.stopPropagation();

        const actionSpec = a.getAttribute("data-action-spec") || "";
        const page = a.getAttribute("data-page") || "";
        const actionsJson = a.getAttribute("data-actions") || "";

        
// Action-spec link (luck/reac/battle OR take:...):
// If there are attached directives (data-actions), we must run:
//   [actionSpec] + actionsJson sequentially (supports chains like take...take...(-002))
if (actionSpec){
  const run = [String(actionSpec).trim()];
  if (actionsJson){
    try{
      const arr = JSON.parse(actionsJson);
      if (Array.isArray(arr)) for (const x of arr) run.push(String(x||"").trim());
    }catch(_){}
  }
  for (const token of run){
    if (!token) continue;
    if (isPageToken(token)){
      window.dispatchEvent(new CustomEvent("hero:navigate", { detail: { page: token } }));
      return;
    }
    window.dispatchEvent(new CustomEvent("hero:action", { detail: { name: token } }));
  }
  return;
}
// Normal link: optional *multiple* standalone actions, then navigation.
// Example in Game.json:
//   (take:spell_good)(take:spell_faith)(-002)
// We must execute ALL directives in order.
// Compatibility: older builds used data-action (single). New builds use data-actions (JSON array).
const legacyAction = a.getAttribute("data-action") || "";
if (actionsJson || legacyAction){
  try{
    const arr = actionsJson ? JSON.parse(actionsJson) : [legacyAction];
    if (Array.isArray(arr) && arr.length){
      for (let i=0;i<arr.length;i++){
        const nm = String(arr[i]||"").trim();
        if (!nm) continue;
        // Only the last action receives page fallback so navigation happens last.
        if (i === arr.length - 1){
          window.dispatchEvent(new CustomEvent("hero:action", { detail: { name: nm, page } }));
          if (String(nm).toLowerCase() === "stats") return;
        }else{
          window.dispatchEvent(new CustomEvent("hero:action", { detail: { name: nm } }));
        }
      }
      // After actions, navigation may already happen via engine using page fallback.
      // But if page is a normal page link, we still handle it below.
    }
  }catch(_){}
}
        if (page){
          window.dispatchEvent(new CustomEvent("hero:navigate", { detail: { page } }));
        }
      });
    }

    if (!sfInner.__heroBound){
      sfInner.__heroBound = true;
      
/* ============================================================
   "?" HELP BUTTON: CLICK ROUTE + GUARANTEES (DO NOT BREAK)
   ------------------------------------------------------------
   The "?" button is not bound directly; instead:
     - renderStats() injects: <button class="statsHelp" data-stat-help="1">?</button>
       into #statsfield__inner (sfInner). 
     - We attach ONE delegated click handler on sfInner (below).
       It uses closest("[data-stat-help]") so clicks on the button
       (or its descendants) still work.
     - Handler does:
         e.preventDefault(); e.stopPropagation();
         window.dispatchEvent(new CustomEvent("hero:stats-help"));
       

   WHY THIS MUST STAY CLICKABLE:
     In previous iterations, overlays / containers accidentally
     intercepted pointer events. The symptoms: "?" visually there
     but click never reaches this handler.

   RULES (when editing CSS/DOM later):
     1) NEVER put any element above #statsfield with pointer-events:auto
        unless it really needs to intercept clicks.
        If you add decorative layers (vignette, shadows, etc) ABOVE,
        give them: pointer-events:none.
     2) Keep #statsfield and .statsHelp pointer-events:auto (CSS already
        sets it). 
     3) If you add global capture handlers (document/window pointerdown,
        touchstart, etc), DO NOT call stopImmediatePropagation() for
        normal clicks. If you must, whitelist clicks inside:
           if (e.target.closest("#statsfield")) return;
     4) Z-INDEX ORDER MUST REMAIN CONSISTENT:
          #statsfield z-index: 10001 (CSS) 
          help dropdown z-index: 10060 (CSS/JS) 
          help overlay  z-index: 10055 (CSS) 
          battlefield   z-index: 10050 (CSS) 
        The code intentionally refuses to open help during battle
        (__battleActive()) to avoid z-index fights. 
   ============================================================ */

      sfInner.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("[data-stat-help]") : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("hero:stats-help"));
      });
    }
  }

  function sync(){
    ensure();
    const r = stageRect();
    if (!r) return;

    const textH = Math.max(80, Math.round(r.height * TEXT_HEIGHT_FRAC));
    const dim = clampWidthToMin(r);
    const tfTop = Math.round(r.bottom - textH);
    const tfHeight = Math.max(80, Math.round(window.innerHeight - tfTop));
    tf.style.width = dim.width + "px";
    tf.style.height = tfHeight + "px";
    tf.style.left = dim.left + "px";
    tf.style.top = tfTop + "px";

    const statsH = Math.max(30, Math.round(r.height * STATS_HEIGHT_FRAC));
    sf.style.width = dim.width + "px";
    sf.style.height = statsH + "px";
    sf.style.left = dim.left + "px";
    sf.style.top = Math.round(r.top) + "px";
  }

  function forceScrollTop(){
    if (!tfInner) return;
    tfInner.scrollTop = 0;
    requestAnimationFrame(() => { if (tfInner) tfInner.scrollTop = 0; });
    setTimeout(() => { if (tfInner) tfInner.scrollTop = 0; }, 80);
    setTimeout(() => { if (tfInner) tfInner.scrollTop = 0; }, 220);
  }

  function onPageText(text){
    ensure();
    tfInner.innerHTML = buildHtmlFromText(text);
    forceScrollTop();
  }

  function setStatsMeta(meta){
    ensure();
    if (!Array.isArray(meta)) return;
    statsMeta = meta.map(m => ({ key: String(m.key), label: String(m.label ?? m.key) }));
    for (const m of statsMeta) if (!(m.key in statsValues)) statsValues[m.key] = 0;
    renderStats();
  }

  function setStatsValues(patch){
    ensure();
    if (!patch || typeof patch !== "object") return;
    for (const k of Object.keys(patch)) statsValues[k] = patch[k];
    renderStats();
  }

  function renderStats(){
    if (!sfInner) return;
    const meta = statsMeta || [
      { key: "Strength", label: "Strength" },
      { key: "Dexterity", label: "Dexterity" },
      { key: "Charisma", label: "Charisma" },
      { key: "Reaction", label: "Reaction" },
      { key: "Luck", label: "Luck" }
    ];

    const parts = [];
    parts.push(`<button class="statsHelp" type="button" data-stat-help="1" aria-label="info">?</button>`);
    for (const m of meta){
      const v = (statsValues[m.key] ?? 0);
      parts.push(
        `<span class="stat"><span class="stat__k">${escapeHtml(m.label)} </span><span class="stat__v" data-stat-val="${escapeHtml(m.key)}">${escapeHtml(v)}</span></span>`
      );
    }
    sfInner.innerHTML = parts.join("");
  }

  
/* ============================================================
   TEXTFIELD/STATSFIELD VISIBILITY LIFECYCLE (DO NOT BREAK)
   ------------------------------------------------------------
   There are TWO UI panels created/managed here:
     - #statsfield (top)  : created in ensure(), positioned in sync()
     - #textfield (bottom): created in ensure(), positioned in sync()
   Positioning uses the pageflip stage rect:
     stageRect() reads window.__HERO_STAGE or ".hpf-stage" bounds. 

   Visibility is controlled by:
     - showNow(): immediate show (display="block" + .is-visible class)
     - hide():   immediate hide (display="none" + remove .is-visible)
     - showAfter(ms): hide is usually done elsewhere (index60.html),
                     then we schedule showNow() after flip delay. 
     - schedule(): re-sync size/position on resize ONLY when visible=true.

   IMPORTANT CONSEQUENCES:
     - If you later replace "display:none" with "visibility:hidden" or "opacity:0",
       you MUST think about pointer events: invisible overlays can still block clicks.
     - Keeping display:none is safest: it removes the element from hit-testing.
     - Any new overlay (help/battle/modals) should hide these panels by setting
       display:none and restoring previous display values (see __hideUiPanels and
       engine.js setNonBattleFieldsHidden). 
   ============================================================ */
  function showNow(){
    ensure();
    sync();
    sf.classList.add("is-visible");
    tf.classList.add("is-visible");
    sf.style.display = "block";
    tf.style.display = "block";
    visible = true;
    forceScrollTop();
  }

  function hide(){
    if (!tf || !sf) return;
    sf.classList.remove("is-visible");
    tf.classList.remove("is-visible");
    sf.style.display = "none";
    tf.style.display = "none";
    visible = false;
  }

  function showAfter(ms){
    ensure();
    sync();
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(showNow, Math.max(0, ms|0));
  }

  function onFirstFlip(){ showAfter(SHOW_DELAY_MS); }

  let rafPend = false;
  function schedule(){
    if (!visible) return;
    if (rafPend) return;
    rafPend = true;
    requestAnimationFrame(() => { rafPend = false; sync(); });
  }

  window.addEventListener("resize", schedule, { passive:true });
  window.addEventListener("orientationchange", () => setTimeout(schedule, 80), { passive:true });
  if (window.visualViewport){
    window.visualViewport.addEventListener("resize", schedule, { passive:true });
    window.visualViewport.addEventListener("scroll", schedule, { passive:true });
  }

  window.HeroTextfield = {
    onFirstFlip,
    onPageText,
    sync,
    show: showNow,
    hide,
    showAfter,
    forceScrollTop,
    setStatsMeta,
    setStatsValues
  };



/* ============================================================
   HELP SYSTEM OVERVIEW (linked to the "?" button)
   ------------------------------------------------------------
   1) User clicks "?" (statsHelp button) -> delegated handler
      dispatches: hero:stats-help. 

   2) This file listens to hero:stats-help (see below in HELP MENU section)
      and opens a small dropdown menu near the "?" button:
        __openMenu() creates #heroHelpMenu and positions it relative to "?".
        It clamps inside #statsfield bounds to prevent it from going outside
        the top panel. 

   3) Clicking a dropdown item opens #helpfield (centered overlay):
        __openHelp(key) does:
          - refuses if battle is active (__battleActive()).
          - closes dropdown
          - hides ONLY UI panels (stats/text/start/errors) via __hideUiPanels(true)
            while keeping #app visible (background page stays). 
          - positions #helpfield using battlefield rect when possible, else stage rect.
        Closing help restores UI panels via __hideUiPanels(false). 

   WHY THIS MATTERS FOR CLICK SAFETY:
     - helpfield/menu sit ABOVE statsfield in z-index and they DO accept clicks.
       When closed, they MUST be display:none, otherwise they can steal clicks.
     - __hideUiPanels stores/restores previous display values to avoid messing
       with showAfter()/hide() timing logic.
   ============================================================ */

/* ================= HELP MENU (Menu.json) =================
   - Uses Menu.json (NOT Stats.json)
   - Click "?" => dropdown (character/magic/options)
   - Click item => centered help field overlay
   - Keeps background/page image visible (does NOT hide #app)
   - Hides only UI panels (statsfield/textfield/start button/errors)
   - Help field width matches battlefield when available
=========================================================== */

const HERO_MENU_URL = (() => {
  try{
    if (window.HERO_ASSET_BASE) {
      const base = String(window.HERO_ASSET_BASE);
      return (base.endsWith("/") ? base : base + "/") + "Menu.json";
    }
  }catch(_){ }
  return "./assets/Menu.json";
})();
const HERO_MENU_KEYS = ["character","magic","options"];
const HERO_MENU_FALLBACK = {};

let __heroMenuLabels = null;   // {key: label}
let __heroMenuEl = null;       // dropdown
let __heroHelpEl = null;       // overlay
let __heroHelpInner = null;
let __heroHelpOpen = false;
let __heroHelpKey = "";
let __menuLoadPromise = null;

function __ensureMenuLabels(){
  if (!__menuLoadPromise) __menuLoadPromise = __loadMenuJson();
  return __menuLoadPromise;
}


//
// ================= INVENTORY VIEWMODEL (from engine.js) =================
// We render the Character panel from a *view model* sent by engine.js via
// CustomEvent("hero:inventory-changed").
//
// Why event-based?
//   - Keeps UI decoupled from engine internal state.
//   - Prevents accidental breakage if engine state shape changes.
//   - Allows future overlays (battle/help/etc.) without importing engine.
//
// The view model shape (see engine.js buildInventoryView()):
//   { slots:[{slot,id,label,type,option}], equip:{1:{...},2:{...},3:{...}}, maxStrength:number }
// =======================================================================
let __heroInvView = { slots: [], equip: {1:{},2:{},3:{}}, spellbook: [], maxStrength: 0 };


function __clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }

function __battleActive(){
  const bf = document.getElementById("battlefield");
  if (bf && bf.style.display !== "none") return true;
  try{
    return !!(window.HeroEngine && window.HeroEngine.state && window.HeroEngine.state.mode === "BATTLE");
  }catch(_){}
  return false;
}

async function __loadMenuJson(){
  if (__heroMenuLabels) return __heroMenuLabels;
  const labels = Object.create(null);
  try{
    const r = await fetch(HERO_MENU_URL + "?v=" + Date.now(), { cache: "no-store" });
    if (r.ok){
      const arr = await r.json();
      if (!Array.isArray(arr) || !arr.length || !validateKeyedArray(arr, "Menu.json")) logWarn("Menu.json: invalid or empty");
      if (Array.isArray(arr)){
        for (const obj of arr){
          if (!obj || typeof obj !== "object") continue;
          const k = Object.keys(obj)[0];
          if (!k) continue;
          labels[String(k)] = String(obj[k] ?? k);
        }
      }
    }
  }catch(_){}
  __heroMenuLabels = labels;
  return labels;
}

function __menuLabel(k){
  if (__heroMenuLabels && !__heroMenuLabels.__validated){
    const required = ["new","save","load","options","music","sfx","character","magic","delete","usage","stats","inventory","equipment","equip1","equip2","equip3","maxStrength"];
    const missing = required.filter(k => !(__heroMenuLabels && k in __heroMenuLabels));
    if (missing.length) logWarn("Menu.json: missing keys", missing);
    __heroMenuLabels.__validated = true;
  }
  k = String(k||"");
  if (__heroMenuLabels && k in __heroMenuLabels) return __heroMenuLabels[k];
  return HERO_MENU_FALLBACK[k] || k;
}

function __ensureMenuDom(){
  ensure(); // ensure sfInner exists
  if (!__heroMenuEl){
    __heroMenuEl = document.createElement("div");
    __heroMenuEl.id = "heroHelpMenu";
    __heroMenuEl.className = "helpMenu";
    __heroMenuEl.style.display = "none";
    document.body.appendChild(__heroMenuEl);
  }
  if (!__heroHelpEl){
    __heroHelpEl = document.createElement("div");
    __heroHelpEl.id = "helpfield";
    __heroHelpEl.innerHTML = '<div id="helpfield__inner"></div>';
    document.body.appendChild(__heroHelpEl);
    __heroHelpInner = __heroHelpEl.querySelector("#helpfield__inner");
    // Minimal inline styling so it is visible even if CSS wasn't updated
    __applyBattleLook(__heroHelpEl);
  }
}

function __applyBattleLook(el){
  // Try to copy visual look from battlefield; fallback to baked style.
  const bf = document.getElementById("battlefield");
  if (bf){
    const cs = window.getComputedStyle(bf);
    // Copy only key visuals (background, borders, radius, shadow)
    el.style.borderRadius = cs.borderRadius || "10px";
    el.style.background = cs.background || "";
    el.style.boxShadow = cs.boxShadow || "";
    el.style.backdropFilter = cs.backdropFilter || "";
    el.style.border = cs.border || "";
    // Some setups use background-image layers, computedStyle.background may be empty.
    if (!el.style.background || el.style.background === "rgba(0, 0, 0, 0)"){
      // fallback
      el.style.background =
        "repeating-linear-gradient(45deg, rgba(0,0,0,0.09) 0px, rgba(0,0,0,0.09) 2px, rgba(0,0,0,0.00) 2px, rgba(0,0,0,0.00) 8px), rgba(246, 240, 228, 0.72)";
    }
    if (!el.style.boxShadow){
      el.style.boxShadow =
        "0 10px 30px rgba(0,0,0,0.25), inset 0 0 0 2px rgba(0,0,0,0.55), inset 0 0 0 5px rgba(0,0,0,0.18)";
    }
    return;
  }
  // baked fallback (same as battlefield style in your CSS)
  el.style.borderRadius = "10px";
  el.style.background =
    "repeating-linear-gradient(45deg, rgba(0,0,0,0.09) 0px, rgba(0,0,0,0.09) 2px, rgba(0,0,0,0.00) 2px, rgba(0,0,0,0.00) 8px), rgba(246, 240, 228, 0.72)";
  el.style.boxShadow =
    "0 10px 30px rgba(0,0,0,0.25), inset 0 0 0 2px rgba(0,0,0,0.55), inset 0 0 0 5px rgba(0,0,0,0.18)";
  el.style.backdropFilter = "blur(3px)";
}

function __getBattleRect(){
  const bf = document.getElementById("battlefield");
  if (bf){
    const r = bf.getBoundingClientRect();
    if (r.width > 10 && r.height > 10) return r;
  }
  // fallback to stage rect from existing helper
  const r2 = stageRect();
  if (r2) return r2;
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function __hideUiPanels(hide){
  // Hide panels, but keep #app visible so page image remains.
  const ids = ["statsfield","textfield","startGameBtn","err"];
  for (const id of ids){
    const el = document.getElementById(id);
    if (!el) continue;
    if (hide){
      if (el.dataset.prevHelpDisp === undefined) el.dataset.prevHelpDisp = el.style.display || "";
      el.style.display = "none";
    } else {
      const prev = el.dataset.prevHelpDisp !== undefined ? el.dataset.prevHelpDisp : "";
      el.style.display = prev;
      delete el.dataset.prevHelpDisp;
    }
  }
}

function __positionHelp(rect){
  const isOpt = (__heroHelpKey === "options");
  const h = Math.round(rect.height * (isOpt ? 0.62 : 0.56));
  const dim = clampWidthToMin(rect);
  __heroHelpEl.style.left = dim.left + "px";
  __heroHelpEl.style.width = dim.width + "px";
  __heroHelpEl.style.height = Math.round(h) + "px";
  __heroHelpEl.style.top = Math.round(rect.top + (rect.height - h)/2) + "px";
}

function __scheduleHelpRender(key){
  if (!__heroHelpOpen) return;
  const k = String(key || __heroHelpKey || "");
  if (!k) return;
  if (__heroHelpEl && __heroHelpEl.__renderRaf) cancelAnimationFrame(__heroHelpEl.__renderRaf);
  __heroHelpEl.__renderRaf = requestAnimationFrame(() => {
    if (!__heroHelpOpen) return;
    __renderHelp(k);
  });
}

function __helpTitle(key, style){
  const s = style ? ' style="' + style + '"' : "";
  return '<div class="helpSectionTitle"' + s + '>' + escapeHtml(__menuLabel(key)) + '</div>';
}
function __equipRow(key, value){
  return '<div class="equipRow"><div class="equipK">' + escapeHtml(__menuLabel(key)) + ':</div><div class="equipV">' + escapeHtml(value) + '</div></div>';
}
function __renderHelp(key){
  const title = __menuLabel(key);
  if (__heroHelpEl){
    __heroHelpEl.classList.remove("help--options");
    __heroHelpEl.classList.remove("help--character");
    if (key === "options") __heroHelpEl.classList.add("help--options");
    if (key === "character") __heroHelpEl.classList.add("help--character");
  }

  // IMPORTANT:
  //  - For simple text bodies we use escapeHtml().
  //  - For the Character panel we render structured HTML and attach click handlers.
  //    Do NOT wrap it in escapeHtml or all buttons will break.

  let bodyHtml = null;
  let bodyText = "...";

  if (key === "character"){
    // Build left stats column (vertical list)
    const meta = (typeof statsMeta !== "undefined" && Array.isArray(statsMeta) && statsMeta.length)
      ? statsMeta
      : [
          { key: "Strength", label: "Strength" },
          { key: "Dexterity", label: "Dexterity" },
          { key: "Charisma", label: "Charisma" },
          { key: "Reaction", label: "Reaction" },
          { key: "Luck", label: "Luck" }
        ];

    const statLines = meta.map(m => {
      const v = (typeof statsValues !== "undefined") ? (statsValues[m.key] ?? 0) : 0;
      return (
        '<div class="charStatRow">' +
          '<div class="charStatK">' + escapeHtml(m.label ?? m.key) + '</div>' +
          '<div class="charStatV">' + escapeHtml(v) + '</div>' +
        '</div>'
      );
    }).join("");

    // Build right inventory column (7 slots)
    const slots = (__heroInvView && Array.isArray(__heroInvView.slots)) ? __heroInvView.slots : [];
    const equip = (__heroInvView && __heroInvView.equip) ? __heroInvView.equip : {};
    const maxS = Number((__heroInvView && __heroInvView.maxStrength) || 0);

    const invRows = [];
    for (let i = 1; i <= 7; i++){
      const it = slots.find(s => (s && s.slot === i)) || null;
      const has = it && it.id;
      const label = has ? (it.label || it.id) : "";
      const type = has ? String(it.type||"") : "";

      // Actions:
      // - delete always exists for backpack items (except empty)
      // - usage exists ONLY for food
      // - equip items have no actions (they are displayed in equip slots)
      let actions = "";
      if (has && type !== "equip"){
        const delLabel = __menuLabel("delete");
        actions += '<button type="button" class="invBtn invBtn--del" data-hero-action="delete:' + i + '">' + escapeHtml(delLabel) + '</button>';
        if (type === "food"){
          const useLabel = __menuLabel("usage");
          actions += '<button type="button" class="invBtn invBtn--use" data-hero-action="usage:' + i + '">' + escapeHtml(useLabel) + '</button>';
        }
      }

      invRows.push(
        '<div class="invRow">' +
          '<div class="invSlot">' + i + '.</div>' +
          '<div class="invName">' + escapeHtml(label) + '</div>' +
          '<div class="invActions">' + actions + '</div>' +
        '</div>'
      );
    }

    const eq1 = equip && equip[1] && equip[1].id ? (equip[1].label || equip[1].id) : "";
    const eq2 = equip && equip[2] && equip[2].id ? (equip[2].label || equip[2].id) : "";
    const eq3 = equip && equip[3] && equip[3].id ? (equip[3].label || equip[3].id) : "";

    bodyHtml =
      '<div class="helpCharGrid">' +
        '<div class="helpCharCol helpCharCol--stats">' +
          __helpTitle("stats") +
          '<div class="charStats">' + statLines + '</div>' +
          (maxS ? ('<div class="charHint">' + escapeHtml(__menuLabel("maxStrength")) + ': ' + escapeHtml(maxS) + '</div>') : '') +
        '</div>' +

        '<div class="helpCharCol helpCharCol--inv">' +
          __helpTitle("inventory") +
          '<div class="invList">' + invRows.join("") + '</div>' +

          __helpTitle("equipment", 'margin-top:10px;') +
          '<div class="equipList">' +
            __equipRow("equip1", eq1) +
            __equipRow("equip2", eq2) +
            __equipRow("equip3", eq3) +
          '</div>' +
        '</div>' +
      '</div>';

  } else if (key === "magic"){
  // Magic panel: 6 spellbook slots rendered like inventory rows.
  const spells = (__heroInvView && Array.isArray(__heroInvView.spellbook)) ? __heroInvView.spellbook : [];

  const rows = [];
  for (let i = 1; i <= 6; i++){
    const it = spells.find(s => (s && s.slot === i)) || null;
    const has = it && it.id;
    const label = has ? (it.label || it.id) : "";
    rows.push(
      '<div class="magicRow">' +
        '<div class="magicIdx">' + i + '.</div>' +
        '<div class="magicName">' + escapeHtml(label) + '</div>' +
      '</div>'
    );
  }

  bodyHtml =
    '<div class="magicPanel">' +
      '<div class="magicHeader">' + escapeHtml(title) + '</div>' +
      '<div class="magicList">' + rows.join("") + '</div>' +
    '</div>';

  bodyText = "";
} else if (key === "options"){
      // Options panel: volume sliders + save/load buttons.
      // IMPORTANT: Keep this HTML simple and "click-safe".
      // - We use <input type="range"> which is inherently pointer-events safe.
      // - We do NOT overlay any full-screen elements besides the existing help backdrop.
      const mv = (window.HeroEngine && window.HeroEngine.getMusicVolume) ? window.HeroEngine.getMusicVolume() : 1;
      const sv = (window.HeroEngine && window.HeroEngine.getSfxVolume) ? window.HeroEngine.getSfxVolume() : 1;

      const lblSave = __menuLabel("save");
      const lblLoad = __menuLabel("load");

      bodyHtml = `
        <div class="optPanel">
          <div class="optRow">
            <div class="optLabel">${escapeHtml(__menuLabel("music"))}</div>
            <input type="range" min="0" max="1" step="0.01" value="${Number(mv) || 0}" data-opt="music">
            <div class="optVal" data-optval="music">${Math.round((Number(mv)||0)*100)}%</div>
          </div>

          <div class="optRow">
            <div class="optLabel">${escapeHtml(__menuLabel("sfx"))}</div>
            <input type="range" min="0" max="1" step="0.01" value="${Number(sv) || 0}" data-opt="sfx">
            <div class="optVal" data-optval="sfx">${Math.round((Number(sv)||0)*100)}%</div>
          </div>

          <div class="optBtns">
            <button type="button" class="optBtn" data-optbtn="save">${escapeHtml(lblSave)}</button>
            <button type="button" class="optBtn" data-optbtn="load">${escapeHtml(lblLoad)}</button>
          </div>
        </div>
      `;
    }

  __heroHelpInner.innerHTML =
    '<div class="helpHeader">' +
      '<div class="helpTitle">' + escapeHtml(title) + '</div>' +
      '<button class="helpClose" type="button" aria-label="close">X</button>' +
    '</div>' +
    '<div class="helpBody">' +
      (bodyHtml != null ? bodyHtml : escapeHtml(bodyText)) +
    '</div>';

  const closeBtn = __heroHelpInner.querySelector(".helpClose");
  if (closeBtn) closeBtn.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); __closeHelp(); });



  // Options panel wiring (volume sliders + save/load)
  if (key === "options"){
    const mInp = __heroHelpInner.querySelector('input[data-opt="music"]');
    const sInp = __heroHelpInner.querySelector('input[data-opt="sfx"]');
    const mVal = __heroHelpInner.querySelector('[data-optval="music"]');
    const sVal = __heroHelpInner.querySelector('[data-optval="sfx"]');

    function pct(v){ return Math.round((Number(v)||0) * 100) + "%"; }

    if (mInp){
      mInp.addEventListener("input", () => {
        const v = Number(mInp.value);
        if (mVal) mVal.textContent = pct(v);
        try{
          if (window.HeroEngine && window.HeroEngine.setMusicVolume) window.HeroEngine.setMusicVolume(v);
          // If music was blocked by autoplay, this user gesture is a good moment to (re)start it.
          if (window.HeroEngine && window.HeroEngine.playMusic) window.HeroEngine.playMusic();
          else window.dispatchEvent(new CustomEvent("hero:set-music-volume", { detail:{ value:v } }));
        }catch(_){}
      });
    }

    if (sInp){
      sInp.addEventListener("input", () => {
        const v = Number(sInp.value);
        if (sVal) sVal.textContent = pct(v);
        try{
          if (window.HeroEngine && window.HeroEngine.setSfxVolume) window.HeroEngine.setSfxVolume(v);
          else window.dispatchEvent(new CustomEvent("hero:set-sfx-volume", { detail:{ value:v } }));
        }catch(_){}
      });
    }

    const bSave = __heroHelpInner.querySelector('[data-optbtn="save"]');
    const bLoad = __heroHelpInner.querySelector('[data-optbtn="load"]');

    if (bSave) bSave.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      try{ if (window.HeroEngine && window.HeroEngine.saveNow) window.HeroEngine.saveNow(); }catch(_){}
    });

    if (bLoad) bLoad.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      let ok = false;
      try{ ok = !!(window.HeroEngine && window.HeroEngine.loadNow && window.HeroEngine.loadNow()); }catch(err){ logWarn("Load failed", err); }
      if (ok){
        __closeHelp();
      }
    });
  }

  // Delegate inventory actions to engine via the same hero:action pathway that
  // page text links use. This keeps all game logic in engine.js.
  __heroHelpInner.querySelectorAll("[data-hero-action]").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const spec = btn.getAttribute("data-hero-action") || "";
      if (!spec) return;
      window.dispatchEvent(new CustomEvent("hero:action", { detail:{ name: spec } }));
    });
  });
}



function __openHelp(key){
  if (__battleActive()) return;
  __ensureMenuDom();
  __heroHelpOpen = true;
  __heroHelpKey = String(key||"");
  __ensureMenuLabels().finally(() => {
    if (__heroHelpOpen && __heroHelpKey === String(key||"")) __scheduleHelpRender(key);
  });

  const rect = __getBattleRect(); // compute before hiding
  __closeMenu();
  __hideUiPanels(true);

  __applyBattleLook(__heroHelpEl);
  __positionHelp(rect);
  __heroHelpEl.style.display = "block";
  __scheduleHelpRender(key);

  const onResize = () => { if (__heroHelpOpen) __positionHelp(__getBattleRect()); };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  __heroHelpEl.__onResize = onResize;

  const onKey = (e) => { if (__heroHelpOpen && e.key === "Escape") __closeHelp(); };
  window.addEventListener("keydown", onKey);
  __heroHelpEl.__onKey = onKey;
}

function __closeHelp(){
  __heroHelpOpen = false;
  __heroHelpKey = "";
  if (__heroHelpEl && __heroHelpEl.__onResize){
    window.removeEventListener("resize", __heroHelpEl.__onResize);
    window.removeEventListener("orientationchange", __heroHelpEl.__onResize);
    __heroHelpEl.__onResize = null;
  }
  if (__heroHelpEl && __heroHelpEl.__onKey){
    window.removeEventListener("keydown", __heroHelpEl.__onKey);
    __heroHelpEl.__onKey = null;
  }
  if (__heroHelpEl){
    __heroHelpEl.style.display = "none";
    if (__heroHelpInner) __heroHelpInner.innerHTML = "";
  }
  __hideUiPanels(false);
}

function __openMenu(){
  if (__battleActive()) return;
  __ensureMenuDom();
  __ensureMenuLabels().finally(() => {
    // Build dropdown items
    __heroMenuEl.innerHTML = HERO_MENU_KEYS.map(k =>
      '<button type="button" class="helpMenu__item" data-k="' + escapeHtml(k) + '">' +
        escapeHtml(__menuLabel(k)) +
      '</button>'
    ).join("");
    __heroMenuEl.style.display = "block";

    // Position: anchor to "?" and clamp inside statsfield
    const btn = sfInner ? sfInner.querySelector("[data-stat-help]") : null;
    const sf = document.getElementById("statsfield");
    const bounds = sf ? sf.getBoundingClientRect() : __getBattleRect();

    let left = bounds.left;
    let top = bounds.top + bounds.height;
    if (btn){
      const r = btn.getBoundingClientRect();
      left = r.left;
      top = r.bottom + 6;
    }

    const mw = __heroMenuEl.offsetWidth || 180;
    left = __clamp(left, bounds.left, bounds.left + bounds.width - mw);

    __heroMenuEl.style.left = Math.round(left) + "px";
    __heroMenuEl.style.top  = Math.round(top) + "px";

    __heroMenuEl.querySelectorAll("[data-k]").forEach(b=>{
      b.addEventListener("click", (e)=>{
        e.preventDefault(); e.stopPropagation();
        const key = b.getAttribute("data-k") || "";
        __openHelp(key);
      });
    });

    // outside click closes
    const onDoc = (e) => {
      if (!__heroMenuEl) return;
      if (e.target && (__heroMenuEl.contains(e.target) || (sfInner && sfInner.contains(e.target)))) return;
      __closeMenu();
    };
    setTimeout(() => document.addEventListener("pointerdown", onDoc, { capture:true, once:true }), 0);
  });
}

function __closeMenu(){
  if (!__heroMenuEl) return;
  __heroMenuEl.style.display = "none";
  __heroMenuEl.innerHTML = "";
}


// Inventory updates from engine
window.addEventListener("hero:inventory-changed", (e) => {
  const d = e && e.detail ? e.detail : null;
  if (!d || typeof d !== "object") return;
  __heroInvView = d;
  if (__heroHelpOpen && __heroHelpInner && __heroHelpKey === "character"){
    __scheduleHelpRender("character");
    return;
  }
});

// Toggle dropdown on existing event fired by "?" button
window.addEventListener("hero:stats-help", () => {
  if (__battleActive()) return;
  __ensureMenuDom();
  if (__heroMenuEl && __heroMenuEl.style.display === "block") __closeMenu();
  else __openMenu();
});

// Allow other modules (start menu) to open Options directly.
window.addEventListener("hero:open-options", () => {
  try{ __openHelp("options"); }catch(_){}
});

// expose for debug (optional)
window.HeroHelp = { open: __openHelp, close: __closeHelp };
/* ================= END HELP MENU ================= */

})();

