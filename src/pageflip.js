// pageflip.links.js (rewrite v2)
// CSS-driven page flip (spine left), under-page visible, flips toward viewer.
// API: HeroPageFlip.create({mount,...}) -> {setPage,setUnder,flipTo,flip,stage}
(() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    mount: null,
    flipMs: 650,
    flipAngleDeg: 78,
    spine: "left",
    soundUrl: "",
    musicUrl: "",
    musicVolume: 0.6,
    imageLoadTimeoutMs: 1200
  });

  function clampNum(v, fb){
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  function el(tag, cls){
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function waitImage(img, timeoutMs){
    return new Promise((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve(true);
      let done = false;

      const onLoad = () => { if (done) return; done = true; cleanup(); resolve(true); };
      const onErr  = () => { if (done) return; done = true; cleanup(); resolve(false); };
      const t = setTimeout(() => { if (done) return; done = true; cleanup(); resolve(false); }, timeoutMs);

      function cleanup(){
        clearTimeout(t);
        img.removeEventListener("load", onLoad);
        img.removeEventListener("error", onErr);
      }

      img.addEventListener("load", onLoad, { once:true });
      img.addEventListener("error", onErr, { once:true });
    });
  }

  function create(userCfg){
    const cfg = { ...DEFAULTS, ...(userCfg || {}) };
    if (!cfg.mount) throw new Error("HeroPageFlip.create: mount is required");

    const mount = cfg.mount;
    mount.innerHTML = "";

    const viewport = el("div", "hpf-viewport");
    const stage = el("div", "hpf-stage");
    const imgUnder = el("img", "hpf-img hpf-img--under");
    const imgCur   = el("img", "hpf-img hpf-img--cur");

    stage.appendChild(imgUnder);
    stage.appendChild(imgCur);
    viewport.appendChild(stage);
    mount.appendChild(viewport);

    const flipMs = Math.max(160, clampNum(cfg.flipMs, 650));
    const angleDeg = Math.max(20, clampNum(cfg.flipAngleDeg, 78));
    const spine = (cfg.spine === "right") ? "right" : "left";

    const origin = (spine === "right") ? "100% 50%" : "0% 50%";
    const sign = (spine === "right") ? 1 : -1; // spine-left => negative = toward viewer

    stage.style.setProperty("--hpf-ms", flipMs + "ms");
    stage.style.setProperty("--hpf-origin", origin);
    stage.style.setProperty("--hpf-angle", (sign * angleDeg) + "deg");

    // audio (gesture unlock required by browser)
    const flipSfx = cfg.soundUrl ? new Audio(cfg.soundUrl) : null;
    if (flipSfx) { flipSfx.preload = "auto"; flipSfx.playsInline = true; }

    const bg = cfg.musicUrl ? new Audio(cfg.musicUrl) : null;
    if (bg) {
      bg.preload = "auto";
      bg.loop = true;
      bg.playsInline = true;
      bg.volume = clampNum(cfg.musicVolume, 0.6);
    }

        const evCtl = new AbortController();
/* ============================================================
       VOLUME BRIDGE (Options UI -> PageFlip)
       ------------------------------------------------------------
       - Music volume controls Maintheme.mp3 (bg)
       - SFX volume controls page flip paper.wav (flipSfx)

       We listen for these events (emitted by engine/options UI):
         - hero:volume-music {detail:{value:0..1}}
         - hero:volume-sfx   {detail:{value:0..1}}

       IMPORTANT: When the audio is not yet unlocked by a gesture,
       changing volume should still update the Audio objects so the
       next play uses correct volume.
       ============================================================ */

    function clamp01(v){
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(1, n));
    }

    window.addEventListener("hero:volume-music", (e) => {
      if (!bg) return;
      const v = e && e.detail ? e.detail.value : undefined;
      try{ bg.volume = clamp01(v); }catch(_){ }
    }, { signal: evCtl.signal });

    window.addEventListener("hero:volume-sfx", (e) => {
      if (!flipSfx) return;
      const v = e && e.detail ? e.detail.value : undefined;
      try{ flipSfx.volume = clamp01(v); }catch(_){ }
    }, { signal: evCtl.signal });

    // Music control (stop/play/restart)
    window.addEventListener("hero:music-stop", () => {
      if (!bg) return;
      try{ bg.pause(); }catch(_){ }
    }, { signal: evCtl.signal });

    window.addEventListener("hero:music-play", () => {
      if (!bg) return;
      unlockFromGesture();
      try{ const p = bg.play(); if (p && p.catch) p.catch(()=>{}); }catch(_){ }
    }, { signal: evCtl.signal });

    window.addEventListener("hero:music-restart", () => {
      if (!bg) return;
      unlockFromGesture();
      try{ bg.pause(); }catch(_){ }
      try{ bg.currentTime = 0; }catch(_){ }
      try{ const p = bg.play(); if (p && p.catch) p.catch(()=>{}); }catch(_){ }
    }, { signal: evCtl.signal });

    let unlocked = false;
    function unlockFromGesture(){
      if (unlocked) return;
      unlocked = true;

      if (flipSfx) {
        try{
          flipSfx.muted = true;
          const p = flipSfx.play();
          if (p && p.then) p.then(() => {
            flipSfx.pause();
            flipSfx.currentTime = 0;
            flipSfx.muted = false;
          }).catch(() => { flipSfx.muted = false; });
        }catch(_){ flipSfx.muted = false; }
      }

      if (bg) {
        try{
          const p = bg.play();
          if (p && p.catch) p.catch(() => {});
        }catch(_){}
      }
    }
    // Unlock audio on the first real user gesture anywhere on the page.
    // We use capture so it fires even if other layers stop propagation.
    window.addEventListener("pointerdown", unlockFromGesture, { passive:true, capture:true });
    window.addEventListener("keydown", unlockFromGesture, { passive:true, capture:true });

    // Initial sync from engine settings (if engine is loaded before PageFlip).
    try{
      if (window.HeroEngine){
        if (typeof window.HeroEngine.getMusicVolume === "function" && bg){
          bg.volume = clamp01(window.HeroEngine.getMusicVolume());
        }
        if (typeof window.HeroEngine.getSfxVolume === "function" && flipSfx){
          flipSfx.volume = clamp01(window.HeroEngine.getSfxVolume());
        }
      }
    }catch(_){}


    function playFlip(){
      if (!flipSfx || !unlocked) return;
      try { flipSfx.currentTime = 0; flipSfx.play().catch(() => {}); } catch(_){}
    }

    let isFlipping = false;
    let curUrl = "";
    let underUrl = "";

    function setUnder(url){
      underUrl = url || "";
      if (underUrl) imgUnder.src = underUrl;
    }

    function setPage(url){
      curUrl = url || "";
      if (curUrl) imgCur.src = curUrl;
      if (!imgUnder.src) imgUnder.src = curUrl;
      stage.classList.remove("hpf-flipping");
    }

    async function flipTo(nextUrl){
      if (isFlipping) return false;
      const url = nextUrl || "";
      if (!url || url === curUrl) return false;

      isFlipping = true;
      unlockFromGesture();

      if (underUrl !== url) setUnder(url);
      await waitImage(imgUnder, clampNum(cfg.imageLoadTimeoutMs, 1200));

      stage.classList.remove("hpf-flipping");
      void stage.offsetWidth;

      playFlip();
      stage.classList.add("hpf-flipping");

      return await new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => finish(true), flipMs + 220);

        function onEnd(e){
          if (e.target !== imgCur) return;
          if (e.animationName !== "hpfFlipCur") return;
          finish(true);
        }

        function finish(ok){
          if (done) return;
          done = true;
          clearTimeout(t);
          imgCur.removeEventListener("animationend", onEnd);

          curUrl = url;
          imgCur.src = curUrl;
          stage.classList.remove("hpf-flipping");
          isFlipping = false;
          resolve(ok);
        }

        imgCur.addEventListener("animationend", onEnd);
      });
    }

    function destroy(){
      try{ evCtl.abort(); }catch(_){ }
      try { if (bg) { bg.pause(); bg.src = ""; } } catch(_){ }
      try { if (flipSfx) { flipSfx.pause(); flipSfx.src = ""; } } catch(_){ }
      mount.innerHTML = "";
    }

    return {
      mount, viewport, stage,
      setPage, setUnder,
      flipTo,
      flip: flipTo,
      unlockAudioFromGesture: unlockFromGesture,
      destroy
    };
  }

  window.HeroPageFlip = { create };
})();
