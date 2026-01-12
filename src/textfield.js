 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/src/textfield.js b/src/textfield.js
index 980d466816a0a89f366ace356b765199c6f055b9..283921c7a686ac18038a92e1452216f66426e9b5 100644
--- a/src/textfield.js
+++ b/src/textfield.js
@@ -546,51 +546,75 @@ if (actionsJson || legacyAction){
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
 
-const HERO_MENU_URL = "./assets/Menu.json";
+function resolveAssetBase(){
+  try{
+    if (window.HERO_ASSET_BASE) return String(window.HERO_ASSET_BASE);
+  }catch(_){}
+
+  try{
+    const scripts = document.getElementsByTagName("script");
+    for (let i = 0; i < scripts.length; i++){
+      const src = scripts[i] && scripts[i].src ? String(scripts[i].src) : "";
+      if (!src) continue;
+      if (!src.includes("textfield.js")) continue;
+      try{
+        const u = new URL(src, window.location.href);
+        if (u.pathname.includes("/src/textfield.js")) {
+          const basePath = u.pathname.replace(/\/src\/textfield\.js.*/, "/assets/");
+          return u.origin + basePath;
+        }
+      }catch(_){}
+    }
+  }catch(_){}
+
+  return "./assets/";
+}
+
+const HERO_MENU_URL = resolveAssetBase() + "Menu.json";
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
 
EOF
)
