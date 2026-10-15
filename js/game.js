/* ===== Memory Master — Game logic ===== */
(function () {
  "use strict";

  var LEVELS = window.MM.LEVELS;
  var EMOJIS = window.MM.EMOJIS;
  var TIERS = window.MM.TIERS;
  var Storage = window.MM.Storage;
  var Scoring = window.MM.Scoring;
  var Icon = window.MM.Icon;
  var attachTilt = window.MM.attachTilt;
  var seededShuffle = window.MM.seededShuffle;
  var todayKey = window.MM.todayKey;
  var daysBetweenKeys = window.MM.daysBetweenKeys;
  var Board3D = window.MM.Board3D; // null when WebGL/Three.js is unavailable -> DOM cards
  var Hero3D = window.MM.Hero3D;

  var $ = function (id) {
    return document.getElementById(id);
  };

  var DAILY_LEVEL = {
    name: "Өдрийн сорилт",
    tier: "Өдрийн сорилт",
    tierColorVar: "--gold",
    tierIcon: "calendar",
    rows: 4,
    cols: 5,
    time: 70,
  };

  var data = Storage.load();
  var level = 0,
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
    combo = 0;
  var timer = null,
    mismatchTimer = null,
    hintTimer = null,
    mascotTimer = null,
    paused = false,
    startedAt = 0,
    hintUsed = false;
  var board3d = null,
    resultTimer = null;
  var audioCtx = null;

  /* ---------- helpers ---------- */
  function fmt(s) {
    s = Math.max(0, Math.ceil(s));
    return (
      String(Math.floor(s / 60)).padStart(2, "0") +
      ":" +
      String(s % 60).padStart(2, "0")
    );
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) {
      s.classList.remove("active");
    });
    $(name + "Screen").classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  function playTone(freq, duration, type) {
    if (!data.soundOn) return;
    freq = freq || 440;
    duration = duration || 0.07;
    type = type || "sine";
    try {
      audioCtx =
        audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator(),
        g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      var vol = 0.045 * (typeof data.volume === "number" ? data.volume : 0.7);
      g.gain.setValueAtTime(vol, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(
        0.001,
        audioCtx.currentTime + duration,
      );
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + duration);
    } catch (e) {
      /* audio unsupported — silently skip */
    }
  }

  function stopTimers() {
    clearInterval(timer);
    clearTimeout(mismatchTimer);
    clearTimeout(hintTimer);
    timer = null;
    mismatchTimer = null;
    hintTimer = null;
  }

  function tierColorStyle(level) {
    return "--tier-color:var(" + level.tierColorVar + ")";
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
      el.classList.add("show");
      el.classList.toggle("mega", combo >= 4);
    } else {
      el.classList.remove("show", "mega");
    }
  }

  function isSmallScreen() {
    return window.innerWidth <= 640;
  }

  function burstAt(el) {
    if (board3d) return; // the 3D board draws its own particle burst
    var board = $("board"),
      layer = $("particleLayer");
    if (!board || !layer || !el) return;
    var br = board.getBoundingClientRect(),
      er = el.getBoundingClientRect();
    var cx = er.left - br.left + er.width / 2,
      cy = er.top - br.top + er.height / 2;
    var colors = ["#5ee7ff", "#9c72ff", "#ffd35a", "#ff5a86", "#34d399"];
    var count = isSmallScreen() ? 6 : 10;
    for (var k = 0; k < count; k++) {
      var p = document.createElement("span");
      p.className = "particle";
      var ang = Math.random() * Math.PI * 2,
        dist = 26 + Math.random() * 30;
      p.style.left = cx + "px";
      p.style.top = cy + "px";
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
    $("homeBest").textContent = data.bestScore || 0;
    $("homeWins").textContent = data.totalWins || 0;
  }

  /* ---------- level cards ---------- */
  function makeLevelCard(i) {
    var l = LEVELS[i];
    var unlocked = i < data.unlocked;
    var stars = data.stars[i] || 0;
    var done = data.completed.includes(i);
    var pairCount = (l.rows * l.cols) / 2;
    var iconName = unlocked ? (done ? "check-circle" : l.tierIcon) : "lock";
    var iconClass =
      "level-icon" + (!unlocked ? " locked" : done ? " done" : "");
    var b = document.createElement("button");
    b.className = "level-card";
    b.disabled = !unlocked;
    b.style.cssText = tierColorStyle(l);
    b.innerHTML =
      '<span class="tier-pill">' +
      l.tier +
      "</span>" +
      '<span class="' +
      iconClass +
      '">' +
      Icon(iconName) +
      "</span>" +
      "<strong>" +
      String(i + 1).padStart(2, "0") +
      ". " +
      l.name +
      "</strong>" +
      "<small>" +
      l.rows +
      " × " +
      l.cols +
      " · " +
      pairCount +
      " хос<br>" +
      fmt(l.time) +
      " хугацаа</small>" +
      '<div class="progress">' +
      (unlocked
        ? done
          ? "★".repeat(stars) + "☆".repeat(3 - stars)
          : "НЭЭЛТТЭЙ"
        : "ӨМНӨХ ТҮВШИНГ ДАВ") +
      "</div>";
    b.addEventListener("click", function () {
      startLevel(i);
    });
    attachTilt(b, { maxDeg: 8 });
    return b;
  }

  function renderLevels() {
    var home = $("homeLevels"),
      all = $("allLevels");
    home.innerHTML = "";
    all.innerHTML = "";
    [0, 1, 2, 3].forEach(function (i) {
      home.appendChild(makeLevelCard(i));
    });
    LEVELS.forEach(function (_, i) {
      all.appendChild(makeLevelCard(i));
    });
    updateHomeStats();
  }

  function renderDailyBanner() {
    var btn = $("dailyPlayBtn"),
      streakEl = $("dailyStreakNum"),
      subEl = $("dailyBannerSub");
    if (!btn) return;
    var d = data.daily || { streak: 0, lastDate: null, bestScore: 0 };
    var playedToday = d.lastDate === todayKey();
    streakEl.textContent = d.streak || 0;
    subEl.textContent = playedToday
      ? "Өнөөдрийн сорилтыг дуусгалаа! Дахин тоглож оноогоо сайжруулж болно."
      : "Өдөр бүр шинэ 10 хос — дараалан тоглож streak-ээ өсгө!";
    btn.innerHTML =
      Icon("play") + " " + (playedToday ? "Дахин тоглох" : "Тоглох");
  }

  /* ---------- game flow ---------- */
  function startLevel(i) {
    isDailyRound = false;
    level = i;
    beginRound(LEVELS[i]);
  }

  function startDaily() {
    isDailyRound = true;
    beginRound(DAILY_LEVEL);
  }

  function beginRound(l) {
    stopTimers();
    clearTimeout(resultTimer);
    resultTimer = null;
    timeLeft = l.time;
    totalTime = l.time;
    score = 0;
    moves = 0;
    pairs = 0;
    combo = 0;
    first = null;
    second = null;
    lock = false;
    paused = false;
    hintUsed = false;
    startedAt = Date.now();

    var pairCount = (l.rows * l.cols) / 2;
    var chosen = EMOJIS.slice(0, pairCount);
    var deck = [].concat(chosen, chosen).map(function (emoji, index) {
      return { emoji: emoji, id: index, matched: false, flipped: false };
    });
    // The Daily Challenge uses a date-seeded shuffle so every attempt that same
    // calendar day lands on the identical layout; normal levels stay random.
    cards = isDailyRound
      ? seededShuffle(deck, todayKey())
      : (function () {
          for (var n = deck.length - 1; n > 0; n--) {
            var j = Math.floor(Math.random() * (n + 1));
            var tmp = deck[n];
            deck[n] = deck[j];
            deck[j] = tmp;
          }
          return deck;
        })();

    $("levelBadgeName").textContent = isDailyRound
      ? l.name
      : String(level + 1).padStart(2, "0") + ". " + l.name;
    $("levelBadgeSub").textContent =
      l.rows + "×" + l.cols + " самбар · " + pairCount + " хос";
    var tierTag = $("levelTierTag");
    tierTag.textContent = l.tier;
    tierTag.parentElement.style.cssText = tierColorStyle(l);
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
      "3 од: " +
      threeStarMoves +
      " буюу түүнээс цөөн нүүдэл хийж, хугацааны дээш " +
      threeStarTimePct +
      "%-ийг үлдээвэл.";
    $("tipText").textContent = isDailyRound
      ? "Өдрийн сорилт: энэ хувилбарыг өнөөдөр бүгд адилхан тоглоно!"
      : level < 4
        ? "Зөвлөгөө: Эргүүлсэн хөзрийн байрлалыг сайн тогтоогоорой."
        : "Мастерын зөвлөгөө: Самбарыг хэсэг хэсгээр нь цээжилж, хосуудыг дарааллаар олоорой.";

    var board = $("board");
    board.innerHTML = "";
    board.style.gridTemplateColumns = "repeat(" + l.cols + ",minmax(0,1fr))";
    cards.forEach(function (c, index) {
      var btn = document.createElement("button");
      btn.className = "memory-card";
      btn.setAttribute("aria-label", "Нуугдсан хөзөр");
      btn.innerHTML =
        '<span class="card-inner"><span class="card-face card-back"><span>✦</span></span><span class="card-face card-front">' +
        c.emoji +
        "</span></span>";
      btn.addEventListener("click", function () {
        flipCard(index, btn);
      });
      c.element = btn;
      board.appendChild(btn);
    });
    var particleLayer = document.createElement("div");
    particleLayer.className = "particle-layer";
    particleLayer.id = "particleLayer";
    board.appendChild(particleLayer);

    $("pauseIcon").innerHTML = Icon("pause");
    $("pauseLabel").textContent = "Түр зогсоох";
    updateComboBadge();
    mascotSay("🧠", "Бэлэн үү?", false);
    updateMetrics();
    showScreen("game");
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
    timer = setInterval(tick, 1000);
  }

  function flipCard(i, btn) {
    if (paused || lock || !timer || cards[i].matched || cards[i].flipped)
      return;
    if (!startedAt) startedAt = Date.now();
    cards[i].flipped = true;
    btn.classList.add("flipped");
    btn.setAttribute("aria-label", cards[i].emoji);
    playTone(520, 0.05);

    if (first === null) {
      first = i;
      return;
    }
    second = i;
    moves++;
    lock = true;
    var a = cards[first],
      b = cards[second];

    if (a.emoji === b.emoji) {
      a.matched = b.matched = true;
      a.element.classList.add("matched");
      b.element.classList.add("matched");
      a.element.disabled = b.element.disabled = true;
      pairs++;
      combo++;
      var gained = Scoring.pairScore(combo);
      score += gained;
      playTone(760, 0.12, "triangle");
      burstAt(a.element);
      burstAt(b.element);
      updateComboBadge();
      first = second = null;
      lock = false;
      updateMetrics();
      if (pairs === cards.length / 2) {
        finish(true);
        return;
      }
      if (combo > 1) {
        mascotSay("🤩", combo + " дараалаа!", true);
      } else {
        mascotSay("😊", "Сайн байна!", true);
      }
      toast(
        combo > 1
          ? combo + " дараалсан хос! +" + gained
          : "Зөв хос! +" + gained,
        combo > 1 ? "flame" : "sparkles",
      );
    } else {
      combo = 0;
      updateComboBadge();
      mascotSay("🤔", "Дахиад оролдооч", false);
      a.element.classList.add("shake");
      b.element.classList.add("shake");
      mismatchTimer = setTimeout(function () {
        a.flipped = b.flipped = false;
        a.element.classList.remove("flipped", "shake");
        b.element.classList.remove("flipped", "shake");
        a.element.setAttribute("aria-label", "Нуугдсан хөзөр");
        b.element.setAttribute("aria-label", "Нуугдсан хөзөр");
        first = second = null;
        lock = false;
      }, 750);
      updateMetrics();
    }
  }

  function updateMetrics() {
    $("timeMetric").textContent = fmt(timeLeft);
    $("scoreMetric").textContent = score;
    $("movesMetric").textContent = moves;
    $("pairsMetric").textContent = pairs + "/" + (cards.length / 2 || 0);
    $("timerFill").style.width = (timeLeft / totalTime) * 100 + "%";
    $("timerFill").classList.toggle(
      "low",
      timeLeft <= Math.max(10, totalTime * 0.22),
    );
  }

  function tick() {
    if (paused) return;
    timeLeft--;
    updateMetrics();
    if (timeLeft <= 0) {
      timeLeft = 0;
      updateMetrics();
      finish(false);
    }
  }

  function finish(won) {
    stopTimers();
    lock = true;
    paused = false;
    var elapsed = totalTime - timeLeft;
    var pairCount = cards.length / 2;
    var stars = won
      ? Scoring.calcStars(moves, pairCount, timeLeft, totalTime)
      : 0;
    var streakMsg = "";

    if (won) {
      score += Scoring.timeBonus(timeLeft);
      score += Scoring.efficiencyBonus(moves, pairCount);

      if (isDailyRound) {
        var today = todayKey();
        if (data.daily.lastDate !== today) {
          var gap = data.daily.lastDate
            ? daysBetweenKeys(data.daily.lastDate, today)
            : null;
          data.daily.streak = gap === 1 ? data.daily.streak + 1 : 1;
          data.daily.lastDate = today;
        }
        data.daily.bestScore = Math.max(data.daily.bestScore || 0, score);
        streakMsg = " " + data.daily.streak + " өдөр дараалан тогложээ!";
      } else {
        data.bestScore = Math.max(data.bestScore, score);
        data.unlocked = Math.max(
          data.unlocked,
          Math.min(LEVELS.length, level + 2),
        );
        if (!data.completed.includes(level)) {
          data.completed.push(level);
          data.totalWins++;
        }
        data.stars[level] = Math.max(data.stars[level] || 0, stars);
        data.scores[level] = Math.max(data.scores[level] || 0, score);
      }
      save();
      playTone(880, 0.22, "triangle");
      mascotSay(
        stars === 3 ? "🏆" : stars === 2 ? "🌟" : "🎉",
        isDailyRound ? "Өдрийн сорилт!" : "Чи яллаа!",
        true,
      );
    } else {
      playTone(180, 0.3, "sawtooth");
      mascotSay("😮", "Дахин оролдоё", false);
    }

    $("resultIcon").innerHTML = Icon(
      won
        ? stars === 3
          ? "trophy"
          : stars === 2
            ? "star"
            : "sparkles"
        : "hourglass",
    );
    $("resultEyebrow").textContent = won
      ? isDailyRound
        ? "ӨДРИЙН СОРИЛТ ДАВЛАА"
        : "ТҮВШИН ДАВЛАА"
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
        ? "Өнөөдрийн сорилтыг амжилттай дууслаа!" + streakMsg
        : LEVELS[level].name +
          " түвшнийг амжилттай давлаа! " +
          (level === LEVELS.length - 1
            ? "Чи жинхэнэ Memory Legend боллоо!"
            : "Дараагийн түвшин чамайг хүлээж байна.")
      : "Бага зэрэг амраад дахин оролдоорой. Хосуудын байрлалыг тогтоох нь амжилтын түлхүүр!";
    $("resultScore").textContent = score;
    $("resultTime").textContent = fmt(elapsed);
    $("resultStars").textContent = won
      ? "★".repeat(stars) + "☆".repeat(3 - stars)
      : "—";
    $("nextBtn").style.display =
      won && !isDailyRound && level < LEVELS.length - 1
        ? "inline-block"
        : "none";

    renderLevels();
    renderDailyBanner();
    function reveal() {
      resultTimer = null;
      showScreen("result");
      if (won && stars >= 2) fireConfetti();
    }
    // Results/progress are already saved above; on a 3D win we only hold the
    // result screen briefly so the board's celebration wave can play.
    if (
      won &&
      board3d &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      board3d.celebrate();
      resultTimer = setTimeout(reveal, 1150);
    } else {
      reveal();
    }
  }

  function fireConfetti() {
    var layer = $("confettiLayer");
    layer.innerHTML = "";
    var colors = ["#5ee7ff", "#9c72ff", "#ffd35a", "#ff5a86", "#34d399"];
    var count = isSmallScreen() ? 24 : 46;
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

  function restart() {
    if (isDailyRound) {
      startDaily();
    } else {
      startLevel(level);
    }
  }
  function quit() {
    stopTimers();
    clearTimeout(resultTimer);
    resultTimer = null;
    showScreen("home");
    renderLevels();
    renderDailyBanner();
  }

  function togglePause() {
    if (!timer && !paused) return;
    paused = !paused;
    $("pauseIcon").innerHTML = Icon(paused ? "play" : "pause");
    $("pauseLabel").textContent = paused ? "Үргэлжлүүлэх" : "Түр зогсоох";
    if (paused) {
      clearInterval(timer);
      timer = null;
      toast("Тоглоом түр зогслоо", "pause");
    } else {
      timer = setInterval(tick, 1000);
      toast("Үргэлжлүүллээ", "play");
    }
  }

  function hint() {
    if (paused || lock || !timer) return;
    if (hintUsed) {
      toast("Энэ түвшинд тусламжийг нэг удаа ашиглана.", "lock");
      return;
    }
    var unmatched = cards
      .map(function (c, i) {
        return Object.assign({}, c, { index: i });
      })
      .filter(function (c) {
        return !c.matched;
      });
    var pair = null;
    for (var i = 0; i < unmatched.length && !pair; i++) {
      for (var j = i + 1; j < unmatched.length; j++) {
        if (unmatched[i].emoji === unmatched[j].emoji) {
          pair = [unmatched[i], unmatched[j]];
          break;
        }
      }
    }
    if (!pair) return;
    hintUsed = true;
    mascotSay("💡", "Энд хараарай!", true);
    lock = true; // block real picks while the hint is peeking, so a tap on a hinted
    // card can't become the player's real "first" pick mid-reveal and
    // then get its flipped state silently wiped by the cleanup below.
    score = Math.max(0, score - 50);
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
    }, 850);
    updateMetrics();
    toast("Тусламж ашиглалаа: -50 оноо", "sparkles");
  }

  /* ---------- modals ---------- */
  function openModal(id) {
    $(id).classList.add("open");
  }
  function closeModals() {
    document.querySelectorAll(".modal-backdrop").forEach(function (m) {
      m.classList.remove("open");
    });
  }

  function renderAchievements() {
    var totalStars = Object.values(data.stars).reduce(function (a, b) {
      return a + b;
    }, 0);
    $("achvStars").textContent = totalStars + " / " + LEVELS.length * 3;
    $("achvLevels").textContent = data.completed.length + " / " + LEVELS.length;
    $("achvScore").textContent = data.bestScore || 0;

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
          return data.completed.includes(i);
        });
      var t = TIERS[key];
      var el = document.createElement("div");
      el.className = "tier-badge" + (earned ? " earned" : "");
      el.style.cssText = "--tier-color:var(" + t.color + ")";
      el.innerHTML = '<span class="ic">' + Icon(t.icon) + "</span>" + t.label;
      wrap.appendChild(el);
    });
  }

  function renderRating() {
    var list = $("ratingList");
    list.innerHTML = "";
    LEVELS.forEach(function (l, i) {
      var unlocked = i < data.unlocked;
      var stars = data.stars[i] || 0;
      var best = data.scores[i] || 0;
      var li = document.createElement("li");
      li.innerHTML =
        '<span class="rl-name">' +
        Icon(unlocked ? l.tierIcon : "lock") +
        " " +
        (i + 1) +
        ". " +
        l.name +
        "</span>" +
        '<span class="rl-stars">' +
        (unlocked ? "★".repeat(stars) + "☆".repeat(3 - stars) : "—") +
        "</span>" +
        '<span class="rl-score">' +
        best +
        "</span>";
      list.appendChild(li);
    });
  }

  /* ---------- settings ---------- */
  function applyTheme(theme) {
    data.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    $("themeDarkBtn").classList.toggle("active", theme === "dark");
    $("themeLightBtn").classList.toggle("active", theme === "light");
    save();
  }

  function applySound(on) {
    data.soundOn = on;
    $("soundBtn").innerHTML = Icon(on ? "volume-2" : "volume-x");
    $("soundToggle").classList.toggle("on", on);
    save();
    if (on) playTone(600, 0.08);
  }

  function applyVolume(v) {
    data.volume = v;
    $("volumeLabel").textContent = Math.round(v * 100) + "%";
    save();
  }

  /* ---------- wire up ---------- */
  $("continueBtn").addEventListener("click", function () {
    startLevel(Math.max(0, Math.min(data.unlocked - 1, LEVELS.length - 1)));
  });
  $("allLevelsBtn").addEventListener("click", function () {
    showScreen("levels");
  });
  $("backHomeBtn").addEventListener("click", function () {
    showScreen("home");
  });

  $("quitBtn").addEventListener("click", quit);
  $("restartBtn").addEventListener("click", restart);
  $("pauseBtn").addEventListener("click", togglePause);
  $("hintBtn").addEventListener("click", hint);

  $("nextBtn").addEventListener("click", function () {
    startLevel(Math.min(level + 1, LEVELS.length - 1));
  });
  $("replayBtn").addEventListener("click", restart);
  $("resultHomeBtn").addEventListener("click", function () {
    showScreen("home");
    renderLevels();
    renderDailyBanner();
  });
  $("dailyPlayBtn").addEventListener("click", startDaily);

  $("soundBtn").addEventListener("click", function () {
    applySound(!data.soundOn);
  });
  $("soundToggle").addEventListener("click", function () {
    applySound(!data.soundOn);
  });

  $("settingsBtn").addEventListener("click", function () {
    $("savedHighScore").textContent = data.bestScore || 0;
    openModal("settingsBackdrop");
  });
  $("rateBtn").addEventListener("click", function () {
    renderRating();
    openModal("rateBackdrop");
  });
  $("achvBtn").addEventListener("click", function () {
    renderAchievements();
    openModal("achvBackdrop");
  });
  $("helpBtn").addEventListener("click", function () {
    openModal("helpBackdrop");
  });

  document.querySelectorAll(".js-modal-close").forEach(function (btn) {
    btn.addEventListener("click", closeModals);
  });
  document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) {
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModals();
    });
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
      var anyOpen = Array.prototype.some.call(
        document.querySelectorAll(".modal-backdrop"),
        function (m) {
          return m.classList.contains("open");
        },
      );
      if (anyOpen) {
        closeModals();
        return;
      }
      if ($("gameScreen").classList.contains("active")) togglePause();
    }
  });

  /* ---------- init ---------- */
  window.MM.hydrateIcons();
  document.documentElement.setAttribute("data-theme", data.theme || "dark");
  $("themeDarkBtn").classList.toggle(
    "active",
    (data.theme || "dark") === "dark",
  );
  $("themeLightBtn").classList.toggle("active", data.theme === "light");
  $("soundBtn").innerHTML = Icon(data.soundOn ? "volume-2" : "volume-x");
  $("soundToggle").classList.toggle("on", !!data.soundOn);
  $("volumeRange").value = Math.round(
    (typeof data.volume === "number" ? data.volume : 0.7) * 100,
  );
  $("volumeLabel").textContent =
    Math.round((typeof data.volume === "number" ? data.volume : 0.7) * 100) +
    "%";
  if (!(Hero3D && Hero3D.mount($("heroArt")))) {
    attachTilt($("heroArt"), { target: $("heroOrb"), maxDeg: 10 });
  }

  renderLevels();
  renderDailyBanner();
})();
