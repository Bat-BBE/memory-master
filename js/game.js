/* ===== Memory Master — Game logic ===== */
(function () {
  "use strict";

  var LEVELS = window.MM.LEVELS;
  var EMOJIS = window.MM.EMOJIS;
  var TIERS = window.MM.TIERS;
  var Storage = window.MM.Storage;
  var Scoring = window.MM.Scoring;
  var Achievements = window.MM.Achievements;
  var Icon = window.MM.Icon;
  var attachTilt = window.MM.attachTilt;
  var seededShuffle = window.MM.seededShuffle;
  var todayKey = window.MM.todayKey;
  var daysBetweenKeys = window.MM.daysBetweenKeys;
  var Board3D = window.MM.Board3D; // null when WebGL/Three.js is unavailable -> DOM cards
  var Hero3D = window.MM.Hero3D;
  var MODIFIERS = window.MM.MODIFIERS;
  var TUNING = window.MM.TUNING;

  var $ = function (id) {
    return document.getElementById(id);
  };

  var DAILY_LEVEL = {
    name: "Өдрийн сорилт",
    tier: "Өдрийн сорилт",
    tierKey: "daily",
    tierColorVar: "--gold",
    tierIcon: "calendar",
    rows: 4,
    cols: 5,
    time: 70,
    modifiers: [],
    tuning: TUNING,
  };
  // Regular boards draw from the first 18 glyphs; the last six stay reserved
  // for the oversized boss boards (see levels.js).
  var BASE_EMOJI_POOL = 18;
  var MISMATCH_MS = 750;
  var HINT_COST = 50;

  var data = Storage.load();

  /* Round state. phase: idle → intro → (peek) → play ⇄ paused → done */
  var phase = "idle";
  var level = 0,
    levelDef = null,
    cards = [],
    first = null,
    second = null,
    lock = false,
    isDailyRound = false;
  var timeLeft = 0,
    totalTime = 0,
    score = 0,
    moves = 0,
    pairs = 0,
    combo = 0,
    maxCombo = 0,
    pairPoints = 0,
    hintPenalty = 0;
  var timer = null,
    mismatchTimer = null,
    hintTimer = null,
    mascotTimer = null,
    peekTimer = null,
    resultTimer = null,
    hintUsed = false;
  var board3d = null;
  // Level modifiers (special rules) — see "level modifiers" section below.
  var mods = {},
    boardCols = 4,
    boardRows = 4,
    missesSinceShuffle = 0,
    tune = TUNING; // modifier strength for the current level (levels.js TUNING)
  var audioCtx = null;
  var lastResult = null;

  /* ---------- helpers ---------- */
  function fmt(s) {
    s = Math.max(0, Math.ceil(s));
    return (
      String(Math.floor(s / 60)).padStart(2, "0") +
      ":" +
      String(s % 60).padStart(2, "0")
    );
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function starsText(n) {
    return "★".repeat(n) + "☆".repeat(3 - n);
  }

  function reducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  function activeScreen() {
    var el = document.querySelector(".screen.active");
    return el ? el.id.replace("Screen", "") : "home";
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) {
      s.classList.remove("active");
    });
    $(name + "Screen").classList.add("active");
    document.body.setAttribute("data-screen", name);
    window.scrollTo(0, 0);
    // One history entry for "inside the app", so the phone's back button
    // returns to the home screen (or pauses a running round) instead of
    // leaving the page.
    if (name !== "home") {
      try {
        if (!(history.state && history.state.mm)) history.pushState({ mm: 1 }, "");
      } catch (e) { /* file:// or sandboxed — back button just leaves */ }
    }
    // Lets the WebGL views (board3d.js / hero3d.js) pause rendering while off-screen.
    document.dispatchEvent(new CustomEvent("mm:screen", { detail: name }));
  }

  function toast(msg, icon) {
    var t = $("toast");
    t.innerHTML = (icon ? Icon(icon) : "") + "<span>" + msg + "</span>";
    t.classList.add("show");
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(function () {
      t.classList.remove("show");
    }, 2100);
  }

  function buzz(pattern) {
    if (!data.haptics || !navigator.vibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch (e) { /* not allowed — ignore */ }
  }

  function playTone(freq, duration, type, delay) {
    if (!data.soundOn) return;
    freq = freq || 440;
    duration = duration || 0.07;
    type = type || "sine";
    try {
      audioCtx =
        audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      // iOS/Chrome start the context suspended until a user gesture.
      if (audioCtx.state === "suspended") audioCtx.resume();
      var t0 = audioCtx.currentTime + (delay || 0);
      var o = audioCtx.createOscillator(),
        g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      var vol = 0.045 * (typeof data.volume === "number" ? data.volume : 0.7);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + duration + 0.02);
    } catch (e) {
      /* audio unsupported — silently skip */
    }
  }

  function chord(freqs, gap, duration, type) {
    freqs.forEach(function (f, k) {
      playTone(f, duration, type, k * gap);
    });
  }

  function stopTimers() {
    clearInterval(timer);
    clearTimeout(mismatchTimer);
    clearTimeout(hintTimer);
    clearTimeout(peekTimer);
    timer = null;
    mismatchTimer = null;
    hintTimer = null;
    peekTimer = null;
  }

  function tierColorStyle(l) {
    return "--tier-color:var(" + l.tierColorVar + ")";
  }

  function totalStars() {
    return Achievements.totalStars(data);
  }

  // A streak only counts while it's unbroken: last daily win today or yesterday.
  function liveStreak() {
    var d = data.daily;
    if (!d.lastDate) return 0;
    var gap = daysBetweenKeys(d.lastDate, todayKey());
    return gap <= 1 ? d.streak || 0 : 0;
  }

  function shuffleInPlace(a, rand) {
    rand = rand || Math.random;
    for (var n = a.length - 1; n > 0; n--) {
      var j = Math.floor(rand() * (n + 1));
      var tmp = a[n];
      a[n] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  /* ---------- mascot / combo / particles (feel-good feedback) ---------- */
  function mascotSay(face, text, bump) {
    var faceEl = $("mascotFace"),
      bubbleEl = $("mascotBubble");
    if (!faceEl || !bubbleEl) return;
    faceEl.textContent = face;
    if (bump) {
      faceEl.classList.remove("bump");
      void faceEl.offsetWidth; // restart the bump animation even if it's already mid-play
      faceEl.classList.add("bump");
    }
    bubbleEl.textContent = text;
    bubbleEl.classList.add("show");
    clearTimeout(mascotTimer);
    mascotTimer = setTimeout(function () {
      bubbleEl.classList.remove("show");
    }, 1700);
  }

  function updateComboBadge() {
    var el = $("comboBadge");
    if (!el) return;
    if (combo > 1) {
      $("comboCount").textContent = "x" + combo;
      el.classList.remove("show");
      void el.offsetWidth;
      el.classList.add("show");
      el.classList.toggle("mega", combo >= 4);
    } else {
      el.classList.remove("show", "mega");
    }
  }

  function isSmallScreen() {
    return window.innerWidth <= 640;
  }

  function cardCenter(el) {
    var board = $("board");
    var br = board.getBoundingClientRect(),
      er = el.getBoundingClientRect();
    return {
      x: er.left - br.left + er.width / 2,
      y: er.top - br.top + er.height / 2,
    };
  }

  // Floating "+125" over the matched pair; works for both the 3D and DOM boards.
  function floatScore(el, text, kind) {
    var layer = $("particleLayer");
    if (!layer || !el) return;
    var c = cardCenter(el);
    var f = document.createElement("span");
    f.className = "float-score" + (kind ? " " + kind : "");
    f.textContent = text;
    f.style.left = c.x + "px";
    f.style.top = c.y + "px";
    layer.appendChild(f);
    setTimeout(function () {
      f.remove();
    }, 1000);
  }

  function burstAt(el) {
    if (board3d) return; // the 3D board draws its own particle burst
    var layer = $("particleLayer");
    if (!layer || !el) return;
    var c = cardCenter(el);
    var colors = ["#5ee7ff", "#9c72ff", "#ffd35a", "#ff5a86", "#34d399"];
    var count = isSmallScreen() ? 6 : 10;
    for (var k = 0; k < count; k++) {
      var p = document.createElement("span");
      p.className = "particle";
      var ang = Math.random() * Math.PI * 2,
        dist = 26 + Math.random() * 30;
      p.style.left = c.x + "px";
      p.style.top = c.y + "px";
      p.style.background = colors[k % colors.length];
      p.style.setProperty("--px", Math.cos(ang) * dist + "px");
      p.style.setProperty("--py", Math.sin(ang) * dist + "px");
      layer.appendChild(p);
      (function (piece) {
        setTimeout(function () {
          piece.remove();
        }, 720);
      })(p);
    }
  }

  /* ---------- persistence / stats ---------- */
  function save() {
    Storage.save(data);
    updateHomeStats();
  }

  function updateHomeStats() {
    var stars = totalStars();
    $("homeStars").textContent = stars;
    $("homeWins").textContent = data.completed.length;
    $("homeStarFill").style.width = (stars / (LEVELS.length * 3)) * 100 + "%";
    var next = nextLevelIndex();
    $("continueSub").textContent =
      "Түвшин " + pad2(next + 1) + " · " + LEVELS[next].name;
    var streak = liveStreak();
    $("topStreakNum").textContent = streak;
    $("topStreak").classList.toggle("on", streak > 0);
    var earned = Object.keys(data.achv).length;
    $("achvDot").hidden = earned <= (data.achvSeen || 0);
  }

  // The first unlocked level that isn't finished yet (or the last unlocked one).
  function nextLevelIndex() {
    var maxUnlocked = Math.min(data.unlocked, LEVELS.length) - 1;
    for (var i = 0; i <= maxUnlocked; i++) {
      if (data.completed.indexOf(i) < 0) return i;
    }
    return maxUnlocked;
  }

  /* ---------- level cards ---------- */
  function makeLevelCard(i) {
    var l = LEVELS[i];
    var unlocked = i < data.unlocked;
    var stars = data.stars[i] || 0;
    var done = data.completed.indexOf(i) >= 0;
    var current = unlocked && !done && i === nextLevelIndex();
    var pairCount = (l.rows * l.cols) / 2;
    var iconName = unlocked ? (done ? "check-circle" : l.tierIcon) : "lock";
    var iconClass =
      "level-icon" + (!unlocked ? " locked" : done ? " done" : "");
    var modIcons = modList(l)
      .map(function (k) {
        return '<span title="' + MODIFIERS[k].label + '">' + Icon(MODIFIERS[k].icon) + "</span>";
      })
      .join("");
    var b = document.createElement("button");
    b.className = "level-card" + (current ? " current" : "");
    b.disabled = !unlocked;
    b.style.cssText = tierColorStyle(l);
    b.setAttribute(
      "aria-label",
      "Түвшин " + (i + 1) + ", " + l.name + (unlocked ? (done ? ", " + stars + " од" : "") : ", түгжээтэй"),
    );
    b.innerHTML =
      '<span class="level-top">' +
      '<span class="' + iconClass + '">' + Icon(iconName) + "</span>" +
      '<span class="level-num">' + pad2(i + 1) + "</span>" +
      (modIcons ? '<span class="level-mods">' + modIcons + "</span>" : "") +
      "</span>" +
      "<strong>" + l.name + "</strong>" +
      "<small>" + l.rows + "×" + l.cols + " · " + pairCount + " хос · " + fmt(l.time) + "</small>" +
      '<span class="progress">' +
      (unlocked
        ? done
          ? '<span class="stars">' + starsText(stars) + "</span>" +
            (data.scores[i] ? '<span class="best">' + data.scores[i] + "</span>" : "")
          : current
            ? "ОДОО ТОГЛОХ ▸"
            : "НЭЭЛТТЭЙ"
        : "ТҮГЖЭЭТЭЙ") +
      "</span>";
    b.addEventListener("click", function () {
      startLevel(i, true);
    });
    attachTilt(b, { maxDeg: 8 });
    return b;
  }

  function renderLevels() {
    var home = $("homeLevels"),
      all = $("allLevels");
    home.innerHTML = "";
    all.innerHTML = "";
    // Home shows a 4-level window around the player's current progress.
    var start = Math.max(0, Math.min(nextLevelIndex() - 1, LEVELS.length - 4));
    for (var i = start; i < start + 4; i++) home.appendChild(makeLevelCard(i));

    // Full list, grouped by tier.
    var order = ["beginner", "simple", "medium", "hard", "master"];
    order.forEach(function (key) {
      var t = TIERS[key];
      var idxs = [];
      LEVELS.forEach(function (l, i) {
        if (l.tierKey === key) idxs.push(i);
      });
      var got = idxs.reduce(function (a, i) {
        return a + (data.stars[i] || 0);
      }, 0);
      var group = document.createElement("div");
      group.className = "tier-group";
      group.style.cssText = "--tier-color:var(" + t.color + ")";
      group.innerHTML =
        '<div class="tier-head"><span class="tier-ic">' + Icon(t.icon) + "</span>" +
        "<b>" + t.label + "</b>" +
        '<span class="tier-count">' + Icon("star") + got + "/" + idxs.length * 3 + "</span></div>";
      var grid = document.createElement("div");
      grid.className = "level-grid";
      idxs.forEach(function (i) {
        grid.appendChild(makeLevelCard(i));
      });
      group.appendChild(grid);
      all.appendChild(group);
    });
    updateHomeStats();
  }

  function renderDailyBanner() {
    var btn = $("dailyPlayBtn"),
      streakEl = $("dailyStreakNum"),
      subEl = $("dailyBannerSub");
    if (!btn) return;
    var d = data.daily;
    var playedToday = d.lastDate === todayKey();
    var streak = liveStreak();
    streakEl.textContent = streak;
    $("dailyDone").hidden = !playedToday;
    $("dailyBanner").classList.toggle("done", playedToday);
    subEl.textContent = playedToday
      ? "Өнөөдрийн сорилтыг дуусгалаа! Шилдэг оноо: " + (d.bestScore || 0) + ". Маргааш шинэ самбар гарна."
      : streak > 0
        ? "Өнөөдөр тоглоод " + (streak + 1) + " өдрийн дараалал руу ахиарай! 🔥"
        : "Өдөр бүр шинэ 10 хос. Өдөр алгасалгүй тоглож, дараалсан өдрийн тоогоо ахиулаарай!";
    btn.innerHTML =
      Icon(playedToday ? "rotate-ccw" : "play") + " " + (playedToday ? "Дахин" : "Тоглох");
  }

  function refreshHome() {
    renderLevels();
    renderDailyBanner();
  }

  /* ---------- level modifiers (special rules) ----------
     Layered on top of the base rules; a level without modifiers plays exactly
     as before. peek: all faces shown before the clock starts · shuffle: every
     3rd miss swaps two hidden cards · golden: one pair adds time · frozen: some
     cards can't be flipped until a neighbouring pair is matched. */
  function neighbors(i) {
    var out = [],
      c = i % boardCols;
    if (i - boardCols >= 0) out.push(i - boardCols);
    if (i + boardCols < cards.length) out.push(i + boardCols);
    if (c > 0) out.push(i - 1);
    if (c < boardCols - 1 && i + 1 < cards.length) out.push(i + 1);
    return out;
  }

  function partnerOf(i) {
    for (var j = 0; j < cards.length; j++) {
      if (j !== i && cards[j].emoji === cards[i].emoji) return j;
    }
    return -1;
  }

  // Freezes ~1/6 of the cards. Every frozen card keeps at least one neighbour
  // from a "free" pair (both cards unfrozen); matching that pair always thaws
  // it, so a frozen board can never deadlock.
  function pickFrozen() {
    var target = Math.max(2, Math.round(cards.length * tune.frozenShare));
    var frozen = {},
      count = 0;
    function hasFreeNeighbor(i) {
      return neighbors(i).some(function (n) {
        return !frozen[n] && !frozen[partnerOf(n)];
      });
    }
    var order = shuffleInPlace(
      cards.map(function (_, i) {
        return i;
      }),
    );
    order.forEach(function (i) {
      if (count >= target) return;
      var touching = neighbors(i).some(function (n) {
        return frozen[n];
      });
      if (touching) return; // keep frozen cards apart
      frozen[i] = true;
      var ok = Object.keys(frozen).every(function (k) {
        return hasFreeNeighbor(Number(k));
      });
      if (ok) count++;
      else delete frozen[i];
    });
    Object.keys(frozen).forEach(function (k) {
      cards[k].frozen = true;
    });
  }

  function thawAround(indices) {
    var thawed = 0;
    indices.forEach(function (i) {
      neighbors(i).forEach(function (n) {
        var c = cards[n];
        if (!c.frozen) return;
        c.frozen = false;
        c.element.classList.remove("frozen");
        c.element.setAttribute("aria-label", "Нуугдсан хөзөр");
        thawed++;
      });
    });
    if (thawed) playTone(1180, 0.09, "triangle");
    return thawed;
  }

  function nudge(i) {
    var el = cards[i].element;
    el.classList.remove("nudge");
    void el.offsetWidth; // restart the animation on repeated taps
    el.classList.add("nudge");
    setTimeout(function () {
      el.classList.remove("nudge");
    }, 420);
    playTone(220, 0.08, "square");
    buzz(30);
    toast("Мөстэй хөзөр! Хажууд нь байгаа хөзрийн хосыг олбол мөс хайлна.", "snowflake");
  }

  // Swaps two hidden, unfrozen cards. Only cards whose partner is also unfrozen
  // are eligible, which keeps pickFrozen()'s no-deadlock guarantee intact.
  function maybeShuffle() {
    if (!mods.shuffle || missesSinceShuffle < tune.shuffleEvery) return;
    var pool = [];
    cards.forEach(function (c, i) {
      if (c.matched || c.flipped || c.frozen) return;
      if (cards[partnerOf(i)].frozen) return;
      pool.push(i);
    });
    var swaps = [];
    for (var tries = 0; tries < 40 && swaps.length < tune.shuffleSwaps; tries++) {
      var x = pool[Math.floor(Math.random() * pool.length)];
      var y = pool[Math.floor(Math.random() * pool.length)];
      if (x === undefined || y === undefined || cards[x].emoji === cards[y].emoji)
        continue;
      swaps.push([x, y]);
      // each card moves at most once per shuffle
      pool = pool.filter(function (k) {
        return k !== x && k !== y;
      });
    }
    missesSinceShuffle = 0;
    updateMetrics();
    if (!swaps.length) return; // too few hidden cards left to make a meaningful swap
    swaps.forEach(function (pair) {
      swapCards(pair[0], pair[1]);
    });
    mascotSay("🌀", "Хөзрүүд холилдлоо!", true);
    buzz([20, 40, 20]);
    toast(swaps.length * 2 + " хөзөр байраа солилоо — ажиглаарай!", "shuffle");
  }

  function swapCards(i, j) {
    var a = cards[i],
      b = cards[j];
    var emoji = a.emoji,
      golden = a.golden;
    a.emoji = b.emoji;
    a.golden = b.golden;
    b.emoji = emoji;
    b.golden = golden;
    [a, b].forEach(function (c) {
      c.element.querySelector(".card-front").textContent = c.emoji;
      c.element.classList.toggle("golden", !!c.golden);
      c.element.classList.remove("swapped");
      void c.element.offsetWidth;
      c.element.classList.add("swapped");
    });
    if (board3d) board3d.swap(i, j);
    playTone(440, 0.07, "triangle");
    playTone(660, 0.07, "triangle", 0.09);
  }

  // Shows every face for tune.peek seconds before the clock starts.
  function startPeek() {
    phase = "peek";
    lock = true;
    cards.forEach(function (c) {
      c.element.classList.add("flipped");
    });
    var secs = tune.peek;
    // Let the 3D deal-in finish so the last cards get the full peek too.
    var dealDelay = board3d ? 450 + cards.length * 22 : 0;
    function step() {
      if (secs > 0) {
        mascotSay("👀", "Цээжил! " + secs, secs === tune.peek);
        playTone(secs === 1 ? 700 : 560, 0.06);
        secs--;
        peekTimer = setTimeout(step, 1000);
        return;
      }
      peekTimer = null;
      cards.forEach(function (c) {
        if (!c.matched) c.element.classList.remove("flipped");
      });
      lock = false;
      mascotSay("🧠", "Эхэллээ!", true);
      phase = "play";
      runClock();
    }
    peekTimer = setTimeout(step, dealDelay);
  }

  function modList(l) {
    return (l.modifiers || []).filter(function (k) {
      return MODIFIERS[k];
    });
  }

  function renderModChips(l) {
    var row = $("modRow"),
      list = modList(l);
    row.hidden = !list.length;
    row.innerHTML = "";
    list.forEach(function (key) {
      var m = MODIFIERS[key];
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "mod-chip mod-" + key;
      chip.title = m.desc(l.tuning || TUNING);
      chip.innerHTML =
        Icon(m.icon) +
        "<b>" +
        m.label +
        "</b>" +
        (key === "shuffle" ? '<small id="shuffleCount"></small>' : "");
      chip.addEventListener("click", function () {
        toast(m.desc(l.tuning || TUNING), m.icon);
      });
      row.appendChild(chip);
    });
  }

  /* ---------- board sizing ----------
     Fit the whole board on one screen: the card grid is limited by the
     available height as well as the width, so no level ever needs scrolling
     on a phone. The 3D layer follows via its ResizeObserver. */
  function fitBoard() {
    var board = $("board");
    if (!board || activeScreen() !== "game" || !boardRows) return;
    var wrap = board.parentElement;
    var cw = wrap.clientWidth;
    if (!cw) return;
    var gap = parseFloat(getComputedStyle(board).columnGap) || 8;
    var top = board.getBoundingClientRect().top + window.scrollY;
    var bar = $("actionBar");
    var fixedBar = bar && getComputedStyle(bar).position === "fixed";
    var reserve = fixedBar ? bar.offsetHeight + 14 : 28;
    var availH = Math.max(fixedBar ? 220 : 420, window.innerHeight - top - reserve);
    var cardH = (availH - gap * (boardRows - 1)) / boardRows;
    var w = cardH * 0.82 * boardCols + gap * (boardCols - 1);
    board.style.maxWidth = Math.floor(Math.max(200, Math.min(cw, w))) + "px";
  }

  var fitRaf = 0;
  window.addEventListener("resize", function () {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(fitBoard);
  });

  /* ---------- level sheet (intro + pause) ---------- */
  function levelNumberLabel() {
    return isDailyRound ? "ӨДРИЙН СОРИЛТ · " + todayKey() : "ТҮВШИН " + pad2(level + 1);
  }

  function renderSheetInfo(l) {
    var pairCount = (l.rows * l.cols) / 2;
    var threeStarMoves = Math.max(
      pairCount,
      Math.floor(pairCount * Scoring.STAR_THRESHOLDS.threeStarMoveRatio),
    );
    var threeStarTimePct = Math.round(Scoring.STAR_THRESHOLDS.threeStarTimeRatio * 100);
    var best = isDailyRound ? data.daily.bestScore : data.scores[level];
    var stars = isDailyRound ? 0 : data.stars[level] || 0;
    $("sheetEyebrow").textContent = levelNumberLabel();
    $("sheetTitle").textContent = l.name;
    $("sheetFacts").innerHTML =
      '<span style="' + tierColorStyle(l) + '" class="fact tier">' + Icon(l.tierIcon) + l.tier + "</span>" +
      '<span class="fact">' + Icon("layers") + pairCount + " хос</span>" +
      '<span class="fact">' + Icon("timer") + fmt(l.time) + "</span>" +
      (best ? '<span class="fact gold">' + Icon("trophy") + best + "</span>" : "") +
      (stars ? '<span class="fact gold">' + starsText(stars) + "</span>" : "");
    var list = modList(l);
    $("sheetMods").innerHTML = list
      .map(function (k) {
        var m = MODIFIERS[k];
        return (
          '<div class="sheet-mod mod-' + k + '"><span class="ic">' + Icon(m.icon) + "</span><div><b>" +
          m.label + "</b><small>" + m.desc(l.tuning || TUNING) + "</small></div></div>"
        );
      })
      .join("");
    $("sheetGoal").innerHTML =
      Icon("star") +
      "<span><b>3 од:</b> " + threeStarMoves + " буюу түүнээс цөөн нүүдэл, хугацааны " +
      threeStarTimePct + "%-иас илүүг үлдээ.</span>";
  }

  function sheetButton(cls, icon, label, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.innerHTML = (icon ? Icon(icon) : "") + "<span>" + label + "</span>";
    b.addEventListener("click", fn);
    return b;
  }

  function openSheet(mode) {
    var sheet = $("levelSheet");
    sheet.setAttribute("data-mode", mode);
    renderSheetInfo(levelDef);
    var actions = $("sheetActions");
    actions.innerHTML = "";
    if (mode === "intro") {
      actions.appendChild(sheetButton("primary big", "play", "Эхлэх", startFromIntro));
      actions.appendChild(sheetButton("secondary", "arrow-left", "Буцах", goHome));
    } else {
      $("sheetEyebrow").textContent = "ТҮР ЗОГСЛОО · " + levelNumberLabel();
      actions.appendChild(sheetButton("primary big", "play", "Үргэлжлүүлэх", resume));
      actions.appendChild(sheetButton("secondary", "rotate-ccw", "Дахин эхлэх", function () {
        closeSheet();
        restart();
      }));
      actions.appendChild(
        sheetButton("secondary", data.soundOn ? "volume-2" : "volume-x", data.soundOn ? "Дуу унтраах" : "Дуу асаах", function () {
          applySound(!data.soundOn);
          openSheet("pause");
        }),
      );
      actions.appendChild(sheetButton("secondary danger", "home", "Гарах", goHome));
    }
    sheet.classList.add("open");
    var primary = actions.querySelector(".primary");
    if (primary) primary.focus({ preventScroll: true });
  }

  function closeSheet() {
    $("levelSheet").classList.remove("open");
  }

  function sheetOpen() {
    return $("levelSheet").classList.contains("open");
  }

  function startFromIntro() {
    if (phase !== "intro") return;
    closeSheet();
    startClock();
  }

  /* ---------- game flow ---------- */
  function startLevel(i, withIntro) {
    isDailyRound = false;
    level = i;
    beginRound(LEVELS[i], withIntro);
  }

  function startDaily() {
    isDailyRound = true;
    beginRound(DAILY_LEVEL, true);
  }

  function pickEmojis(pairCount) {
    if (isDailyRound) {
      // Same glyphs and same layout for everyone on the same calendar day.
      return seededShuffle(EMOJIS.slice(0, BASE_EMOJI_POOL), "emoji-" + todayKey()).slice(0, pairCount);
    }
    var pool = EMOJIS.slice(0, Math.max(BASE_EMOJI_POOL, pairCount));
    // Boss boards need every glyph; otherwise pick a fresh random set each round.
    return shuffleInPlace(pool.slice()).slice(0, pairCount);
  }

  function beginRound(l, withIntro) {
    if (phase !== "done" && phase !== "idle") data.stats.pairs += pairs;
    stopTimers();
    clearTimeout(resultTimer);
    resultTimer = null;
    closeAllModals();
    levelDef = l;
    timeLeft = l.time;
    totalTime = l.time;
    score = 0;
    moves = 0;
    pairs = 0;
    combo = 0;
    maxCombo = 0;
    pairPoints = 0;
    hintPenalty = 0;
    first = null;
    second = null;
    lock = false;
    hintUsed = false;
    phase = "idle";

    var pairCount = (l.rows * l.cols) / 2;
    var chosen = pickEmojis(pairCount);
    var deck = [].concat(chosen, chosen).map(function (emoji, index) {
      return { emoji: emoji, id: index, matched: false, flipped: false };
    });
    // The Daily Challenge uses a date-seeded shuffle so every attempt that same
    // calendar day lands on the identical layout; normal levels stay random.
    cards = isDailyRound ? seededShuffle(deck, todayKey()) : shuffleInPlace(deck);

    mods = {};
    modList(l).forEach(function (k) {
      mods[k] = true;
    });
    // Wide boards turn portrait on narrow portrait screens so cards stay tappable.
    var portrait = l.cols > l.rows && window.innerWidth < 640 && window.innerHeight > window.innerWidth;
    boardRows = portrait ? l.cols : l.rows;
    boardCols = portrait ? l.rows : l.cols;
    tune = l.tuning || TUNING;
    missesSinceShuffle = 0;
    var goldenEmoji = mods.golden
      ? chosen[Math.floor(Math.random() * chosen.length)]
      : null;
    cards.forEach(function (c) {
      c.golden = c.emoji === goldenEmoji;
      c.frozen = false;
    });
    if (mods.frozen) pickFrozen();

    $("levelBadgeName").textContent = isDailyRound
      ? l.name
      : pad2(level + 1) + ". " + l.name;
    $("levelBadgeSub").textContent =
      boardRows + "×" + boardCols + " самбар · " + pairCount + " хос";
    var tierTag = $("levelTierTag");
    tierTag.textContent = l.tier;
    $("levelBadge").style.cssText = tierColorStyle(l);
    $("goalText").textContent =
      pairCount + " хосыг " + fmt(l.time) + " дотор ол.";
    var threeStarMoves = Math.max(
      pairCount,
      Math.floor(pairCount * Scoring.STAR_THRESHOLDS.threeStarMoveRatio),
    );
    var threeStarTimePct = Math.round(
      Scoring.STAR_THRESHOLDS.threeStarTimeRatio * 100,
    );
    $("starText").textContent =
      "3 од авах нөхцөл: нүүдэл " +
      threeStarMoves +
      " буюу түүнээс цөөн, үлдсэн хугацаа " +
      threeStarTimePct +
      " хувиас их.";
    $("tipText").textContent = isDailyRound
      ? "Өдрийн сорилт: өнөөдөр бүх хүн яг ижил самбар тоглоно!"
      : level < 4
        ? "Зөвлөгөө: Эргүүлсэн хөзрийн байрлалыг сайн тогтоогоорой."
        : "Мастерын зөвлөгөө: Самбарыг хэсэг хэсгээр нь цээжилж, хосуудыг дарааллаар олоорой.";
    if (modList(l).length) {
      $("tipText").textContent =
        "Тусгай дүрэм: " +
        modList(l)
          .map(function (k) {
            return MODIFIERS[k].desc(l.tuning || TUNING);
          })
          .join(" ");
    }
    renderModChips(l);

    var board = $("board");
    board.innerHTML = "";
    board.classList.remove("paused");
    board.style.gridTemplateColumns = "repeat(" + boardCols + ",minmax(0,1fr))";
    board.setAttribute("data-cols", boardCols);
    cards.forEach(function (c, index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "memory-card" + (c.golden ? " golden" : "") + (c.frozen ? " frozen" : "");
      btn.setAttribute("aria-label", c.frozen ? "Мөстэй хөзөр" : "Нуугдсан хөзөр");
      btn.innerHTML =
        '<span class="card-inner"><span class="card-face card-back"><span>✦</span></span><span class="card-face card-front">' +
        c.emoji +
        "</span></span>";
      // pointerdown reacts faster than click on touch screens; keyboard and
      // assistive-tech activations arrive as clicks with detail 0.
      btn.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        flipCard(index);
      });
      btn.addEventListener("click", function (e) {
        if (e.detail === 0) flipCard(index);
      });
      c.element = btn;
      board.appendChild(btn);
    });
    var particleLayer = document.createElement("div");
    particleLayer.className = "particle-layer";
    particleLayer.id = "particleLayer";
    board.appendChild(particleLayer);

    $("pauseIcon").innerHTML = Icon("pause");
    $("pauseLabel").textContent = "Зогсоох";
    updateHintBadge();
    updateComboBadge();
    mascotSay("🧠", "Бэлэн үү?", false);
    updateMetrics();
    showScreen("game");
    fitBoard();
    // Mount after the screen is visible so the 3D layer can measure the card grid.
    board3d = Board3D ? Board3D.mount(board, cards) : null;
    if (!board3d) {
      cards.forEach(function (c, index) {
        attachTilt(c.element, {
          maxDeg: 14,
          isDisabled: function () {
            return cards[index].flipped || cards[index].matched;
          },
        });
      });
    }
    if (withIntro) {
      phase = "intro";
      openSheet("intro");
    } else {
      startClock();
    }
  }

  function startClock() {
    data.stats.games++;
    save();
    if (mods.peek) {
      startPeek();
      return;
    }
    phase = "play";
    if (modList(levelDef).length) {
      mascotSay(
        "🧠",
        "Шинэ дүрэм: " +
          modList(levelDef)
            .map(function (k) {
              return MODIFIERS[k].label;
            })
            .join(", "),
        false,
      );
    } else {
      mascotSay("🧠", "Эхэллээ!", true);
    }
    runClock();
  }

  function runClock() {
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  }

  // Closes a mismatched pair right away (when the player taps a third card
  // instead of waiting out the delay).
  function resolveMismatch() {
    if (!mismatchTimer) return;
    clearTimeout(mismatchTimer);
    mismatchTimer = null;
    var a = cards[first],
      b = cards[second];
    [a, b].forEach(function (c) {
      c.flipped = false;
      c.element.classList.remove("flipped", "shake");
      c.element.setAttribute("aria-label", c.frozen ? "Мөстэй хөзөр" : "Нуугдсан хөзөр");
    });
    first = second = null;
    lock = false;
    maybeShuffle();
  }

  function flipCard(i) {
    if (phase !== "play" || cards[i].matched) return;
    // Tapping during the mismatch delay closes that pair at once — including
    // a tap on one of the two wrong cards, which then flips as a fresh pick.
    if (mismatchTimer && lock) resolveMismatch();
    if (lock || cards[i].flipped) return;
    if (cards[i].frozen) {
      nudge(i);
      return;
    }
    var btn = cards[i].element;
    cards[i].flipped = true;
    btn.classList.add("flipped");
    btn.setAttribute("aria-label", cards[i].emoji);
    playTone(520, 0.05);
    buzz(8);

    if (first === null) {
      first = i;
      return;
    }
    second = i;
    moves++;
    lock = true;
    var ia = first,
      ib = second;
    var a = cards[ia],
      b = cards[ib];

    if (a.emoji === b.emoji) {
      a.matched = b.matched = true;
      a.element.classList.add("matched");
      b.element.classList.add("matched");
      a.element.disabled = b.element.disabled = true;
      pairs++;
      combo++;
      maxCombo = Math.max(maxCombo, combo);
      var gained = Scoring.pairScore(combo);
      score += gained;
      pairPoints += gained;
      // Rising pitch with the combo makes streaks feel good.
      var lift = Math.min(combo - 1, 6) * 60;
      chord([660 + lift, 880 + lift], 0.07, 0.14, "triangle");
      buzz(combo > 1 ? [15, 30, 25] : 20);
      burstAt(a.element);
      burstAt(b.element);
      floatScore(b.element, "+" + gained, a.golden ? "gold" : combo > 1 ? "combo" : "");
      updateComboBadge();
      first = second = null;
      lock = false;
      var extra = "";
      if (a.golden) {
        timeLeft += tune.goldenBonus;
        extra += "+" + tune.goldenBonus + " сек";
        playTone(1046, 0.18, "triangle", 0.12);
        floatScore(a.element, "+" + tune.goldenBonus + "с", "time");
      }
      var thawed = mods.frozen && thawAround([ia, ib]);
      updateMetrics();
      if (pairs === cards.length / 2) {
        finish(true);
        return;
      }
      if (a.golden) {
        mascotSay("⚡", "Алтан хос! " + extra, true);
        toast("Алтан хос! " + extra, "zap");
      } else if (thawed) {
        mascotSay("❄️", "Мөс хайллаа!", true);
      } else if (combo > 1) {
        mascotSay(combo >= 4 ? "🔥" : "🤩", combo + " хос дараалан!", true);
      } else {
        mascotSay("😊", ["Сайн байна!", "Зөв!", "Гоё!", "Яг таг!"][pairs % 4], true);
      }
    } else {
      combo = 0;
      if (mods.shuffle) missesSinceShuffle++;
      updateComboBadge();
      mascotSay("🤔", "Дахиад оролдооч", false);
      playTone(300, 0.09, "sine");
      buzz(40);
      a.element.classList.add("shake");
      b.element.classList.add("shake");
      mismatchTimer = setTimeout(resolveMismatch, MISMATCH_MS);
      updateMetrics();
    }
  }

  function updateMetrics() {
    $("timeMetric").textContent = fmt(timeLeft);
    $("scoreMetric").textContent = score;
    $("movesMetric").textContent = moves;
    $("pairsMetric").textContent = pairs + "/" + (cards.length / 2 || 0);
    // Golden pairs can push timeLeft past the level's starting time.
    $("timerFill").style.width =
      Math.min(100, (timeLeft / totalTime) * 100) + "%";
    var shuffleCount = $("shuffleCount");
    if (shuffleCount)
      shuffleCount.textContent = missesSinceShuffle + "/" + tune.shuffleEvery;
    var low = timeLeft <= Math.max(10, totalTime * 0.22);
    $("timerFill").classList.toggle("low", low);
    $("timeStat").classList.toggle("low", low && phase === "play");
  }

  function tick() {
    if (phase !== "play") return;
    timeLeft--;
    data.stats.playSeconds++;
    updateMetrics();
    if (timeLeft > 0 && timeLeft <= 5) {
      playTone(timeLeft === 1 ? 990 : 820, 0.05, "square");
      if (timeLeft <= 3) buzz(15);
    }
    if (timeLeft <= 0) {
      timeLeft = 0;
      updateMetrics();
      finish(false);
    }
  }

  function updateHintBadge() {
    var badge = $("hintBadge");
    badge.textContent = hintUsed ? "0" : "1";
    $("hintBtn").classList.toggle("used", hintUsed);
  }

  function finish(won) {
    stopTimers();
    lock = true;
    phase = "done";
    closeSheet();
    var elapsed = totalTime - timeLeft;
    var pairCount = cards.length / 2;
    var stars = won
      ? Scoring.calcStars(moves, pairCount, timeLeft, totalTime)
      : 0;
    var streakMsg = "";
    var timeBonus = 0,
      effBonus = 0,
      newRecord = false;

    data.stats.pairs += pairs;
    data.stats.bestCombo = Math.max(data.stats.bestCombo || 0, maxCombo);

    if (won) {
      timeBonus = Scoring.timeBonus(timeLeft);
      effBonus = Scoring.efficiencyBonus(moves, pairCount);
      score += timeBonus + effBonus;
      data.stats.wins++;
      if (moves === pairCount) data.stats.perfect++;
      if (!hintUsed) data.stats.noHintWins++;

      if (isDailyRound) {
        var today = todayKey();
        if (data.daily.lastDate !== today) {
          var gap = data.daily.lastDate
            ? daysBetweenKeys(data.daily.lastDate, today)
            : null;
          data.daily.streak = gap === 1 ? data.daily.streak + 1 : 1;
          data.daily.lastDate = today;
          data.daily.bestScore = 0; // best score is per day
        }
        data.daily.bestStreak = Math.max(data.daily.bestStreak || 0, data.daily.streak);
        newRecord = score > (data.daily.bestScore || 0) && data.daily.bestScore > 0;
        data.daily.bestScore = Math.max(data.daily.bestScore || 0, score);
        streakMsg = " " + data.daily.streak + " өдөр дараалан тогллоо! 🔥";
      } else {
        newRecord = score > (data.scores[level] || 0) && (data.scores[level] || 0) > 0;
        data.bestScore = Math.max(data.bestScore, score);
        data.unlocked = Math.max(
          data.unlocked,
          Math.min(LEVELS.length, level + 2),
        );
        if (data.completed.indexOf(level) < 0) {
          data.completed.push(level);
          data.totalWins++;
        }
        data.stars[level] = Math.max(data.stars[level] || 0, stars);
        data.scores[level] = Math.max(data.scores[level] || 0, score);
      }
      chord([523, 659, 784, 1046], 0.1, 0.24, "triangle");
      buzz([30, 60, 30, 60, 80]);
      mascotSay(
        stars === 3 ? "🏆" : stars === 2 ? "🌟" : "🎉",
        isDailyRound ? "Өдрийн сорилт!" : "Чи яллаа!",
        true,
      );
    } else {
      chord([330, 262, 196], 0.14, 0.26, "sine");
      buzz([80, 60, 120]);
      mascotSay("😮", "Дахин оролдоё", false);
    }

    var fresh = Achievements.check(
      data,
      {
        won: won,
        daily: isDailyRound,
        tierKey: levelDef.tierKey,
        moves: moves,
        pairCount: pairCount,
        hintUsed: hintUsed,
        timeLeft: timeLeft,
        totalTime: totalTime,
        stars: stars,
      },
      todayKey(),
    );
    save();

    lastResult = {
      won: won,
      daily: isDailyRound,
      level: level,
      name: levelDef.name,
      score: score,
      stars: stars,
      moves: moves,
      elapsed: elapsed,
    };
    renderResult(won, stars, elapsed, {
      pairPoints: pairPoints,
      timeBonus: timeBonus,
      effBonus: effBonus,
      hintPenalty: hintPenalty,
      newRecord: newRecord,
      streakMsg: streakMsg,
      fresh: fresh,
    });

    refreshHome();
    function reveal() {
      resultTimer = null;
      showScreen("result");
      animateResultStars(stars);
      if (won && stars >= 2) fireConfetti();
    }
    // Results/progress are already saved above; on a 3D win we only hold the
    // result screen briefly so the board's celebration wave can play.
    if (won && board3d && !reducedMotion()) {
      board3d.celebrate();
      resultTimer = setTimeout(reveal, 1150);
    } else {
      resultTimer = setTimeout(reveal, won ? 350 : 600);
    }
  }

  function renderResult(won, stars, elapsed, info) {
    $("resultIcon").innerHTML = Icon(
      won
        ? stars === 3
          ? "trophy"
          : stars === 2
            ? "star"
            : "sparkles"
        : "hourglass",
    );
    $("resultIcon").classList.toggle("lost", !won);
    $("resultEyebrow").textContent = won
      ? isDailyRound
        ? "ӨДРИЙН СОРИЛТЫГ ДАВЛАА"
        : "ТҮВШИН " + pad2(level + 1) + " ДАВЛАА"
      : "ДАХИН ОРОЛДООД ҮЗ!";
    $("resultTitle").textContent = won
      ? stars === 3
        ? "Гайхалтай!"
        : stars === 2
          ? "Маш сайн!"
          : "Сайн байна!"
      : "Хугацаа дууслаа";
    $("resultMessage").textContent = won
      ? isDailyRound
        ? "Өнөөдрийн сорилтыг амжилттай дуусгалаа!" + info.streakMsg
        : levelDef.name +
          " түвшнийг амжилттай давлаа! " +
          (level === LEVELS.length - 1
            ? "Чи жинхэнэ Memory Legend боллоо!"
            : stars < 3
              ? "Цөөн нүүдлээр, хурдан дуусгавал 3 од авна."
              : "Дараагийн түвшин чамайг хүлээж байна.")
      : pairs +
        "/" +
        cards.length / 2 +
        " хос оллоо. Бага зэрэг амраад дахин оролдоорой — хосуудын байрлалыг тогтоох нь амжилтын түлхүүр!";
    $("resultScore").textContent = score;
    $("resultTime").textContent = fmt(elapsed);
    $("resultMoves").textContent = moves;
    $("resultStars").innerHTML = won
      ? [0, 1, 2]
          .map(function (k) {
            return '<span class="rs" data-k="' + k + '">' + Icon("star") + "</span>";
          })
          .join("")
      : "";
    $("recordBadge").hidden = !info.newRecord;

    var rows = [["Хос олсон оноо", info.pairPoints]];
    if (won) {
      rows.push(["Хугацааны урамшуулал", info.timeBonus]);
      rows.push(["Цөөн нүүдлийн урамшуулал", info.effBonus]);
    }
    if (info.hintPenalty) rows.push(["Тусламж", -info.hintPenalty]);
    if (maxCombo > 1) rows.push(["Хамгийн урт цуврал", "x" + maxCombo]);
    $("resultBreakdown").innerHTML = rows
      .map(function (r) {
        var v = r[1];
        var txt = typeof v === "number" ? (v > 0 ? "+" + v : String(v)) : v;
        var cls = typeof v === "number" ? (v < 0 ? "neg" : v > 0 ? "pos" : "") : "";
        return "<li><span>" + r[0] + '</span><b class="' + cls + '">' + txt + "</b></li>";
      })
      .join("");

    var achv = $("resultAchv");
    achv.hidden = !info.fresh.length;
    achv.innerHTML = info.fresh.length
      ? '<div class="new-achv-title">' + Icon("medal") + " Шинэ шагнал!</div>" +
        info.fresh
          .map(function (a) {
            return '<div class="new-achv-item">' + Icon(a.icon) + "<div><b>" + a.title + "</b><small>" + a.desc + "</small></div></div>";
          })
          .join("")
      : "";

    var canNext = won && !isDailyRound && level < LEVELS.length - 1;
    $("nextBtn").style.display = canNext ? "" : "none";
    $("replayBtn").classList.toggle("primary", !canNext);
    $("replayBtn").classList.toggle("secondary", canNext);
  }

  function animateResultStars(stars) {
    var els = document.querySelectorAll("#resultStars .rs");
    els.forEach(function (el, k) {
      el.classList.remove("on");
      if (k < stars) {
        setTimeout(function () {
          el.classList.add("on");
          playTone(700 + k * 180, 0.12, "triangle");
        }, reducedMotion() ? 0 : 250 + k * 280);
      }
    });
  }

  function fireConfetti() {
    var layer = $("confettiLayer");
    layer.innerHTML = "";
    if (reducedMotion()) return;
    var colors = ["#5ee7ff", "#9c72ff", "#ffd35a", "#ff5a86", "#34d399"];
    var count = isSmallScreen() ? 28 : 50;
    for (var k = 0; k < count; k++) {
      var piece = document.createElement("span");
      piece.className = "confetti-piece";
      var dur = 1.6 + Math.random() * 1.2;
      piece.style.left = Math.random() * 100 + "%";
      piece.style.background = colors[k % colors.length];
      piece.style.animationDuration = dur + "s";
      piece.style.animationDelay = Math.random() * 0.4 + "s";
      piece.style.transform =
        "rotate(" + Math.floor(Math.random() * 360) + "deg)";
      layer.appendChild(piece);
    }
    setTimeout(function () {
      layer.innerHTML = "";
    }, 3200);
  }

  function shareResult() {
    if (!lastResult) return;
    var r = lastResult;
    var title = r.daily ? "Өдрийн сорилт " + todayKey() : "Түвшин " + pad2(r.level + 1) + " · " + r.name;
    var text =
      "🧠 Memory Master — " + title + "\n" +
      (r.won ? starsText(r.stars) + " · " : "") +
      r.score + " оноо · " + r.moves + " нүүдэл · " + fmt(r.elapsed);
    var url = location.protocol.indexOf("http") === 0 ? location.href.split("#")[0] : "";
    if (navigator.share) {
      navigator.share({ title: "Memory Master", text: text, url: url || undefined }).catch(function () {});
      return;
    }
    var full = text + (url ? "\n" + url : "");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(
        function () {
          toast("Үр дүнг хуулж авлаа!", "copy");
        },
        function () {
          toast("Хуулж чадсангүй", "x");
        },
      );
    } else {
      toast(text, "share");
    }
  }

  function restart() {
    if (isDailyRound) {
      isDailyRound = true;
      beginRound(DAILY_LEVEL, false);
    } else {
      startLevel(level, false);
    }
  }

  function stopRound() {
    stopTimers();
    clearTimeout(resultTimer);
    resultTimer = null;
    if (phase !== "done" && phase !== "idle") {
      data.stats.pairs += pairs;
      save();
    }
    phase = "idle";
    $("board").classList.remove("paused");
  }

  function showHome() {
    closeAllModals();
    showScreen("home");
    refreshHome();
  }

  function goHome() {
    stopRound();
    closeAllModals();
    var inApp = false;
    try {
      inApp = !!(history.state && history.state.mm);
    } catch (e) { /* ignore */ }
    if (inApp) history.back(); // popstate → showHome()
    else showHome();
  }

  function pause() {
    if (phase !== "play") return;
    phase = "paused";
    clearInterval(timer);
    timer = null;
    $("board").classList.add("paused");
    $("pauseIcon").innerHTML = Icon("play");
    $("pauseLabel").textContent = "Үргэлжлүүлэх";
    openSheet("pause");
  }

  function resume() {
    if (phase !== "paused") return;
    closeSheet();
    phase = "play";
    $("board").classList.remove("paused");
    $("pauseIcon").innerHTML = Icon("pause");
    $("pauseLabel").textContent = "Зогсоох";
    runClock();
  }

  function togglePause() {
    if (phase === "play") pause();
    else if (phase === "paused") resume();
  }

  function hint() {
    if (phase !== "play") return;
    if (lock && mismatchTimer) resolveMismatch();
    if (lock) return;
    if (hintUsed) {
      toast("Тусламжийг түвшин бүрт зөвхөн нэг удаа ашиглана.", "lock");
      return;
    }
    // Hide a lone face-up pick first so the hint can't be mistaken for it.
    if (first !== null) {
      var c0 = cards[first];
      c0.flipped = false;
      c0.element.classList.remove("flipped");
      c0.element.setAttribute("aria-label", "Нуугдсан хөзөр");
      first = null;
    }
    var unmatched = cards
      .map(function (c, i) {
        return Object.assign({}, c, { index: i });
      })
      .filter(function (c) {
        return !c.matched;
      });
    function findPair(list) {
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          if (list[i].emoji === list[j].emoji) return [list[i], list[j]];
        }
      }
      return null;
    }
    // Prefer a pair the player can actually pick right now (not iced over).
    var pair =
      findPair(
        unmatched.filter(function (c) {
          return !c.frozen;
        }),
      ) || findPair(unmatched);
    if (!pair) return;
    hintUsed = true;
    updateHintBadge();
    mascotSay("💡", "Энд хараарай!", true);
    lock = true; // block real picks while the hint is peeking, so a tap on a hinted
    // card can't become the player's real "first" pick mid-reveal and
    // then get its flipped state silently wiped by the cleanup below.
    var before = score;
    score = Math.max(0, score - HINT_COST);
    hintPenalty += before - score;
    pair.forEach(function (c) {
      c.element.classList.add("flipped");
    });
    playTone(660, 0.1);
    hintTimer = setTimeout(function () {
      pair.forEach(function (c) {
        if (!c.matched) c.element.classList.remove("flipped");
      });
      lock = false;
      hintTimer = null;
    }, 1000);
    updateMetrics();
    toast("Тусламж ашиглалаа: -" + HINT_COST + " оноо", "lightbulb");
  }

  /* ---------- modals ---------- */
  function openModal(id) {
    $(id).classList.add("open");
    var close = $(id).querySelector(".modal-close");
    if (close) close.focus({ preventScroll: true });
  }
  // Generic modals only — the level sheet is driven by the round state.
  function closeModals() {
    document.querySelectorAll(".modal-backdrop:not(#levelSheet)").forEach(function (m) {
      m.classList.remove("open");
    });
  }
  function closeAllModals() {
    closeModals();
    closeSheet();
  }
  function anyModalOpen() {
    return !!document.querySelector(".modal-backdrop.open:not(#levelSheet)");
  }

  function renderAchievements() {
    var stars = totalStars();
    $("achvStars").textContent = stars + " / " + LEVELS.length * 3;
    $("achvLevels").textContent = data.completed.length + " / " + LEVELS.length;
    $("achvScore").textContent = data.bestScore || 0;

    var s = data.stats;
    var mins = Math.round((s.playSeconds || 0) / 60);
    var statRows = [
      ["play", "Тоглосон", s.games],
      ["trophy", "Ялалт", s.wins],
      ["copy", "Олсон хос", s.pairs],
      ["flame", "Шилдэг цуврал", "x" + (s.bestCombo || 0)],
      ["calendar", "Шилдэг дараалал", (data.daily.bestStreak || 0) + " өдөр"],
      ["timer", "Тоглосон хугацаа", mins + " мин"],
    ];
    $("statList").innerHTML = statRows
      .map(function (r) {
        return '<div class="stat-item">' + Icon(r[0]) + "<span>" + r[1] + "</span><b>" + r[2] + "</b></div>";
      })
      .join("");

    var order = ["beginner", "simple", "medium", "hard", "master"];
    var wrap = $("tierBadges");
    wrap.innerHTML = "";
    order.forEach(function (key) {
      var idxs = LEVELS.map(function (l, i) {
        return l.tierKey === key ? i : -1;
      }).filter(function (i) {
        return i >= 0;
      });
      var earned =
        idxs.length > 0 &&
        idxs.every(function (i) {
          return data.completed.indexOf(i) >= 0;
        });
      var t = TIERS[key];
      var el = document.createElement("div");
      el.className = "tier-badge" + (earned ? " earned" : "");
      el.style.cssText = "--tier-color:var(" + t.color + ")";
      el.innerHTML = '<span class="ic">' + Icon(t.icon) + "</span>" + t.label;
      wrap.appendChild(el);
    });

    var list = Achievements.LIST;
    var earnedCount = 0;
    $("achvList").innerHTML = list
      .map(function (a) {
        var got = !!data.achv[a.id];
        if (got) earnedCount++;
        return (
          '<div class="achv-item' + (got ? " earned" : "") + '"><span class="ic">' + Icon(got ? a.icon : "lock") +
          "</span><div><b>" + a.title + "</b><small>" + a.desc + "</small></div></div>"
        );
      })
      .join("");
    $("achvCount").textContent = earnedCount + "/" + list.length;
    data.achvSeen = earnedCount;
    save();
  }

  function renderRating() {
    var list = $("ratingList");
    list.innerHTML = "";
    LEVELS.forEach(function (l, i) {
      var unlocked = i < data.unlocked;
      var stars = data.stars[i] || 0;
      var best = data.scores[i] || 0;
      var li = document.createElement("li");
      li.style.cssText = tierColorStyle(l);
      li.innerHTML =
        '<span class="rl-name">' +
        Icon(unlocked ? l.tierIcon : "lock") +
        " " +
        (i + 1) +
        ". " +
        l.name +
        "</span>" +
        '<span class="rl-stars">' +
        (unlocked ? starsText(stars) : "—") +
        "</span>" +
        '<span class="rl-score">' +
        best +
        "</span>";
      list.appendChild(li);
    });
  }

  /* ---------- settings ---------- */
  function systemTheme() {
    try {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch (e) {
      return "dark";
    }
  }

  function setThemeAttr(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    $("themeDarkBtn").classList.toggle("active", theme === "dark");
    $("themeLightBtn").classList.toggle("active", theme === "light");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#eef1fb" : "#080b20");
  }

  function applyTheme(theme) {
    data.theme = theme;
    setThemeAttr(theme);
    save();
  }

  function applySound(on) {
    data.soundOn = on;
    $("soundBtn").innerHTML = Icon(on ? "volume-2" : "volume-x");
    $("soundToggle").classList.toggle("on", on);
    $("soundToggle").setAttribute("aria-checked", String(on));
    save();
    if (on) playTone(600, 0.08);
  }

  function applyHaptics(on) {
    data.haptics = on;
    $("hapticToggle").classList.toggle("on", on);
    $("hapticToggle").setAttribute("aria-checked", String(on));
    save();
    if (on) buzz(25);
  }

  function applyVolume(v) {
    data.volume = v;
    $("volumeLabel").textContent = Math.round(v * 100) + "%";
    save();
  }

  var resetArmed = false,
    resetTimer = null;
  function onResetClick() {
    if (!resetArmed) {
      resetArmed = true;
      $("resetBtn").classList.add("armed");
      $("resetLabel").textContent = "Итгэлтэй байна уу? Дахин дар";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(disarmReset, 4000);
      return;
    }
    disarmReset();
    var keep = { theme: data.theme, soundOn: data.soundOn, volume: data.volume, haptics: data.haptics };
    Storage.reset();
    data = Object.assign(Storage.defaults(), keep);
    save();
    closeModals();
    refreshHome();
    toast("Ахиц устгагдлаа. Шинээр эхэлцгээе!", "rotate-ccw");
  }
  function disarmReset() {
    resetArmed = false;
    clearTimeout(resetTimer);
    $("resetBtn").classList.remove("armed");
    $("resetLabel").textContent = "Ахицыг устгах";
  }

  /* ---------- wire up ---------- */
  $("continueBtn").addEventListener("click", function () {
    startLevel(nextLevelIndex(), true);
  });
  $("allLevelsBtn").addEventListener("click", function () {
    showScreen("levels");
  });
  $("backHomeBtn").addEventListener("click", goHome);
  $("brandBtn").addEventListener("click", function () {
    if (activeScreen() === "game" && phase === "play") pause();
    else if (activeScreen() !== "home" && activeScreen() !== "game") goHome();
  });

  $("quitBtn").addEventListener("click", function () {
    if (phase === "play") pause();
    else if (phase === "paused") openSheet("pause");
    else goHome();
  });
  $("restartBtn").addEventListener("click", restart);
  $("pauseBtn").addEventListener("click", togglePause);
  $("hintBtn").addEventListener("click", hint);

  $("nextBtn").addEventListener("click", function () {
    startLevel(Math.min(level + 1, LEVELS.length - 1), true);
  });
  $("replayBtn").addEventListener("click", restart);
  $("shareBtn").addEventListener("click", shareResult);
  $("resultHomeBtn").addEventListener("click", goHome);
  $("dailyPlayBtn").addEventListener("click", startDaily);

  $("soundBtn").addEventListener("click", function () {
    applySound(!data.soundOn);
  });
  $("soundToggle").addEventListener("click", function () {
    applySound(!data.soundOn);
  });
  $("hapticToggle").addEventListener("click", function () {
    applyHaptics(!data.haptics);
  });
  $("resetBtn").addEventListener("click", onResetClick);

  $("settingsBtn").addEventListener("click", function () {
    if (phase === "play") pause();
    $("savedHighScore").textContent = data.bestScore || 0;
    disarmReset();
    openModal("settingsBackdrop");
  });
  $("rateBtn").addEventListener("click", function () {
    renderRating();
    openModal("rateBackdrop");
  });
  $("achvBtn").addEventListener("click", function () {
    renderAchievements();
    updateHomeStats();
    openModal("achvBackdrop");
  });
  $("helpBtn").addEventListener("click", function () {
    openModal("helpBackdrop");
  });

  document.querySelectorAll(".js-modal-close").forEach(function (btn) {
    btn.addEventListener("click", closeModals);
  });
  document.querySelectorAll(".modal-backdrop:not(#levelSheet)").forEach(function (backdrop) {
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModals();
    });
  });
  // Tapping outside the pause sheet resumes; the intro sheet needs an explicit choice.
  $("levelSheet").addEventListener("click", function (e) {
    if (e.target === $("levelSheet") && phase === "paused") resume();
  });

  $("themeDarkBtn").addEventListener("click", function () {
    applyTheme("dark");
  });
  $("themeLightBtn").addEventListener("click", function () {
    applyTheme("light");
  });
  $("volumeRange").addEventListener("input", function (e) {
    applyVolume(Number(e.target.value) / 100);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (anyModalOpen()) {
        closeModals();
        return;
      }
      if (sheetOpen()) {
        if (phase === "paused") resume();
        else if (phase === "intro") goHome();
        return;
      }
      if (activeScreen() === "game") togglePause();
    } else if ((e.key === "p" || e.key === "P") && activeScreen() === "game" && !anyModalOpen()) {
      togglePause();
    } else if ((e.key === "h" || e.key === "H") && phase === "play") {
      hint();
    }
  });

  // Never let the clock run while the app is in the background.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && phase === "play") pause();
  });

  window.addEventListener("popstate", function () {
    if (anyModalOpen()) {
      closeModals();
      if (activeScreen() !== "home") {
        try { history.pushState({ mm: 1 }, ""); } catch (e) { /* ignore */ }
      }
      return;
    }
    if (activeScreen() === "game" && (phase === "play" || phase === "peek")) {
      // Back during a round = pause, not quit.
      if (phase === "play") pause();
      try { history.pushState({ mm: 1 }, ""); } catch (e) { /* ignore */ }
      return;
    }
    stopRound();
    showHome();
  });

  /* ---------- init ---------- */
  window.MM.hydrateIcons();
  setThemeAttr(data.theme || systemTheme());
  try {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", function () {
      if (!data.theme) setThemeAttr(systemTheme());
    });
  } catch (e) { /* old Safari */ }
  $("soundBtn").innerHTML = Icon(data.soundOn ? "volume-2" : "volume-x");
  $("soundToggle").classList.toggle("on", !!data.soundOn);
  $("soundToggle").setAttribute("aria-checked", String(!!data.soundOn));
  $("hapticToggle").classList.toggle("on", !!data.haptics);
  $("hapticToggle").setAttribute("aria-checked", String(!!data.haptics));
  if (!navigator.vibrate) $("hapticToggle").closest(".modal-row").hidden = true;
  $("volumeRange").value = Math.round(
    (typeof data.volume === "number" ? data.volume : 0.7) * 100,
  );
  $("volumeLabel").textContent =
    Math.round((typeof data.volume === "number" ? data.volume : 0.7) * 100) +
    "%";
  document.body.setAttribute("data-screen", "home");
  if (!(Hero3D && Hero3D.mount($("heroArt")))) {
    attachTilt($("heroArt"), { target: $("heroOrb"), maxDeg: 10 });
  }
  // Older saves may have earned achievements before the system existed.
  if (Achievements.check(data, null, todayKey()).length) save();

  refreshHome();

  // Offline play / "Add to Home Screen" (only over http(s); file:// can't register).
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
