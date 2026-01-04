/* pageflip.js
 * HeroPageFlip — минимальная библиотека перелистывания страниц
 * ES6, без зависимостей.
 *
 * Музыка:
 *  - стартует при ПЕРВОМ перелистывании (внутри pointerdown)
 *  - loop
 */
(() => {
  "use strict";

  const DEFAULTS = {
    mount: null,
    errorEl: null,

    dbUrl: "",
    imgBaseUrl: "",
    soundUrl: "",

    musicUrl: "",
    musicVolume: 0.6,

    flipMs: 650,
    flipAngleDeg: 78,

    spine: "left",
  };

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function showError(errorEl, msg) {
    if (!errorEl) return;
    errorEl.style.display = "block";
    errorEl.textContent = msg;
  }

  function hideError(errorEl) {
    if (!errorEl) return;
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  function clampNumber(n, fallback) {
    const x = Number(n);
    return Number.isFinite(x) ? x : fallback;
  }

  function pageToUrl(imgBaseUrl, pageStr) {
    return imgBaseUrl.replace(/\/?$/, "/") + pageStr + ".webp";
  }

  function preload(url) {
    const im = new Image();
    im.src = url;
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

  function buildStyles(flipMs, flipAngleDeg, spine) {
    const origin = spine === "right" ? "100% 50%" : "0% 50%";
    const sign = spine === "right" ? 1 : -1;

    const style = el("style");
    style.textContent = `
      .hpf-viewport{
        position:absolute; inset:0;
        width:100%; height:100%;
        display:flex; align-items:center; justify-content:center;
        overflow:hidden; touch-action:none; cursor:pointer;
      }
      .hpf-stage{
        position:relative;
        width:100%; height:100%;
        display:flex; align-items:center; justify-content:center;
        perspective:1200px;
        overflow:hidden;
        touch-action:none;
      }
      .hpf-img{
        position:absolute;
        top:0;
        left:50%;
        height:100%;
        width:auto;
        max-width:100%;
        object-fit:contain;
        display:block;
        transform:translateX(-50%);
        user-select:none;
        -webkit-user-drag:none;
        touch-action:none;
        backface-visibility:hidden;
        transform-style:preserve-3d;
      }
      .hpf-current{ z-index:2; }
      .hpf-next{
        z-index:1;
        opacity:0;
        transform:translateX(-50%) scale(0.998);
      }

      .hpf-flipping .hpf-current{
        transform-origin:${origin};
        animation:hpfFlipOut ${flipMs}ms ease-in-out forwards;
        filter:drop-shadow(${spine === "right" ? "-18px" : "18px"} 0 22px rgba(0,0,0,.28));
      }
      .hpf-flipping .hpf-next{
        animation:hpfNextIn ${flipMs}ms ease-out forwards;
      }

      @keyframes hpfFlipOut{
        0%{ transform:translateX(-50%) rotateY(0deg); opacity:1; }
        45%{ opacity:0.75; }
        100%{ transform:translateX(-50%) rotateY(${sign * flipAngleDeg}deg); opacity:0; }
      }
      @keyframes hpfNextIn{
        0%{ opacity:0; transform:translateX(-50%) scale(0.998); }
        55%{ opacity:0.55; }
        100%{ opacity:1; transform:translateX(-50%) scale(1); }
      }
    `;
    return style;
  }

  function createAudio(url) {
    if (!url) return null;
    // Создаём именно Audio, но play будем вызывать строго из обработчика жеста
    const a = new Audio(url);
    a.preload = "auto";
    a.playsInline = true; // iOS
    return a;
  }

  async function loadDb(dbUrl) {
    const res = await fetch(dbUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Game.json должен быть массивом");
    const pages = data.filter(x => x && typeof x.page === "string");
    if (!pages.length) throw new Error("В Game.json нет элементов {\"page\":\"...\"}");
    return pages;
  }

  async function init(userCfg) {
    const cfg = { ...DEFAULTS, ...(userCfg || {}) };

    if (!cfg.mount) throw new Error("HeroPageFlip.init: mount is required");
    if (!cfg.dbUrl) throw new Error("HeroPageFlip.init: dbUrl is required");
    if (!cfg.imgBaseUrl) throw new Error("HeroPageFlip.init: imgBaseUrl is required");

    const mount = cfg.mount;
    const errorEl = cfg.errorEl || null;

    mount.innerHTML = "";

    const viewport = el("div", "hpf-viewport");
    const stage = el("div", "hpf-stage");

    const imgNext = el("img", "hpf-img hpf-next");
    imgNext.alt = "Next page";

    const imgCurrent = el("img", "hpf-img hpf-current");
    imgCurrent.alt = "Page";

    stage.appendChild(imgNext);
    stage.appendChild(imgCurrent);
    viewport.appendChild(stage);
    mount.appendChild(viewport);

    const flipMs = clampNumber(cfg.flipMs, 650);
    const flipAngleDeg = clampNumber(cfg.flipAngleDeg, 78);
    const spine = (cfg.spine === "right") ? "right" : "left";
    mount.appendChild(buildStyles(flipMs, flipAngleDeg, spine));

    // ---- flip sound
    const flipSound = createAudio(cfg.soundUrl);
    let flipSoundUnlocked = false;

    function unlockFlipSoundFromGesture() {
      if (!flipSound || flipSoundUnlocked) return;
      flipSoundUnlocked = true;
      // короткий "пинг" для unlock (может быть заблокирован — ок)
      try {
        const p = flipSound.play();
        if (p && p.then) p.then(() => {
          flipSound.pause();
          flipSound.currentTime = 0;
        }).catch(() => {});
      } catch(_) {}
    }

    function playFlipSound() {
      if (!flipSound || !flipSoundUnlocked) return;
      try {
        flipSound.currentTime = 0;
        flipSound.play().catch(() => {});
      } catch (_) {}
    }

    // ---- background music (start on FIRST FLIP in the gesture handler)
    const bgMusic = cfg.musicUrl ? createAudio(cfg.musicUrl) : null;
    let bgStarted = false;

    if (bgMusic) {
      bgMusic.loop = true;
      bgMusic.volume = clampNumber(cfg.musicVolume, 0.6);
      try { bgMusic.load(); } catch(_) {}
    }

    function startBgMusicFromGesture() {
      if (!bgMusic || bgStarted) return;
      try {
        const p = bgMusic.play();
        if (p && p.then) {
          p.then(() => { bgStarted = true; }).catch(() => {});
        } else {
          bgStarted = true;
        }
      } catch(_) {}
    }

    // ---- data
    let pages = [];
    let idx = 0;
    let isFlipping = false;

    try {
      hideError(errorEl);
      pages = await loadDb(cfg.dbUrl);
    } catch (e) {
      showError(errorEl, "Не удалось загрузить Game.json.\n" + (e && e.message ? e.message : String(e)));
      return;
    }

    function getPageStr(i) {
      const p = pages[i];
      return p && typeof p.page === "string" ? p.page : null;
    }

    function renderInitial() {
      const pageStr = getPageStr(idx);
      if (!pageStr) { showError(errorEl, "Ошибка данных: нет поля \"page\""); return; }
      hideError(errorEl);

      imgCurrent.src = pageToUrl(cfg.imgBaseUrl, pageStr);

      const nextIdx = (idx + 1) % pages.length;
      const nextStr = getPageStr(nextIdx);
      if (nextStr) preload(pageToUrl(cfg.imgBaseUrl, nextStr));
    }

    async function flipToNextAsync() {
      if (isFlipping || !pages.length) return;
      isFlipping = true;

      const nextIdx = (idx + 1) % pages.length;
      const nextStr = getPageStr(nextIdx);

      if (!nextStr) {
        showError(errorEl, "Ошибка данных: нет поля \"page\" у следующего элемента");
        isFlipping = false;
        return;
      }

      imgNext.src = pageToUrl(cfg.imgBaseUrl, nextStr);
      imgNext.style.opacity = "0";

      await waitImageReady(imgNext, Math.min(450, flipMs));

      playFlipSound();
      stage.classList.add("hpf-flipping");

      setTimeout(() => {
        idx = nextIdx;
        imgCurrent.src = imgNext.src;

        stage.classList.remove("hpf-flipping");
        imgNext.src = "";
        imgNext.style.opacity = "0";

        const afterIdx = (idx + 1) % pages.length;
        const afterStr = getPageStr(afterIdx);
        if (afterStr) preload(pageToUrl(cfg.imgBaseUrl, afterStr));

        isFlipping = false;
        hideError(errorEl);
      }, flipMs + 30);
    }

    // ---- events
    // КРИТИЧНО: play() для музыки вызываем ПРЯМО ТУТ, в синхронном обработчике жеста
    viewport.addEventListener("pointerdown", (e) => {
      e.preventDefault();

      // unlock + start bg music на первом перелистывании
      unlockFlipSoundFromGesture();
      startBgMusicFromGesture();

      // сам flip (async) отдельно
      flipToNextAsync();
    }, { passive: false });

    // запасной вариант для старых браузеров
    viewport.addEventListener("click", () => flipToNextAsync());

    // блок double-tap zoom (iOS Safari)
    let lastTap = 0;
    viewport.addEventListener("touchend", (e) => {
      const now = Date.now();
      if (now - lastTap < 350) e.preventDefault();
      lastTap = now;
    }, { passive: false });

    imgCurrent.addEventListener("error", () => {
      const pageStr = getPageStr(idx);
      showError(errorEl, "Не удалось загрузить картинку:\n" + pageToUrl(cfg.imgBaseUrl, pageStr));
    });

    renderInitial();
  }

  window.HeroPageFlip = { init };
})();
