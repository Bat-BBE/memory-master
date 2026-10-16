/* ===== Memory Master — Level data ===== */
(function (global) {
  "use strict";

  // Matching README tier table:
  // 1-2 Эхлэгч (2-3 pairs) · 3-4 Энгийн (8) · 5-6 Дунд (10) · 7-10 Хэцүү (15) · 11-18 Мастер (18)
  // · 19-20 boss boards (21 / 24 pairs)
  // icon = name from the js/icons.js registry (rendered as a Lucide-style SVG, not emoji).
  var TIERS = {
    beginner: { label: "Эхлэгч", color: "--green",  icon: "sprout" },
    simple:   { label: "Энгийн", color: "--cyan",   icon: "leaf" },
    medium:   { label: "Дунд",   color: "--blue",   icon: "layers" },
    hard:     { label: "Хэцүү",  color: "--purple", icon: "flame" },
    master:   { label: "Мастер", color: "--pink",   icon: "crown" }
  };

  // Card-face glyphs stay colorful emoji on purpose — variety and color help kids remember pairs.
  // Mongolian steppe/nomadic theme: horse, eagle, camel, livestock, ger, Naadam's "three manly
  // games" (wrestling, archery, horse racing), and Soyombo elements (sun/moon/fire/star).
  // The last six only appear on the two oversized boss boards (levels 19-20).
  var EMOJIS = ["🐴","🦅","🐫","🐑","🐐","🐄","🐺","🦌","⛺","🏹","🤼","🎻","🔥","☀️","🌙","⭐","🏔️","👑",
                "🦊","🐻","🦬","🌲","🏇","🥛"];

  // Special rules layered on top of the base game (see js/game.js "modifiers").
  // icon = js/icons.js registry name.
  var MODIFIERS = {
    peek:    { icon: "eye",       label: "Харж цээжлэх",  desc: function (t) { return "Тоглоом эхлэхээс өмнө бүх хөзөр " + t.peek + " секунд нээлттэй харагдана."; } },
    shuffle: { icon: "shuffle",   label: "Холилдох",      desc: function (t) { return t.shuffleEvery + " удаа буруу сонговол нуугдсан " + t.shuffleSwaps * 2 + " хөзөр байраа солино."; } },
    golden:  { icon: "zap",       label: "Алтан хос",     desc: function (t) { return "Алтан хүрээтэй хосыг олбол хугацаа " + t.goldenBonus + " секундээр нэмэгдэнэ."; } },
    frozen:  { icon: "snowflake", label: "Мөстэй хөзөр",  desc: function () { return "Мөстэй хөзрийг шууд эргүүлэх боломжгүй. Хажууд нь байгаа хөзрийн хосыг олбол мөс хайлна."; } }
  };

  // Default modifier strength; a level row may override any of these (7th field).
  // frozenShare = fraction of cards frozen at the start.
  var TUNING = { peek: 3, shuffleEvery: 3, shuffleSwaps: 1, goldenBonus: 10, frozenShare: 1 / 6 };

  // [name, tier, rows, cols, seconds, modifiers, tuning overrides]
  var RAW = [
    ["Ургац",             "beginner", 2, 2, 22, []],
    ["Анхны алхам",       "beginner", 2, 3, 30, []],
    ["Тоглоомын талбай",  "simple",   4, 4, 55, []],
    ["Зугаатай зун",      "simple",   4, 4, 50, []],
    ["Шидэт тоос",        "medium",   4, 5, 65, []],
    ["Ой тогтоолтын арга","medium",   4, 5, 60, []],
    ["Галт уул",          "hard",     5, 6, 90, ["peek"]],
    ["Мөсөн гүрвэл",      "hard",     5, 6, 85, ["frozen"]],
    ["Аянгат шуурга",     "hard",     5, 6, 80, ["shuffle"]],
    ["Сансрын аялал",     "hard",     5, 6, 75, ["golden"]],
    ["Тэнгэрийн хаалга",  "master",   6, 6, 100, ["peek", "golden"]],
    ["Од орчлон",         "master",   6, 6, 96, ["golden", "shuffle"]],
    ["Галактикийн нууц",  "master",   6, 6, 92, ["shuffle"]],
    ["Мөнхийн мөс",       "master",   6, 6, 88, ["frozen", "golden"]],
    ["Домгийн луу",       "master",   6, 6, 84, ["shuffle", "golden"]],
    ["Алтан титэм",       "master",   6, 6, 80, ["golden", "frozen"]],
    ["Тэнгэрийн од",      "master",   6, 6, 76, ["peek", "shuffle"]],
    ["Тархины аварга",    "master",   6, 6, 72, ["frozen", "shuffle"]],
    // Boss levels: bigger boards, a short peek, more ice, weaker gold.
    ["Гранд мастер",      "master",   6, 7, 82, ["peek", "frozen", "shuffle", "golden"],
      { peek: 2, frozenShare: 1 / 5, goldenBonus: 6 }],
    ["Memory Legend",     "master",   6, 8, 92, ["peek", "shuffle", "frozen", "golden"],
      { peek: 1, shuffleEvery: 2, shuffleSwaps: 2, frozenShare: 1 / 4, goldenBonus: 4 }]
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
      time: row[4],
      modifiers: row[5] || [],
      tuning: Object.assign({}, TUNING, row[6] || {})
    };
  });

  global.MM = global.MM || {};
  global.MM.LEVELS = LEVELS;
  global.MM.TIERS = TIERS;
  global.MM.EMOJIS = EMOJIS;
  global.MM.MODIFIERS = MODIFIERS;
  global.MM.TUNING = TUNING;
})(window);
