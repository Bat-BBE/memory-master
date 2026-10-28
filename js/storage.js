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
      theme: null, // null = follow the device's light/dark preference
      soundOn: true,
      haptics: true,
      volume: 0.7,
      daily: { streak: 0, bestStreak: 0, lastDate: null, bestScore: 0 },
      // Lifetime counters shown in the achievements modal.
      stats: { games: 0, wins: 0, pairs: 0, bestCombo: 0, playSeconds: 0, perfect: 0, noHintWins: 0 },
      achv: {}, // achievement id -> date key it was earned
      achvSeen: 0 // how many earned achievements the player has already looked at
    };
  }

  function load() {
    var base = defaults();
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      var out = Object.assign(base, saved);
      // Nested objects: merge so saves from older versions pick up new fields.
      out.daily = Object.assign(defaults().daily, saved.daily || {});
      out.stats = Object.assign(defaults().stats, saved.stats || {});
      out.achv = Object.assign({}, saved.achv || {});
      return out;
    } catch (e) {
      return base;
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable (private mode, quota) — ignore */ }
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  global.MM = global.MM || {};
  global.MM.Storage = { load: load, save: save, reset: reset, defaults: defaults, KEY: KEY };
})(window);
