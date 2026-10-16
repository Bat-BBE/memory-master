/* ===== Memory Master — Seeded RNG (for the Daily Challenge) ===== */
(function (global) {
  "use strict";

  // xmur3 string hash -> 32-bit seed generator
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  // mulberry32 PRNG -> deterministic float in [0,1) from a 32-bit seed
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededRandom(seedStr) {
    return mulberry32(xmur3(String(seedStr))());
  }

  function seededShuffle(arr, seedStr) {
    var rand = seededRandom(seedStr);
    var a = arr.slice();
    for (var n = a.length - 1; n > 0; n--) {
      var j = Math.floor(rand() * (n + 1));
      var tmp = a[n]; a[n] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // Local calendar date key, e.g. "2026-10-14" — stable across a device's own clock,
  // same puzzle for everyone playing on the same calendar day.
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function daysBetweenKeys(a, b) {
    var da = new Date(a + "T00:00:00"), db = new Date(b + "T00:00:00");
    return Math.round((db - da) / 86400000);
  }

  global.MM = global.MM || {};
  global.MM.seededShuffle = seededShuffle;
  global.MM.todayKey = todayKey;
  global.MM.daysBetweenKeys = daysBetweenKeys;
})(window);
