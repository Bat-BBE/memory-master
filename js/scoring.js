/* ===== Memory Master — Scoring rules ===== */
(function (global) {
  "use strict";

  var BASE_PAIR_SCORE = 100;
  var COMBO_STEP = 25;
  var TIME_BONUS_PER_SEC = 5;
  var EFFICIENCY_BONUS_PER_MOVE = 15;

  // Star thresholds, shared with the UI so displayed guidance ("3 stars: ≤N moves")
  // can never drift out of sync with what calcStars() actually awards.
  var STAR_THRESHOLDS = {
    threeStarMoveRatio: 2.1, threeStarTimeRatio: 0.25,
    twoStarMoveRatio: 3.2, twoStarTimeRatio: 0.1
  };

  // Points for finding a correct pair; combo (consecutive correct pairs) adds a bonus.
  function pairScore(combo) {
    return BASE_PAIR_SCORE + Math.max(0, combo - 1) * COMBO_STEP;
  }

  function timeBonus(timeLeft) {
    return Math.round(timeLeft * TIME_BONUS_PER_SEC);
  }

  // Rewards fewer moves than the "ideal" (~2.5 flips per pair).
  function efficiencyBonus(moves, pairCount) {
    return Math.max(0, Math.ceil(pairCount * 2.5 - moves)) * EFFICIENCY_BONUS_PER_MOVE;
  }

  function calcStars(moves, pairCount, timeLeft, totalTime) {
    var eff = moves / Math.max(1, pairCount);
    var t = STAR_THRESHOLDS;
    if (timeLeft > totalTime * t.threeStarTimeRatio && eff <= t.threeStarMoveRatio) return 3;
    if (timeLeft > totalTime * t.twoStarTimeRatio && eff <= t.twoStarMoveRatio) return 2;
    return 1;
  }

  global.MM = global.MM || {};
  global.MM.Scoring = {
    pairScore: pairScore,
    timeBonus: timeBonus,
    efficiencyBonus: efficiencyBonus,
    calcStars: calcStars,
    STAR_THRESHOLDS: STAR_THRESHOLDS
  };
})(window);
