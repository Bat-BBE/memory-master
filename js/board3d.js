/* ===== Memory Master — WebGL 3D game board ===== */
// Renders the cards as real 3D meshes on a canvas *behind* the existing
// .memory-card buttons. The buttons stay in place (invisible) as hit targets,
// so clicks, keyboard focus and aria labels work exactly as before, and the
// game logic in game.js is untouched: each frame this module just reads the
// classes game.js already toggles (flipped / matched / shake) and animates
// toward them. Rendering is on-demand — an idle board costs no GPU time.
(function (global) {
  "use strict";

  var MM = global.MM = global.MM || {};
  var G = MM.GFX;
  if (!G) { MM.Board3D = null; return; }
  var THREE = G.THREE;

  var FOV = 40;
  var CARD_H = G.CARD_H;
  var WHITE = new THREE.Color(0xffffff), MINT = new THREE.Color("#b6ffe0"), MINT_GLOW = new THREE.Color("#8ff5cf");
  function colors(list) { return list.map(function (c) { return new THREE.Color(c); }); }
  var BURST = colors(["#5ee7ff", "#9c72ff", "#ffd35a", "#ff5a86", "#34d399"]);
  var GOLD_BURST = colors(["#ffd35a", "#ffb02e", "#fff3c4", "#ffe07a"]);
  var ICE_BURST = colors(["#ffffff", "#c8f4ff", "#7fd8ff", "#a9e6ff"]);
  var GOLD_GLOW = new THREE.Color("#ffc23d"), GOLD_TINT = new THREE.Color("#ffe8a6");

  var renderer = null, canvas, scene, camera, shared, lights, sparks, governor;
  var boardEl = null, items = [], byEl = new WeakMap();
  var raf = 0, lastT = 0, clock = 0, dirty = true;
  var W = 1, H = 1, D = 1, pad = 40;
  var hovered = -1, pointer = { x: 0, y: 0, on: false };
  var screenActive = false, failed = false, ro = null;
  var sheenPos = new THREE.Vector3(), sheenTarget = new THREE.Vector3();

  /* ---------- particles (one draw call, fixed pool) ---------- */
  function Sparks(n) {
    this.n = n; this.cursor = 0; this.alive = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.base = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.alpha = new Float32Array(n);
    var geo = new THREE.BufferGeometry();
    function attr(arr, k) { return new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage); }
    geo.setAttribute("position", attr(this.pos, 3));
    geo.setAttribute("aColor", attr(this.col, 3));
    geo.setAttribute("aSize", attr(this.size, 1));
    geo.setAttribute("aAlpha", attr(this.alpha, 1));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: G.staticTexture("dot") }, uScale: { value: 1 } },
      vertexShader:
        "uniform float uScale; attribute vec3 aColor; attribute float aSize; attribute float aAlpha;" +
        "varying vec3 vColor; varying float vAlpha;" +
        "void main(){ vColor=aColor; vAlpha=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0);" +
        "gl_PointSize=aSize*uScale/-mv.z; gl_Position=projectionMatrix*mv; }",
      fragmentShader:
        "uniform sampler2D uTex; varying vec3 vColor; varying float vAlpha;" +
        "void main(){ float a=texture2D(uTex,gl_PointCoord).a*vAlpha; if(a<0.01) discard; gl_FragColor=vec4(vColor,a); }",
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.gravity = 1200;
  }
  Sparks.prototype.burst = function (x, y, z, count, w, palette) {
    palette = palette || BURST;
    for (var k = 0; k < count; k++) {
      var i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
      var a = Math.random() * Math.PI * 2, sp = w * (1.4 + Math.random() * 2.2), j = i * 3;
      this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
      this.vel[j] = Math.cos(a) * sp; this.vel[j + 1] = Math.sin(a) * sp + w * 1.1; this.vel[j + 2] = (0.3 + Math.random() * 0.6) * sp;
      var c = palette[(Math.random() * palette.length) | 0];
      this.col[j] = c.r; this.col[j + 1] = c.g; this.col[j + 2] = c.b;
      this.base[i] = w * (0.06 + Math.random() * 0.09);
      this.life[i] = this.max[i] = 0.55 + Math.random() * 0.55;
    }
    this.gravity = w * 14;
    this.alive = 1;
  };
  Sparks.prototype.step = function (dt) {
    if (!this.alive) return false;
    var alive = 0, drag = Math.max(0, 1 - 1.6 * dt);
    for (var i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      alive++;
      var j = i * 3;
      this.vel[j] *= drag; this.vel[j + 2] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - this.gravity * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      var k = this.life[i] / this.max[i];
      this.alpha[i] = Math.min(1, k * 1.6);
      this.size[i] = this.base[i] * (0.35 + 0.65 * k);
    }
    var at = this.geo.attributes;
    at.position.needsUpdate = at.aColor.needsUpdate = at.aSize.needsUpdate = at.aAlpha.needsUpdate = true;
    this.alive = alive;
    return true;   // render this frame too, so the last particles get cleared
  };
  Sparks.prototype.clear = function () {
    this.life.fill(0); this.alpha.fill(0); this.size.fill(0); this.alive = 1;
  };

  /* ---------- setup ---------- */
  function init() {
    canvas = document.createElement("canvas");
    canvas.className = "gl-canvas";
    canvas.setAttribute("aria-hidden", "true");
    renderer = G.makeRenderer(canvas);
    governor = new G.Governor(renderer);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV, 1, 1, 4000);
    shared = G.sharedMaterials(G.makeEnv(renderer));
    shared.shadowTex = G.staticTexture("shadow");
    shared.glowTex = G.staticTexture("glow");
    shared.iceTex = G.staticTexture("ice");
    lights = G.addLights(scene);
    sparks = new Sparks(G.coarse ? 360 : 640);
    scene.add(sparks.points);

    canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); failed = true; fallbackToDom(); });
    ro = new ResizeObserver(function () { if (boardEl && items.length) layout(); });
    G.onThemeChange(refreshTextures);
    document.addEventListener("visibilitychange", syncLoop);
    document.addEventListener("mm:screen", function (e) { screenActive = e.detail === "game"; syncLoop(); });
    screenActive = !!document.querySelector("#gameScreen.active");
  }

  function bindBoard(board) {
    if (boardEl) ro.unobserve(boardEl);
    boardEl = board;
    ro.observe(board);
    board.addEventListener("pointermove", function (e) {
      var r = board.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.on = true;
      var btn = e.target && e.target.closest ? e.target.closest(".memory-card") : null;
      var it = btn ? byEl.get(btn) : null;
      hovered = it ? it.index : -1;
      dirty = true;
    });
    board.addEventListener("pointerleave", function () { pointer.on = false; hovered = -1; dirty = true; });
  }

  function fallbackToDom() {
    stopLoop();
    if (boardEl) boardEl.classList.remove("gl");
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  function clearItems() {
    items.forEach(function (it) {
      scene.remove(it.group, it.shadow, it.glow);
      it.front.dispose(); it.shadow.material.dispose(); it.glow.material.dispose(); it.ice.material.dispose();
    });
    items = [];
  }

  function makeItem(card, i) {
    var front = G.frontMaterial(card.emoji, shared.env, card.golden);
    var group = G.buildCard(shared, front);
    // Frost layer over the card back ("Хүлдсэн хөзөр"); faded in/out from the `frozen` class.
    var ice = new THREE.Mesh(G.cardGeo().face, new THREE.MeshBasicMaterial({
      map: shared.iceTex, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8
    }));
    ice.position.z = G.cardGeo().half + 0.006;
    ice.visible = false;
    group.add(ice);
    var quad = G.cardGeo().quad;
    var shadow = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
      map: shared.shadowTex, color: 0x000000, transparent: true, opacity: 0, depthWrite: false
    }));
    var glow = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
      map: shared.glowTex, color: MINT_GLOW, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    shadow.renderOrder = 1; glow.renderOrder = 2;
    scene.add(shadow, glow, group);
    var it = {
      index: i, card: card, group: group, front: front, shadow: shadow, glow: glow, ice: ice,
      flip: new G.Spring(0, 190, 17), lift: new G.Spring(0, 260, 24), pop: new G.Spring(1, 320, 13),
      tx: new G.Spring(0, 220, 24), ty: new G.Spring(0, 220, 24), spin: new G.Spring(0, 70, 12),
      deal: new G.Spring(0, 130, 15),
      dealAt: G.reducedMotion ? 0 : clock + 0.04 + i * 0.022,
      glowAmt: 0, flash: 0, shake: -1, wasMatched: false, wasShake: false, wasNudge: false, hopAt: -1,
      iceAmt: card.element.classList.contains("frozen") ? 1 : 0, wasFrozen: false, shatter: 0,
      swapT: -1, swapX: 0, swapY: 0, swapH: 0,
      x: 0, y: 0, w: 1
    };
    it.wasFrozen = it.iceAmt > 0;
    if (G.reducedMotion) it.deal.snap(1);
    byEl.set(card.element, it);
    return it;
  }

  // Re-reads the card's current emoji/golden flag (they change on a shuffle swap).
  function setFront(it) {
    var t = G.frontTexture(it.card.emoji, it.card.golden);
    it.front.map = t; it.front.emissiveMap = t;
  }

  function refreshTextures() {
    if (!renderer) return;
    G.refreshShared(shared);
    items.forEach(setFront);
    var light = G.themeKey() === "light";
    items.forEach(function (it) { it.shadow.material.color.set(light ? 0x1b2160 : 0x000000); });
    dirty = true;
  }

  function layout() {
    var bw = boardEl.clientWidth, bh = boardEl.clientHeight;
    if (!bw || !bh) return;
    var cw = items.length ? items[0].card.element.offsetWidth : 100;
    pad = Math.round(Math.min(48, Math.max(16, cw * 0.4)));
    W = bw + pad * 2; H = bh + pad * 2;
    canvas.style.left = canvas.style.top = -pad + "px";
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    D = (H / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.position.set(0, 0, D);
    camera.near = Math.max(1, D * 0.25); camera.far = D * 2;
    camera.updateProjectionMatrix();
    lights.key.position.set(-0.45 * W, 0.75 * H, D);
    items.forEach(function (it) {
      var el = it.card.element;          // offset* ignore CSS transforms — stable hit-target geometry
      it.w = el.offsetWidth;
      it.x = el.offsetLeft + it.w / 2 + pad - W / 2;
      it.y = H / 2 - (el.offsetTop + el.offsetHeight / 2 + pad);
    });
    dirty = true;
  }

  /* ---------- per-frame ---------- */
  function onMatched(it) {
    var gold = !!it.card.golden;
    it.flash = 1;
    it.pop.v += gold ? 6 : 4.5;
    it.glow.material.color.copy(gold ? GOLD_GLOW : MINT_GLOW);
    sparks.burst(it.x, it.y, it.w * 0.45, (G.coarse ? 16 : 28) * (gold ? 2 : 1), it.w, gold ? GOLD_BURST : BURST);
  }

  function onThawed(it) {
    it.shatter = 1;
    it.pop.v += 3;
    sparks.burst(it.x, it.y, it.w * 0.3, G.coarse ? 14 : 24, it.w * 0.8, ICE_BURST);
  }

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function updateItem(it, dt) {
    var cl = it.card.element.classList;
    var matched = cl.contains("matched");
    var up = matched || cl.contains("flipped");
    var shaking = cl.contains("shake"), nudging = cl.contains("nudge");
    var frozen = cl.contains("frozen");
    if (matched && !it.wasMatched) onMatched(it);
    if ((shaking && !it.wasShake) || (nudging && !it.wasNudge)) it.shake = 0;
    if (!frozen && it.wasFrozen) onThawed(it);
    it.wasMatched = matched; it.wasShake = shaking; it.wasNudge = nudging; it.wasFrozen = frozen;

    var hover = G.finePointer && pointer.on && hovered === it.index && !up;
    it.flip.t = up ? 1 : 0;
    it.lift.t = hover ? 0.09 : matched ? -0.035 : 0;
    if (hover) {
      var px = (pointer.x + pad - W / 2 - it.x) / (it.w / 2);
      var py = ((H / 2 - pointer.y - pad) - it.y) / (it.w * CARD_H / 2);
      it.tx.t = -Math.max(-1, Math.min(1, py)) * 0.22;
      it.ty.t = Math.max(-1, Math.min(1, px)) * 0.26;
    } else { it.tx.t = 0; it.ty.t = 0; }
    if (it.hopAt >= 0 && clock >= it.hopAt) {
      it.hopAt = -1; it.pop.v += 5; it.spin.t += Math.PI * 2; it.lift.v += 2.2;
      sparks.burst(it.x, it.y, it.w * 0.5, G.coarse ? 5 : 9, it.w);
    }
    if (clock >= it.dealAt) it.deal.t = 1;

    var moving = false;
    if (it.flip.step(dt)) moving = true;
    if (it.lift.step(dt)) moving = true;
    if (it.pop.step(dt)) moving = true;
    if (it.tx.step(dt)) moving = true;
    if (it.ty.step(dt)) moving = true;
    if (it.spin.step(dt)) moving = true;
    if (it.deal.step(dt)) moving = true;

    var w = it.w, f = it.flip.x, deal = it.deal.x;
    var arc = Math.sin(Math.max(0, Math.min(1, f)) * Math.PI) * 0.32;   // card lifts off the table mid-flip
    var z = (it.lift.x + arc) * w;
    var sx = 0, rz = 0;
    if (it.shake >= 0) {
      it.shake += dt;
      var k = it.shake / 0.42;
      if (k >= 1) it.shake = -1;
      else { var wave = Math.sin(k * Math.PI * 7) * (1 - k); sx = wave * 0.07 * w; rz = wave * 0.05; }
      moving = true;
    }
    // Shuffle swap: the card starts at its partner-in-swap's spot and arcs home,
    // so with the swapped textures it reads as the two cards trading places.
    var ox = 0, oy = 0;
    if (it.swapT >= 0) {
      it.swapT += dt / 0.8;
      if (it.swapT >= 1) it.swapT = -1;
      else {
        var e = easeInOut(it.swapT), arcS = Math.sin(it.swapT * Math.PI);
        ox = it.swapX * (1 - e); oy = it.swapY * (1 - e);
        z += arcS * it.swapH * w;
        rz += arcS * (it.swapH > 0.5 ? 0.25 : -0.25);
      }
      moving = true;
    }
    var drop = (1 - deal) * 0.9 * w;
    var g = it.group;
    g.visible = clock >= it.dealAt;
    g.position.set(it.x + sx + ox, it.y - drop + oy, z);
    g.rotation.set(it.tx.x + (1 - deal) * 1.1, f * Math.PI + it.ty.x + it.spin.x, rz);
    var s = w * it.pop.x * (0.35 + 0.65 * deal);
    g.scale.set(s, s, s);

    // Ice fades in/out; on thaw it also swells slightly as it "shatters".
    var iceTarget = frozen ? 1 : 0;
    if (Math.abs(iceTarget - it.iceAmt) > 0.003) {
      it.iceAmt += (iceTarget - it.iceAmt) * Math.min(1, dt * (frozen ? 6 : 9));
      moving = true;
    } else it.iceAmt = iceTarget;
    if (it.shatter > 0) { it.shatter = Math.max(0, it.shatter - dt * 3); moving = true; }
    it.ice.visible = it.iceAmt > 0.01;
    if (it.ice.visible) {
      it.ice.material.opacity = it.iceAmt * 0.95;
      it.ice.scale.setScalar(1 + (1 - it.shatter) * (1 - it.iceAmt) * 0.25);
    }

    var h = Math.max(0, z / w), ds = Math.max(0, Math.min(1, deal));
    it.shadow.visible = g.visible;
    // Shadow/glow sit well below the table plane so a sunk or tilted card never dips behind them.
    it.shadow.position.set(it.x + sx + ox + h * w * 0.2, it.y - drop + oy - h * w * 0.3, -0.6 * w);
    var ss = w * (1.45 + h * 0.6) * (0.35 + 0.65 * ds);
    it.shadow.scale.set(ss, ss * CARD_H, 1);
    it.shadow.material.opacity = Math.max(0.06, 0.42 - h * 0.5) * ds;

    var target = matched ? 1 : 0;
    if (Math.abs(target - it.glowAmt) > 0.002) {
      it.glowAmt += (target - it.glowAmt) * Math.min(1, dt * 5);
      var tint = it.card.golden ? GOLD_TINT : MINT;
      it.front.color.copy(WHITE).lerp(tint, it.glowAmt);
      it.front.emissive.copy(WHITE).lerp(tint, it.glowAmt);
      moving = true;
    }
    if (it.flash > 0) { it.flash = Math.max(0, it.flash - dt * 1.6); moving = true; }
    var gl = it.glowAmt * 0.32 + it.flash * 0.7;
    it.glow.visible = gl > 0.005;
    if (it.glow.visible) {
      it.glow.position.set(g.position.x, g.position.y, -0.5 * w);
      var gs = w * (1.9 + it.flash * 0.5);
      it.glow.scale.set(gs, gs * CARD_H, 1);
      it.glow.material.opacity = gl;
    }
    return moving;
  }

  function step(dt) {
    var busy = dirty;
    dirty = false;
    // A soft point light chases the pointer, so card edges and faces catch moving highlights.
    if (pointer.on && G.finePointer) sheenTarget.set(pointer.x + pad - W / 2, H / 2 - (pointer.y + pad), D * 0.28);
    else sheenTarget.set(-W * 0.2, H * 0.3, D * 0.35);
    if (sheenPos.distanceToSquared(sheenTarget) > 0.25) {
      sheenPos.lerp(sheenTarget, Math.min(1, dt * 8));
      lights.sheen.position.copy(sheenPos);
      busy = true;
    }
    for (var i = 0; i < items.length; i++) if (updateItem(items[i], dt)) busy = true;
    if (sparks.step(dt)) busy = true;
    return busy;
  }

  function running() { return screenActive && !document.hidden && !failed && items.length > 0; }

  function loop(now) {
    raf = 0;
    if (!running()) { lastT = 0; return; }
    var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now; clock += dt;
    // Sub-step springs on slow frames so the motion stays stable.
    var busy = false, n = dt > 1 / 50 ? 2 : 1;
    for (var s = 0; s < n; s++) if (step(dt / n)) busy = true;
    if (busy) {
      sparks.mat.uniforms.uScale.value = renderer.getPixelRatio() * D;
      renderer.render(scene, camera);
      if (governor.sample(dt)) dirty = true;
    }
    raf = requestAnimationFrame(loop);
  }
  function syncLoop() {
    if (running()) { if (!raf) { lastT = 0; dirty = true; raf = requestAnimationFrame(loop); } }
    else stopLoop();
  }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; lastT = 0; }

  /* ---------- public API ---------- */
  var api = {
    // Called after game.js swapped two cards' data (shuffle modifier).
    swap: function (i, j) {
      var a = items[i], b = items[j];
      if (!a || !b) return;
      setFront(a); setFront(b);
      a.swapX = b.x - a.x; a.swapY = b.y - a.y;
      b.swapX = -a.swapX; b.swapY = -a.swapY;
      a.swapH = 0.75; b.swapH = 0.3;          // different arc heights so they pass, not collide
      a.swapT = b.swapT = G.reducedMotion ? -1 : 0;
      dirty = true;
    },
    // Wave of hops + spins across the board when the level is cleared.
    celebrate: function () {
      if (G.reducedMotion) return;
      var cx = 0, cy = 0, maxD = 1;
      items.forEach(function (it) { maxD = Math.max(maxD, Math.hypot(it.x - cx, it.y - cy)); });
      items.forEach(function (it) { it.hopAt = clock + 0.12 + (Math.hypot(it.x - cx, it.y - cy) / maxD) * 0.45; });
      dirty = true;
    }
  };

  function mount(board, cards) {
    if (failed) return null;
    try {
      if (!renderer) init();
      if (boardEl !== board) bindBoard(board);
      clearItems();
      sparks.clear();
      hovered = -1;
      board.classList.add("gl");
      board.appendChild(canvas);
      cards.forEach(function (card, i) { items.push(makeItem(card, i)); });
      refreshTextures();
      layout();
      governor.reset();
      syncLoop();
      return api;
    } catch (err) {
      if (global.console) console.warn("[Memory Master] 3D board unavailable, using DOM cards:", err);
      failed = true;
      fallbackToDom();
      return null;
    }
  }

  MM.Board3D = { mount: mount };
})(window);
