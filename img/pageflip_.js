/* pageflip.js
 * эффект перелистывания + аудио.
 *
 * API:
 *   const pf = HeroPageFlip.create({ mount, soundUrl, musicUrl, ... });
 *   pf.setPage(url);            // установить текущую картинку (без анимации)
 *   await pf.flip(nextUrl);     // перелистнуть на nextUrl (с анимацией + аудио)
 *   pf.destroy();
 */
(() => {
  "use strict";

  const DEFAULTS = {
    mount: null,

    flipMs: 650,
    flipAngleDeg: 78,
    spine: "left", // 'left' => справа->налево

    soundUrl: "",
    musicUrl: "",
    musicVolume: 0.6,

    imageLoadTimeoutMs: 450,
  };

  function clampNumber(n, fallback) {
    const x = Number(n);
    return Number.isFinite(x) ? x : fallback;
  }

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function waitImageReady(img, timeoutMs) {
    return new Promise((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve(true);

      let done = false;
      const onLoad = () => { if (done) return; done = true; cleanup(); resolve(true); };
      const onErr  = () => { if (done) return; done = true; cleanup(); resolve(false); };
      const t = setTimeout(() => { if (done) return; done = true; cleanup(); resolve(false); }, timeoutMs);

      function cleanup() {
        clearTimeout(t);
        img.removeEventListener("load", onLoad);
        img.removeEventListener("error", onErr);
      }

      img.addEventListener("load", onLoad);
      img.addEventListener("error", onErr);
    });
  }

  function makeAudio(url) {
    if (!url) return null;
    const a = new Audio(url);
    a.preload = "auto";
    a.playsInline = true;
    return a;
  }

  function create(userCfg) {
    const cfg = { ...DEFAULTS, ...(userCfg || {}) };
    if (!cfg.mount) throw new Error("HeroPageFlip.create: mount is required");

    const flipMs = clampNumber(cfg.flipMs, 650);
    const flipAngleDeg = clampNumber(cfg.flipAngleDeg, 78);
    const spine = (cfg.spine === "right") ? "right" : "left";

    // DOM
    const mount = cfg.mount;
    mount.innerHTML = "";

    const viewport = el("div", "hpf-viewport");
    const stage = el("div", "hpf-stage");

    const imgNext = el("img", "hpf-img hpf-next");
    const imgCurrent = el("img", "hpf-img hpf-current");

    stage.appendChild(imgNext);
    stage.appendChild(imgCurrent);
    viewport.appendChild(stage);
    mount.appendChild(viewport);

    // CSS vars (анимация управляется через переменные, CSS лежит в index)
    const origin = (spine === "right") ? "100% 50%" : "0% 50%";
    const sign = (spine === "right") ? 1 : -1;
    stage.style.setProperty("--hpf-ms", flipMs + "ms");
    stage.style.setProperty("--hpf-origin", origin);
    stage.style.setProperty("--hpf-angle", (sign * flipAngleDeg) + "deg");
    stage.style.setProperty("--hpf-shadow-x", (spine === "right" ? "-18px" : "18px"));

    // audio
    const flipSound = makeAudio(cfg.soundUrl);
    let flipSoundUnlocked = false;

    function unlockFlipSoundFromGesture() {
      if (!flipSound || flipSoundUnlocked) return;
      flipSoundUnlocked = true;
      try {
        const p = flipSound.play();
        if (p && p.then) p.then(() => {
          flipSound.pause();
          flipSound.currentTime = 0;
        }).catch(() => {});
      } catch (_) {}
    }

    function playFlipSound() {
      if (!flipSound || !flipSoundUnlocked) return;
      try {
        flipSound.currentTime = 0;
        flipSound.play().catch(() => {});
      } catch (_) {}
    }

    const bgMusic = makeAudio(cfg.musicUrl);
    let bgStarted = false;

    if (bgMusic) {
      bgMusic.loop = true;
      bgMusic.volume = clampNumber(cfg.musicVolume, 0.6);
      try { bgMusic.load(); } catch(_) {}
    }

    function startBgMusicFromGesture() {
      if (!bgMusic || bgStarted) return;
      try {
        const p = bgMusic.play(); // важно: flip() должен вызываться из gesture в index
        if (p && p.then) p.then(() => { bgStarted = true; }).catch(() => {});
        else bgStarted = true;
      } catch (_) {}
    }

    let isFlipping = false;

    function setPage(url) {
      imgCurrent.src = url || "";
      imgNext.src = "";
      imgNext.style.opacity = "0";
      stage.classList.remove("hpf-flipping");
    }

    async function flip(nextUrl) {
      if (isFlipping) return false;
      if (!nextUrl) return false;

      isFlipping = true;

      // аудио строго внутри gesture (index должен вызывать flip() из pointerup/pointerdown)
      unlockFlipSoundFromGesture();
      startBgMusicFromGesture();

      imgNext.src = nextUrl;
      imgNext.style.opacity = "0";

      await waitImageReady(imgNext, clampNumber(cfg.imageLoadTimeoutMs, 450));

      playFlipSound();
      stage.classList.add("hpf-flipping");

      return new Promise((resolve) => {
        setTimeout(() => {
          imgCurrent.src = imgNext.src;
          stage.classList.remove("hpf-flipping");
          imgNext.src = "";
          imgNext.style.opacity = "0";
          isFlipping = false;
          resolve(true);
        }, flipMs + 30);
      });
    }

    function destroy() {
      try { if (bgMusic) { bgMusic.pause(); bgMusic.src = ""; } } catch(_) {}
      try { if (flipSound) { flipSound.pause(); flipSound.src = ""; } } catch(_) {}
      mount.innerHTML = "";
    }

    return { mount, viewport, stage, setPage, flip, destroy };
  }

  window.HeroPageFlip = { create };
})();
