 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/src/start.js b/src/start.js
index b2796d5d56bffe7b0ed46b65815ddf5fbb40a22c..fe5dff50c1ee34593fc03279a7dda449099c202b 100644
--- a/src/start.js
+++ b/src/start.js
@@ -1,41 +1,65 @@
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
 
-  const MENU_URL = "./assets/Menu.json";
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
+        if (!src.includes("start.js")) continue;
+        try{
+          const u = new URL(src, window.location.href);
+          if (u.pathname.includes("/src/start.js")) {
+            const basePath = u.pathname.replace(/\/src\/start\.js.*/, "/assets/");
+            return u.origin + basePath;
+          }
+        }catch(_){}
+      }
+    }catch(_){}
+
+    return "./assets/";
+  }
+
+  const MENU_URL = resolveAssetBase() + "Menu.json";
   const ROOT_ID = "heroStartMenu";
 
   let labels = Object.create(null);
 
   // Page readiness: index dispatches hero:page-changed. If user clicks before it arrives,
   // we queue ONE action and execute it right after the first page-changed.
   let __pageReady = false;
   let __pendingAction = null; // () => void
 
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
 
EOF
)
