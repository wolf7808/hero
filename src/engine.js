 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/src/engine.js b/src/engine.js
index e2b1681ae7f696c482d2f2bd2826b3bf7a209a96..b9c544a5794573d56333e8fc5b3bade71669a6d4 100644
--- a/src/engine.js
+++ b/src/engine.js
@@ -1,46 +1,71 @@
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
 
-  const ASSET_BASE = "./assets/";
-  const STATS_META_URL = ASSET_BASE + "Stats.json";
-  const ITEMS_URL = ASSET_BASE + "Items.json";
+  function resolveAssetBase(){
+    try{
+      if (window.HERO_ASSET_BASE) return String(window.HERO_ASSET_BASE);
+    }catch(_){}
+
+    try{
+      const scripts = document.getElementsByTagName("script");
+      for (let i = 0; i < scripts.length; i++){
+        const src = scripts[i] && scripts[i].src ? String(scripts[i].src) : "";
+        if (!src) continue;
+        if (!src.includes("engine.js")) continue;
+        try{
+          const u = new URL(src, window.location.href);
+          if (u.pathname.includes("/src/engine.js")) {
+            const basePath = u.pathname.replace(/\/src\/engine\.js.*/, "/assets/");
+            return u.origin + basePath;
+          }
+        }catch(_){}
+      }
+    }catch(_){}
+
+    return "./assets/";
+  }
+
+  const ASSET_BASE = resolveAssetBase();
+  try{ window.HERO_ASSET_BASE = ASSET_BASE; }catch(_){}
+  const STATS_META_URL = ASSET_BASE + "Stats.json";
+  const ITEMS_URL = ASSET_BASE + "Items.json";
 
   // Magic tab: fixed number of spell slots
   const SPELLBOOK_SLOTS = 6;
 
-  const TALE_BASE = "./assets/Img/"; // folder where 000.webp, blank.webp, tale*.webp live
+  const TALE_BASE = ASSET_BASE + "Img/"; // folder where 000.webp, blank.webp, tale*.webp live
 
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
 
@@ -84,58 +109,58 @@
 
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
-  const SFX = {
-    victory: ASSET_BASE + "victory.wav",
-    loose:   ASSET_BASE + "loose.wav",
-    take:    ASSET_BASE + "take.wav",
-    battle:  ASSET_BASE + "battle.wav",
-    battlewin:  ASSET_BASE + "battlewin.wav",
-    battleloose: ASSET_BASE + "battleloose.wav",
-  };
+  const SFX = {
+    victory: ASSET_BASE + "victory.wav",
+    loose:   ASSET_BASE + "loose.wav",
+    take:    ASSET_BASE + "take.wav",
+    battle:  ASSET_BASE + "battle.wav",
+    battlewin:  ASSET_BASE + "battlewin.wav",
+    battleloose: ASSET_BASE + "battleloose.wav",
+  };
 
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
@@ -196,51 +221,51 @@
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
-  const MUSIC_URL = "./assets/Maintheme.mp3";
+  const MUSIC_URL = ASSET_BASE + "Maintheme.mp3";
 
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
 
EOF
)
