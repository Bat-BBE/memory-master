/* ===== Memory Master — Game logic ===== */
(function () {
  "use strict";

  var LEVELS = window.MM.LEVELS;
  var EMOJIS = window.MM.EMOJIS;
  var Storage = window.MM.Storage;
  var Scoring = window.MM.Scoring;

  var $ = function (id) { return document.getElementById(id); };

  var data = Storage.load();
  var level = 0, cards = [], first = null, second = null, lock = false;
  var timeLeft = 0, totalTime = 0, score = 0, moves = 0, pairs = 0, combo = 0;
  var timer = null, mismatchTimer = null, paused = false, startedAt = 0, hintUsed = false;
  var audioCtx = null;

  /* ---------- helpers ---------- */
  function fmt(s) {
    s = Math.max(0, Math.ceil(s));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    $(name + "Screen").classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(function () { t.classList.remove("show"); }, 2100);
  }

  function playTone(freq, duration, type) {
    if (!data.soundOn) return;
    freq = freq || 440; duration = duration || 0.07; type = type || "sine";
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      var vol = 0.045 * (typeof data.volume === "number" ? data.volume : 0.7);
      g.gain.setValueAtTime(vol, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + duration);
    } catch (e) { /* audio unsupported — silently skip */ }
  }

  function stopTimers() {
    clearInterval(timer); clearTimeout(mismatchTimer);
    timer = null; mismatchTimer = null;
  }

  function tierColorStyle(level) {
    return "--tier-color:var(" + level.tierColorVar + ")";
  }

  /* ---------- persistence / stats ---------- */
  function save() { Storage.save(data); updateHomeStats(); }

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
    var b = document.createElement("button");
    b.className = "level-card";
    b.disabled = !unlocked;
    b.style.cssText = tierColorStyle(l);
    b.innerHTML =
      '<span class="tier-pill">' + l.tier + '</span>' +
      '<span class="emoji">' + (unlocked ? (done ? "✅" : l.icon) : "🔒") + '</span>' +
      '<strong>' + String(i + 1).padStart(2, "0") + '. ' + l.name + '</strong>' +
      '<small>' + l.rows + ' × ' + l.cols + ' · ' + pairCount + ' хос<br>' + fmt(l.time) + ' хугацаа</small>' +
      '<div class="progress">' + (unlocked ? (done ? "★".repeat(stars) + "☆".repeat(3 - stars) : "НЭЭЛТТЭЙ") : "ӨМНӨХ ТҮВШИНГ ДАВ") + '</div>';
    b.addEventListener("click", function () { startLevel(i); });
    return b;
  }

  function renderLevels() {
    var home = $("homeLevels"), all = $("allLevels");
    home.innerHTML = ""; all.innerHTML = "";
    [0, 1, 2, 3].forEach(function (i) { home.appendChild(makeLevelCard(i)); });
    LEVELS.forEach(function (_, i) { all.appendChild(makeLevelCard(i)); });
    updateHomeStats();
  }

  /* ---------- game flow ---------- */
  function startLevel(i) {
    stopTimers();
    level = i;
    var l = LEVELS[level];
    timeLeft = l.time; totalTime = l.time;
    score = 0; moves = 0; pairs = 0; combo = 0;
    first = null; second = null; lock = false; paused = false; hintUsed = false;
    startedAt = Date.now();

    var pairCount = (l.rows * l.cols) / 2;
    var chosen = EMOJIS.slice(0, pairCount);
    cards = [].concat(chosen, chosen).map(function (emoji, index) {
      return { emoji: emoji, id: index, matched: false, flipped: false };
    });
    for (var n = cards.length - 1; n > 0; n--) {
      var j = Math.floor(Math.random() * (n + 1));
      var tmp = cards[n]; cards[n] = cards[j]; cards[j] = tmp;
    }

    $("levelBadgeName").textContent = String(level + 1).padStart(2, "0") + ". " + l.name;
    $("levelBadgeSub").textContent = l.rows + "×" + l.cols + " самбар · " + pairCount + " хос";
    var tierTag = $("levelTierTag");
    tierTag.textContent = l.tier;
    tierTag.parentElement.style.cssText = tierColorStyle(l);
    $("goalText").textContent = pairCount + " хосыг " + fmt(l.time) + " дотор ол.";
    $("starText").textContent = "3 од: " + Math.max(1, Math.floor(pairCount * 1.35)) + " буюу түүнээс цөөн нүүдэл хийж цаг хэмнэ.";
    $("tipText").textContent = level < 4
      ? "💡 Зөвлөгөө: Эргүүлсэн хөзрийн байрлалыг сайн тогтоогоорой."
      : "🧠 Мастерын зөвлөгөө: Самбарыг хэсэг хэсгээр нь цээжилж, хосуудыг дарааллаар олоорой.";

    var board = $("board");
    board.innerHTML = "";
    board.style.gridTemplateColumns = "repeat(" + l.cols + ",minmax(0,1fr))";
    cards.forEach(function (c, index) {
      var btn = document.createElement("button");
      btn.className = "memory-card";
      btn.setAttribute("aria-label", "Нуугдсан хөзөр");
      btn.innerHTML = '<span class="card-inner"><span class="card-face card-back"><span>✦</span></span><span class="card-face card-front">' + c.emoji + '</span></span>';
      btn.addEventListener("click", function () { flipCard(index, btn); });
      c.element = btn;
      board.appendChild(btn);
    });

    $("pauseBtn").textContent = "Ⅱ  Түр зогсоох";
    updateMetrics();
    showScreen("game");
    timer = setInterval(tick, 1000);
  }

  function flipCard(i, btn) {
    if (paused || lock || !timer || cards[i].matched || cards[i].flipped) return;
    if (!startedAt) startedAt = Date.now();
    cards[i].flipped = true;
    btn.classList.add("flipped");
    btn.setAttribute("aria-label", cards[i].emoji);
    playTone(520, 0.05);

    if (first === null) { first = i; return; }
    second = i; moves++; lock = true;
    var a = cards[first], b = cards[second];

    if (a.emoji === b.emoji) {
      a.matched = b.matched = true;
      a.element.classList.add("matched"); b.element.classList.add("matched");
      a.element.disabled = b.element.disabled = true;
      pairs++; combo++;
      var gained = Scoring.pairScore(combo);
      score += gained;
      playTone(760, 0.12, "triangle");
      first = second = null; lock = false;
      updateMetrics();
      if (pairs === cards.length / 2) { finish(true); return; }
      toast(combo > 1 ? "🔥 " + combo + " дараалсан хос! +" + gained : "✨ Зөв хос! +" + gained);
    } else {
      combo = 0;
      a.element.classList.add("shake"); b.element.classList.add("shake");
      mismatchTimer = setTimeout(function () {
        a.flipped = b.flipped = false;
        a.element.classList.remove("flipped", "shake");
        b.element.classList.remove("flipped", "shake");
        a.element.setAttribute("aria-label", "Нуугдсан хөзөр");
        b.element.setAttribute("aria-label", "Нуугдсан хөзөр");
        first = second = null; lock = false;
      }, 750);
      updateMetrics();
    }
  }

  function updateMetrics() {
    $("timeMetric").textContent = fmt(timeLeft);
    $("scoreMetric").textContent = score;
    $("movesMetric").textContent = moves;
    $("pairsMetric").textContent = pairs + "/" + (cards.length / 2 || 0);
    $("timerFill").style.width = (timeLeft / totalTime * 100) + "%";
    $("timerFill").classList.toggle("low", timeLeft <= Math.max(10, totalTime * 0.22));
  }

  function tick() {
    if (paused) return;
    timeLeft--;
    updateMetrics();
    if (timeLeft <= 0) { timeLeft = 0; updateMetrics(); finish(false); }
  }

  function finish(won) {
    stopTimers(); lock = true; paused = false;
    var elapsed = totalTime - timeLeft;
    var pairCount = cards.length / 2;
    var stars = won ? Scoring.calcStars(moves, pairCount, timeLeft, totalTime) : 0;

    if (won) {
      score += Scoring.timeBonus(timeLeft);
      score += Scoring.efficiencyBonus(moves, pairCount);
      data.bestScore = Math.max(data.bestScore, score);
      data.unlocked = Math.max(data.unlocked, Math.min(LEVELS.length, level + 2));
      if (!data.completed.includes(level)) { data.completed.push(level); data.totalWins++; }
      data.stars[level] = Math.max(data.stars[level] || 0, stars);
      data.scores[level] = Math.max(data.scores[level] || 0, score);
      save();
      playTone(880, 0.22, "triangle");
    } else {
      playTone(180, 0.3, "sawtooth");
    }

    $("resultIcon").textContent = won ? (stars === 3 ? "🏆" : stars === 2 ? "🌟" : "🎉") : "⏳";
    $("resultEyebrow").textContent = won ? "ТҮВШИН ДАВАГДЛАА" : "ДАХИН ОРОЛДООД ҮЗ!";
    $("resultTitle").textContent = won ? (stars === 3 ? "Гайхалтай!" : stars === 2 ? "Маш сайн!" : "Сайн байна!") : "Хугацаа дууслаа";
    $("resultMessage").textContent = won
      ? LEVELS[level].name + " түвшнийг амжилттай давлаа! " + (level === LEVELS.length - 1 ? "Чи жинхэнэ Memory Legend боллоо!" : "Дараагийн түвшин чамайг хүлээж байна.")
      : "Бага зэрэг амраад дахин оролдоорой. Хосуудын байрлалыг тогтоох нь амжилтын түлхүүр!";
    $("resultScore").textContent = score;
    $("resultTime").textContent = fmt(elapsed);
    $("resultStars").textContent = won ? "⭐".repeat(stars) + "☆".repeat(3 - stars) : "—";
    $("nextBtn").style.display = (won && level < LEVELS.length - 1) ? "inline-block" : "none";

    if (won && stars >= 2) fireConfetti();
    renderLevels();
    showScreen("result");
  }

  function fireConfetti() {
    var layer = $("confettiLayer");
    layer.innerHTML = "";
    var colors = ["#5ee7ff", "#9c72ff", "#ffd35a", "#ff5a86", "#34d399"];
    var count = 46;
    for (var k = 0; k < count; k++) {
      var piece = document.createElement("span");
      piece.className = "confetti-piece";
      var dur = 1.6 + Math.random() * 1.2;
      piece.style.left = Math.random() * 100 + "%";
      piece.style.background = colors[k % colors.length];
      piece.style.animationDuration = dur + "s";
      piece.style.animationDelay = (Math.random() * 0.4) + "s";
      piece.style.transform = "rotate(" + Math.floor(Math.random() * 360) + "deg)";
      layer.appendChild(piece);
    }
    setTimeout(function () { layer.innerHTML = ""; }, 3200);
  }

  function restart() { startLevel(level); }
  function quit() { stopTimers(); showScreen("home"); renderLevels(); }

  function togglePause() {
    if (!timer && !paused) return;
    paused = !paused;
    $("pauseBtn").textContent = paused ? "▶  Үргэлжлүүлэх" : "Ⅱ  Түр зогсоох";
    if (paused) { clearInterval(timer); timer = null; toast("Тоглоом түр зогслоо"); }
    else { timer = setInterval(tick, 1000); toast("Үргэлжлүүллээ"); }
  }

  function hint() {
    if (paused || lock || !timer) return;
    if (hintUsed) { toast("Энэ түвшинд тусламжийг нэг удаа ашиглана."); return; }
    var unmatched = cards.map(function (c, i) { return Object.assign({}, c, { index: i }); }).filter(function (c) { return !c.matched; });
    var pair = null;
    for (var i = 0; i < unmatched.length && !pair; i++) {
      for (var j = i + 1; j < unmatched.length; j++) {
        if (unmatched[i].emoji === unmatched[j].emoji) { pair = [unmatched[i], unmatched[j]]; break; }
      }
    }
    if (!pair) return;
    hintUsed = true;
    score = Math.max(0, score - 50);
    pair.forEach(function (c) { c.element.classList.add("flipped"); });
    playTone(660, 0.1);
    setTimeout(function () {
      pair.forEach(function (c) { if (!c.matched) c.element.classList.remove("flipped"); });
    }, 850);
    updateMetrics();
    toast("✨ Тусламж ашиглалаа: -50 оноо");
  }

  /* ---------- modals ---------- */
  function openModal(id) { $(id).classList.add("open"); }
  function closeModals() { document.querySelectorAll(".modal-backdrop").forEach(function (m) { m.classList.remove("open"); }); }

  function renderAchievements() {
    var totalStars = Object.values(data.stars).reduce(function (a, b) { return a + b; }, 0);
    $("achvStars").textContent = totalStars + " / " + (LEVELS.length * 3);
    $("achvLevels").textContent = data.completed.length + " / " + LEVELS.length;
    $("achvScore").textContent = data.bestScore || 0;

    var tiers = window.MM.TIERS;
    var order = ["beginner", "simple", "medium", "hard", "master"];
    var wrap = $("tierBadges");
    wrap.innerHTML = "";
    order.forEach(function (key) {
      var idxs = LEVELS.map(function (l, i) { return l.tierKey === key ? i : -1; }).filter(function (i) { return i >= 0; });
      var earned = idxs.length > 0 && idxs.every(function (i) { return data.completed.includes(i); });
      var t = tiers[key];
      var el = document.createElement("div");
      el.className = "tier-badge" + (earned ? " earned" : "");
      el.style.cssText = "--tier-color:var(" + t.color + ")";
      el.innerHTML = '<span class="ic">' + t.icon + '</span>' + t.label;
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
        '<span class="rl-name">' + (unlocked ? l.icon : "🔒") + ' ' + (i + 1) + '. ' + l.name + '</span>' +
        '<span class="rl-stars">' + (unlocked ? ("★".repeat(stars) + "☆".repeat(3 - stars)) : "—") + '</span>' +
        '<span class="rl-score">' + best + '</span>';
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
    $("soundBtn").textContent = on ? "🔊" : "🔇";
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
  $("allLevelsBtn").addEventListener("click", function () { showScreen("levels"); });
  $("backHomeBtn").addEventListener("click", function () { showScreen("home"); });

  $("quitBtn").addEventListener("click", quit);
  $("restartBtn").addEventListener("click", restart);
  $("pauseBtn").addEventListener("click", togglePause);
  $("hintBtn").addEventListener("click", hint);

  $("nextBtn").addEventListener("click", function () { startLevel(Math.min(level + 1, LEVELS.length - 1)); });
  $("replayBtn").addEventListener("click", restart);
  $("resultHomeBtn").addEventListener("click", function () { showScreen("home"); renderLevels(); });

  $("soundBtn").addEventListener("click", function () { applySound(!data.soundOn); });
  $("soundToggle").addEventListener("click", function () { applySound(!data.soundOn); });

  $("settingsBtn").addEventListener("click", function () {
    $("savedHighScore").textContent = data.bestScore || 0;
    openModal("settingsBackdrop");
  });
  $("rateBtn").addEventListener("click", function () { renderRating(); openModal("rateBackdrop"); });
  $("achvBtn").addEventListener("click", function () { renderAchievements(); openModal("achvBackdrop"); });
  $("helpBtn").addEventListener("click", function () { openModal("helpBackdrop"); });

  document.querySelectorAll(".js-modal-close").forEach(function (btn) {
    btn.addEventListener("click", closeModals);
  });
  document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) {
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeModals(); });
  });

  $("themeDarkBtn").addEventListener("click", function () { applyTheme("dark"); });
  $("themeLightBtn").addEventListener("click", function () { applyTheme("light"); });
  $("volumeRange").addEventListener("input", function (e) { applyVolume(Number(e.target.value) / 100); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var anyOpen = Array.prototype.some.call(document.querySelectorAll(".modal-backdrop"), function (m) { return m.classList.contains("open"); });
      if (anyOpen) { closeModals(); return; }
      if ($("gameScreen").classList.contains("active")) togglePause();
    }
  });

  /* ---------- init ---------- */
  document.documentElement.setAttribute("data-theme", data.theme || "dark");
  $("themeDarkBtn").classList.toggle("active", (data.theme || "dark") === "dark");
  $("themeLightBtn").classList.toggle("active", data.theme === "light");
  $("soundBtn").textContent = data.soundOn ? "🔊" : "🔇";
  $("soundToggle").classList.toggle("on", !!data.soundOn);
  $("volumeRange").value = Math.round((typeof data.volume === "number" ? data.volume : 0.7) * 100);
  $("volumeLabel").textContent = Math.round((typeof data.volume === "number" ? data.volume : 0.7) * 100) + "%";

  renderLevels();
})();
