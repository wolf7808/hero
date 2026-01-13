// start.js
// Minimal start menu: plain centered words (no background).
// Items are read from Menu.json:
//   {"new":"Новая игра"}, {"save":"Сохранить игру"}, {"load":"Загрузить игру"}, {"options":"Настройки"}
// Clicking dispatches actions / events:
//   new     -> HeroEngine.newGame(); hero:navigate-next
//   save    -> HeroEngine.saveNow()
//   load    -> HeroEngine.loadNow(); hero:navigate to saved page
//   options -> hero:open-options (textfield opens its Options panel)
(() => {
  "use strict";

  const __log = (window.HeroLog && window.HeroLog.make) ? window.HeroLog.make("START") : null;
  function logWarn(...args){ if (__log) __log.warn(...args); else console.warn("[START]", ...args); }
  function logError(...args){ if (__log) __log.error(...args); else console.error("[START]", ...args); }

  const MENU_URL = "./assets/Menu.json";
  const ROOT_ID = "heroStartMenu";

  let labels = Object.create(null);

  // Page readiness: index dispatches hero:page-changed. If user clicks before it arrives,
  // we queue ONE action and execute it right after the first page-changed.
  let __pageReady = false;
  let __pendingAction = null; // () => void
  let __menuRendered = false;

  function esc(s){
    return String(s ?? "").replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
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

  async function loadMenu(){
    try{
      const r = await fetch(MENU_URL + "?v=" + Date.now(), { cache: "no-store" });
      const arr = r.ok ? await r.json() : null;
      if (!Array.isArray(arr) || !arr.length || !validateKeyedArray(arr, "Menu.json")) logWarn("Menu.json: invalid or empty");
      if (Array.isArray(arr)){
        const m = Object.create(null);
        for (const it of arr){
          if (!it || typeof it !== "object") continue;
          const k = Object.keys(it)[0];
          if (!k) continue;
          m[String(k)] = String(it[k] ?? k);
        }
        labels = m;
      }
    }catch(err){ logWarn("Menu.json fetch failed", err); }
  }

  function ensureRoot(){
    let el = document.getElementById(ROOT_ID);
    if (el) return el;

    el = document.createElement("div");
    el.id = ROOT_ID;
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.top = "50%";
    el.style.transform = "translate(-50%, -50%)";
    el.style.zIndex = "10060"; // below help dropdown (10080), above page
    el.style.display = "none";
    el.style.pointerEvents = "auto";
    el.style.textAlign = "center";
    el.style.userSelect = "none";
    document.body.appendChild(el);
    return el;
  }

  function label(k){
    return labels[k] || k;
  }

  function checkMenuVisible(reason, expectVisible){
    const el = document.getElementById(ROOT_ID);
    if (!el){
      if (expectVisible) logError("Start menu root missing", { reason });
      return;
    }

    if (expectVisible && !__menuRendered){
      logWarn("Start menu not rendered yet", { reason });
      ensureRendered();
    }

    const btns = el.querySelectorAll(".startBtn");
    if (expectVisible && btns.length === 0){
      logWarn("Start menu buttons missing", { reason });
      ensureRendered();
      const btnsAfter = el.querySelectorAll(".startBtn");
      if (btnsAfter.length === 0){
        logError("Start menu buttons missing", { reason });
        return;
      }
    }

    if (!expectVisible) return;

    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const hidden = (cs.display === "none") || (cs.visibility === "hidden") || (Number(cs.opacity) === 0) || (rect.width === 0) || (rect.height === 0);
    if (hidden){
      logError("Start menu hidden unexpectedly", {
        reason,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        rect: { w: rect.width, h: rect.height }
      });
    }
  }

  function scheduleMenuCheck(reason, expectVisible){
    requestAnimationFrame(() => {
      try{ checkMenuVisible(reason, expectVisible); }catch(err){ logWarn("Start menu visibility check failed", err); }
    });
  }

  function ensureRendered(){
    if (__menuRendered) return;
    try{ render(); }catch(err){ logWarn("Start menu render failed", err); }
  }


  function runOrQueue(fn){
    if (__pageReady){ try{ fn(); }catch(_){ } return; }
    __pendingAction = fn;
  }

  function render(){
    const el = ensureRoot();
    const items = [
      { k: "new",     t: label("new") },
      { k: "load",    t: label("load") },
      { k: "options", t: label("options") },
    ];

    el.innerHTML = items.map(it =>
      '<div class="startItem">' +
        '<span class="startBtn" data-start-item="' + esc(it.k) + '">' +
          esc(it.t) +
        '</span>' +
      '</div>'
    ).join("");
    __menuRendered = true;

    el.querySelectorAll("[data-start-item]").forEach(node => {
      node.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const k = node.getAttribute("data-start-item") || "";

        if (k === "new"){
          runOrQueue(() => {
            try{ if (window.HeroEngine && window.HeroEngine.newGame) window.HeroEngine.newGame(); }catch(_){ }
            try{ window.dispatchEvent(new CustomEvent("hero:navigate-next")); }catch(_){ }
          });
          return;
        }


        if (k === "load"){
          runOrQueue(() => {
            try{ if (window.HeroEngine && window.HeroEngine.loadNow) window.HeroEngine.loadNow(); }catch(_){ }
          });
          return;
        }

        if (k === "options"){
          runOrQueue(() => { try{ window.dispatchEvent(new CustomEvent("hero:open-options")); }catch(_){ } });
          return;
        }
      });
    });
  }

  function setVisible(v){
    const el = ensureRoot();
    // IMPORTANT: hide with display:none so it can't steal clicks
    el.style.display = v ? "block" : "none";
  }

  // Show only on the first page
  window.addEventListener("hero:page-changed", (e) => {
    __pageReady = true;
    ensureRendered();
    const isFirst = !!(e && e.detail && e.detail.isFirst);
    setVisible(isFirst);
    scheduleMenuCheck("page-changed", isFirst);
    if (__pendingAction){
      const fn = __pendingAction; __pendingAction = null;
      try{ fn(); }catch(_){ }
    }
  });

  async function init(){
    await loadMenu();
    render();
    // Until index dispatches hero:page-changed, keep it visible.
    setVisible(true);
    scheduleMenuCheck("init", true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init().catch(err => logWarn("Start menu init failed", err));
    }, { once:true });
  } else {
    init().catch(err => logWarn("Start menu init failed", err));
  }
})();
