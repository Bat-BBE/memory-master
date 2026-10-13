/* ===== Memory Master — LocalStorage save/load ===== */
(function (global) {
  "use strict";

  var KEY = "memoryMasterSave";

  function defaults() {
    return {
      unlocked: 1,
      completed: [],
      bestScore: 0,
      totalWins: 0,
      stars: {},
      scores: {},
      theme: "dark",
      soundOn: true,
      volume: 0.7
    };
  }

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      return Object.assign(defaults(), saved);
    } catch (e) {
      return defaults();
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable (private mode, quota) — ignore */ }
  }

  global.MM = global.MM || {};
  global.MM.Storage = { load: load, save: save, KEY: KEY };
})(window);
