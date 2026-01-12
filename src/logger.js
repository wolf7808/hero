// logger.js
// Small global logger with prefixes.
(() => {
  "use strict";

  function base(){
    return {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
      error: (...args) => console.error(...args),
    };
  }

  const b = base();

  function make(prefix){
    const p = prefix ? "[" + prefix + "]" : "";
    return {
      info: (...args) => b.info(p, ...args),
      warn: (...args) => b.warn(p, ...args),
      error: (...args) => b.error(p, ...args),
    };
  }

  window.HeroLog = { make };
})();
