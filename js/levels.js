/* ===== Memory Master — Level data ===== */
(function (global) {
  "use strict";

  // Matching README tier table:
  // 1-2 Эхлэгч (2-3 pairs) · 3-4 Энгийн (8) · 5-6 Дунд (10) · 7-10 Хэцүү (15) · 11-20 Мастер (18)
  // icon = name from the js/icons.js registry (rendered as a Lucide-style SVG, not emoji).
  var TIERS = {
    beginner: { label: "Эхлэгч", color: "--green",  icon: "sprout" },
    simple:   { label: "Энгийн", color: "--cyan",   icon: "leaf" },
    medium:   { label: "Дунд",   color: "--blue",   icon: "layers" },
    hard:     { label: "Хэцүү",  color: "--purple", icon: "flame" },
    master:   { label: "Мастер", color: "--pink",   icon: "crown" }
  };

  // Card-face glyphs stay colorful emoji on purpose — variety and color help kids remember pairs.
  var EMOJIS = ["🦊","🐼","🐸","🦄","🐙","🐵","🐧","🦋","🐯","🐨","🐰","🐹","🐳","🦖","🐢","🦉","🐝","🐞"];

  var RAW = [
    ["Ургац",             "beginner", 2, 2, 22],
    ["Анхны алхам",       "beginner", 2, 3, 30],
    ["Тоглоомын талбай",  "simple",   4, 4, 55],
    ["Зугаатай зун",      "simple",   4, 4, 50],
    ["Шидэт тоос",        "medium",   4, 5, 65],
    ["Ой тогтоолтын арга","medium",   4, 5, 60],
    ["Галт уул",          "hard",     5, 6, 90],
    ["Мөсөн гүрвэл",      "hard",     5, 6, 85],
    ["Аянгат шуурга",     "hard",     5, 6, 80],
    ["Сансрын аялал",     "hard",     5, 6, 75],
    ["Тэнгэрийн хаалга",  "master",   6, 6, 100],
    ["Од орчлон",         "master",   6, 6, 96],
    ["Галактикийн нууц",  "master",   6, 6, 92],
    ["Мөнхийн мөс",       "master",   6, 6, 88],
    ["Домгийн луу",       "master",   6, 6, 84],
    ["Алтан титэм",       "master",   6, 6, 80],
    ["Тэнгэрийн од",      "master",   6, 6, 76],
    ["Тархины аварга",    "master",   6, 6, 72],
    ["Гранд мастер",      "master",   6, 6, 68],
    ["Memory Legend",     "master",   6, 6, 64]
  ];

  var LEVELS = RAW.map(function (row) {
    var tierKey = row[1];
    return {
      name: row[0],
      tierKey: tierKey,
      tier: TIERS[tierKey].label,
      tierColorVar: TIERS[tierKey].color,
      tierIcon: TIERS[tierKey].icon,
      rows: row[2],
      cols: row[3],
      time: row[4]
    };
  });

  global.MM = global.MM || {};
  global.MM.LEVELS = LEVELS;
  global.MM.TIERS = TIERS;
  global.MM.EMOJIS = EMOJIS;
})(window);
