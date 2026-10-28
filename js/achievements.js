/* ===== Memory Master — Achievements ===== */
(function (global) {
  "use strict";

  // test(data, round) -> true once earned. `round` is the round that just ended
  // (see game.js finish()); `data` is the save after that round was recorded.
  // icon = js/icons.js registry name.
  function totalStars(data) {
    return Object.keys(data.stars).reduce(function (a, k) { return a + (data.stars[k] || 0); }, 0);
  }

  var LIST = [
    { id: "first_win", icon: "trophy", title: "Анхны ялалт", desc: "Анхны түвшнээ дав.",
      test: function (d) { return d.completed.length >= 1; } },
    { id: "perfect", icon: "target", title: "Төгс ой", desc: "Нэг ч алдаагүйгээр түвшин дав.",
      test: function (d, r) { return r.won && r.moves === r.pairCount && r.pairCount >= 3; } },
    { id: "combo5", icon: "flame", title: "Галт цуврал", desc: "5 хосыг дараалан ол.",
      test: function (d) { return d.stats.bestCombo >= 5; } },
    { id: "speed", icon: "zap", title: "Аянган гар", desc: "Хугацааныхаа талаас илүүг үлдээж түвшин дав (8+ хос).",
      test: function (d, r) { return r.won && r.pairCount >= 8 && r.timeLeft >= r.totalTime / 2; } },
    { id: "no_hint_hard", icon: "lightbulb", title: "Бие даасан", desc: "Хэцүү эсвэл Мастер түвшнийг тусламжгүй дав.",
      test: function (d, r) { return r.won && !r.daily && !r.hintUsed && (r.tierKey === "hard" || r.tierKey === "master"); } },
    { id: "stars30", icon: "star", title: "Одны цуглуулагч", desc: "Нийт 30 од цуглуул.",
      test: function (d) { return totalStars(d) >= 30; } },
    { id: "stars60", icon: "sparkles", title: "Бүх од", desc: "Бүх 60 одыг цуглуул.",
      test: function (d) { return totalStars(d) >= 60; } },
    { id: "pairs500", icon: "copy", title: "Хосын анчин", desc: "Нийт 500 хос ол.",
      test: function (d) { return d.stats.pairs >= 500; } },
    { id: "streak3", icon: "calendar", title: "Тогтвортой", desc: "Өдрийн сорилтыг 3 өдөр дараалан дав.",
      test: function (d) { return (d.daily.bestStreak || 0) >= 3; } },
    { id: "streak7", icon: "medal", title: "7 хоногийн аварга", desc: "Өдрийн сорилтыг 7 өдөр дараалан дав.",
      test: function (d) { return (d.daily.bestStreak || 0) >= 7; } },
    { id: "master", icon: "crown", title: "Мастер", desc: "Мастер түвшний бүх 10 түвшнийг дав.",
      test: function (d) { return [10, 11, 12, 13, 14, 15, 16, 17, 18, 19].every(function (i) { return d.completed.indexOf(i) >= 0; }); } },
    { id: "legend", icon: "crown", title: "Memory Legend", desc: "20-р түвшин буюу Memory Legend-ийг дав.",
      test: function (d) { return d.completed.indexOf(19) >= 0; } }
  ];

  // Records newly earned achievements in data.achv and returns them.
  function check(data, round, dateKey) {
    var fresh = [];
    LIST.forEach(function (a) {
      if (data.achv[a.id]) return;
      var ok = false;
      try { ok = a.test(data, round || {}); } catch (e) { ok = false; }
      if (ok) {
        data.achv[a.id] = dateKey || true;
        fresh.push(a);
      }
    });
    return fresh;
  }

  global.MM = global.MM || {};
  global.MM.Achievements = { LIST: LIST, check: check, totalStars: totalStars };
})(window);
