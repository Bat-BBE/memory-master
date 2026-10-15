/* ===== Memory Master — WebGL graphics core (Three.js) ===== */
// Shared pieces for the 3D board (js/board3d.js) and the 3D hero (js/hero3d.js):
// renderer setup, card geometry, canvas-drawn textures, lights, springs and an
// adaptive-resolution governor. If Three.js or WebGL is missing, MM.GFX stays
// null and the game keeps its original DOM/CSS cards.
(function (global) {
  "use strict";

  var MM = global.MM = global.MM || {};
  var THREE = global.THREE;

  function webglOK() {
    try {
      var c = document.createElement("canvas");
      return !!(global.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) { return false; }
  }
  if (!THREE || !webglOK() || typeof ResizeObserver === "undefined") { MM.GFX = null; return; }

  function mq(q) { try { return global.matchMedia(q).matches; } catch (e) { return false; } }
  var reducedMotion = mq("(prefers-reduced-motion: reduce)");
  var finePointer = mq("(hover: hover) and (pointer: fine)");
  var coarse = mq("(pointer: coarse)");

  var CARD_ASPECT = 0.82;              // keep in sync with .memory-card aspect-ratio in style.css
  var CARD_H = 1 / CARD_ASPECT;        // card geometry is 1 unit wide, scaled to the button width in px
  var TEX_W = 320, TEX_H = Math.round(TEX_W * CARD_H);
  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';

  /* ---------- theme ---------- */
  function themeKey() { return document.documentElement.getAttribute("data-theme") || "dark"; }
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function palette() {
    return {
      light: themeKey() === "light",
      back1: cssVar("--card-back1", "#273d94"),
      back2: cssVar("--card-back2", "#171e59"),
      line: cssVar("--card-back-line", "#5967c6"),
      front1: cssVar("--card-front1", "#eaf7ff"),
      front2: cssVar("--card-front2", "#cbd9ff")
    };
  }

  var themeListeners = [];
  new MutationObserver(function () {
    resetTextureCache();
    themeListeners.forEach(function (fn) { fn(); });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function onThemeChange(fn) { themeListeners.push(fn); }

  /* ---------- 2D canvas helpers ---------- */
  function canvas2d(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function rr(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  }
  function star4(x, R, r) {
    x.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4 - Math.PI / 2, d = i % 2 ? r : R;
      x.lineTo(Math.cos(a) * d, Math.sin(a) * d);
    }
    x.closePath();
  }

  function drawBack(pal) {
    var W = TEX_W, H = TEX_H, c = canvas2d(W, H), x = c.getContext("2d");
    var g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, pal.back1); g.addColorStop(1, pal.back2);
    x.fillStyle = g; x.fillRect(0, 0, W, H);

    // faint diamond lattice
    x.save();
    x.globalAlpha = pal.light ? 0.12 : 0.08; x.strokeStyle = "#ffffff"; x.lineWidth = 1.5;
    for (var k = -H; k < W + H; k += 24) {
      x.beginPath(); x.moveTo(k, 0); x.lineTo(k + H, H); x.moveTo(k + H, 0); x.lineTo(k, H); x.stroke();
    }
    x.restore();

    var rg = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
    rg.addColorStop(0, "rgba(150,160,255,.45)"); rg.addColorStop(1, "rgba(150,160,255,0)");
    x.fillStyle = rg; x.fillRect(0, 0, W, H);

    // double frame
    x.lineWidth = 4; x.strokeStyle = pal.line; rr(x, 16, 16, W - 32, H - 32, 26); x.stroke();
    x.lineWidth = 2; x.strokeStyle = "rgba(255,211,90,.6)"; rr(x, 28, 28, W - 56, H - 56, 18); x.stroke();

    // centre medallion
    x.save(); x.translate(W / 2, H / 2);
    x.strokeStyle = "rgba(255,255,255,.32)"; x.lineWidth = 3;
    x.beginPath(); x.arc(0, 0, W * 0.21, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = "rgba(255,211,90,.45)"; x.lineWidth = 2;
    x.beginPath(); x.arc(0, 0, W * 0.25, 0, Math.PI * 2); x.stroke();
    x.shadowColor = "#9aa8ff"; x.shadowBlur = 30; x.fillStyle = "#f1f4ff";
    star4(x, W * 0.14, W * 0.036); x.fill();
    x.restore();

    [[46, 46], [W - 46, 46], [46, H - 46], [W - 46, H - 46]].forEach(function (p) {
      x.save(); x.translate(p[0], p[1]); x.fillStyle = "rgba(255,255,255,.45)"; star4(x, 9, 2.5); x.fill(); x.restore();
    });
    return c;
  }

  function drawFront(emoji, pal) {
    var W = TEX_W, H = TEX_H, c = canvas2d(W, H), x = c.getContext("2d");
    var g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, pal.front1); g.addColorStop(1, pal.front2);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    var hl = x.createRadialGradient(W * 0.25, H * 0.15, 0, W * 0.25, H * 0.15, W * 0.9);
    hl.addColorStop(0, "rgba(255,255,255,.75)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = hl; x.fillRect(0, 0, W, H);
    x.lineWidth = 3; x.strokeStyle = "rgba(17,28,72,.12)"; rr(x, 16, 16, W - 32, H - 32, 24); x.stroke();

    x.font = Math.round(W * 0.5) + "px " + EMOJI_FONT;
    x.textAlign = "center"; x.textBaseline = "middle";
    x.shadowColor = "rgba(20,30,80,.28)"; x.shadowBlur = 18; x.shadowOffsetY = 9;
    x.fillStyle = "#111c48";
    x.fillText(emoji, W / 2, H / 2 + W * 0.03);
    return c;
  }

  function drawRadial(size, stops) {
    var c = canvas2d(size, size), x = c.getContext("2d");
    var g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    return c;
  }

  // Soft rounded-rect contact shadow. Drawn via the offset-shadow trick so it
  // works on every canvas implementation (no ctx.filter needed).
  function drawShadow() {
    var w = 128, h = Math.round(w * CARD_H), c = canvas2d(w, h), x = c.getContext("2d");
    x.shadowColor = "rgba(0,0,0,1)"; x.shadowBlur = 16; x.shadowOffsetX = 2000;
    x.fillStyle = "#000";
    rr(x, w * 0.17 - 2000, h * 0.17, w * 0.66, h * 0.66, 12); x.fill();
    return c;
  }

  function drawEmojiSprite(emoji) {
    var s = 256, c = canvas2d(s, s), x = c.getContext("2d");
    x.font = Math.round(s * 0.74) + "px " + EMOJI_FONT;
    x.textAlign = "center"; x.textBaseline = "middle";
    x.shadowColor = "rgba(126,233,255,.85)"; x.shadowBlur = 26;
    x.fillText(emoji, s / 2, s / 2 + s * 0.04);
    return c;
  }

  /* ---------- texture cache (shared by both renderers) ---------- */
  var cache = null;
  function resetTextureCache() {
    if (!cache) return;
    if (cache.back) cache.back.dispose();
    Object.keys(cache.fronts).forEach(function (k) { cache.fronts[k].dispose(); });
    cache = null;
  }
  function ensureCache() {
    if (!cache || cache.theme !== themeKey()) {
      resetTextureCache();
      cache = { theme: themeKey(), pal: palette(), back: null, fronts: {} };
    }
    return cache;
  }
  function toTexture(c, srgb) {
    var t = new THREE.CanvasTexture(c);
    if (srgb !== false) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  function backTexture() { var k = ensureCache(); return k.back || (k.back = toTexture(drawBack(k.pal))); }
  function frontTexture(emoji) {
    var k = ensureCache();
    return k.fronts[emoji] || (k.fronts[emoji] = toTexture(drawFront(emoji, k.pal)));
  }
  var statics = {};
  function staticTexture(name) {
    if (statics[name]) return statics[name];
    var c;
    if (name === "glow") c = drawRadial(128, [[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,.45)"], [1, "rgba(255,255,255,0)"]]);
    else if (name === "dot") c = drawRadial(64, [[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,.85)"], [1, "rgba(255,255,255,0)"]]);
    else if (name === "shadow") c = drawShadow();
    else c = drawEmojiSprite(name);
    return (statics[name] = toTexture(c));
  }

  /* ---------- geometry ---------- */
  function roundedShape(w, h, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function planarUV(geo, w, h) {
    var p = geo.attributes.position, uv = geo.attributes.uv;
    for (var i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
    uv.needsUpdate = true;
  }

  var geo = null;
  function cardGeo() {
    if (geo) return geo;
    var b = 0.018, depth = 0.028, r = 0.13;
    var body = new THREE.ExtrudeGeometry(roundedShape(1 - b * 2, CARD_H - b * 2, r - b), {
      depth: depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8
    });
    body.center();
    var fw = 1 - 0.05, fh = CARD_H - 0.05;
    var face = new THREE.ShapeGeometry(roundedShape(fw, fh, r - 0.03), 8);
    planarUV(face, fw, fh);
    geo = { body: body, face: face, half: depth / 2 + b, quad: new THREE.PlaneGeometry(1, 1) };
    return geo;
  }

  /* ---------- renderer / scene helpers ---------- */
  function makeRenderer(canvas) {
    var dpr = Math.min(global.devicePixelRatio || 1, coarse ? 1.75 : 2);
    var r = new THREE.WebGLRenderer({
      canvas: canvas, alpha: true, antialias: dpr < 2, powerPreference: "high-performance"
    });
    r.setPixelRatio(dpr);
    r.outputEncoding = THREE.sRGBEncoding;
    r.setClearColor(0x000000, 0);
    return r;
  }

  // Tiny procedural studio environment for metallic reflections — no HDR download.
  function makeEnv(renderer) {
    var pm = new THREE.PMREMGenerator(renderer);
    var s = new THREE.Scene();
    var sphere = new THREE.SphereGeometry(10, 32, 16);
    var pos = sphere.attributes.position, cols = [];
    var top = new THREE.Color("#a58cff"), bottom = new THREE.Color("#0a1230"), tmp = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      tmp.copy(bottom).lerp(top, (pos.getY(i) / 10) * 0.5 + 0.5);
      cols.push(tmp.r, tmp.g, tmp.b);
    }
    sphere.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    s.add(new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
    function panel(color, x, y, z, w, h) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
    }
    panel(new THREE.Color(4, 4, 4), -4, 6, 5, 6, 3);
    panel(new THREE.Color(0.6, 2.4, 3), 7, 1, 3, 2, 6);
    panel(new THREE.Color(2.4, 0.9, 3), -7, -1, -2, 2, 5);
    var rt = pm.fromScene(s, 0.04);
    pm.dispose();
    return rt.texture;
  }

  function sharedMaterials(env) {
    var back = backTexture();
    return {
      env: env,
      edge: new THREE.MeshStandardMaterial({ color: 0xe9c46a, metalness: 0.9, roughness: 0.28, envMap: env, envMapIntensity: 1.1 }),
      back: new THREE.MeshStandardMaterial({
        map: back, emissive: 0xffffff, emissiveMap: back, emissiveIntensity: 0.38,
        roughness: 0.42, metalness: 0.15, envMap: env, envMapIntensity: 0.45,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4
      })
    };
  }
  function refreshShared(shared) {
    var back = backTexture();
    shared.back.map = back; shared.back.emissiveMap = back;
  }

  function frontMaterial(emoji, env) {
    var t = frontTexture(emoji);
    return new THREE.MeshStandardMaterial({
      map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.24,
      roughness: 0.5, metalness: 0, envMap: env, envMapIntensity: 0.35,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4
    });
  }

  function buildCard(shared, frontMat) {
    var g = cardGeo(), group = new THREE.Group();
    var body = new THREE.Mesh(g.body, shared.edge);
    var back = new THREE.Mesh(g.face, shared.back);
    back.position.z = g.half + 0.002;
    var front = new THREE.Mesh(g.face, frontMat);
    front.rotation.y = Math.PI;
    front.position.z = -(g.half + 0.002);
    group.add(body, back, front);
    return group;
  }

  function addLights(scene) {
    scene.add(new THREE.HemisphereLight(0xd6deff, 0x231a4d, 0.85));
    var key = new THREE.DirectionalLight(0xffffff, 0.75);
    scene.add(key);
    var sheen = new THREE.PointLight(0x9feaff, 0.55, 0, 2);
    scene.add(sheen);
    return { key: key, sheen: sheen };
  }

  /* ---------- motion ---------- */
  // Critically-ish damped spring: gives cards a physical, slightly springy feel.
  function Spring(x, k, c) { this.x = x; this.t = x; this.v = 0; this.k = k; this.c = c; }
  Spring.prototype.step = function (dt) {
    if (this.v === 0 && this.x === this.t) return false;
    var a = (this.t - this.x) * this.k - this.v * this.c;
    this.v += a * dt; this.x += this.v * dt;
    if (Math.abs(this.t - this.x) < 1e-4 && Math.abs(this.v) < 1e-3) { this.x = this.t; this.v = 0; }
    return true;
  };
  Spring.prototype.snap = function (x) { this.x = this.t = x; this.v = 0; };

  // Lowers the render resolution if the device can't hold ~45 fps.
  function Governor(renderer) { this.r = renderer; this.reset(); }
  Governor.prototype.reset = function () { this.acc = 0; this.n = 0; this.skip = 20; };
  Governor.prototype.sample = function (dt) {
    if (this.skip > 0) { this.skip--; return false; }   // ignore first frames (texture uploads)
    this.acc += dt; this.n++;
    if (this.n < 90) return false;
    var avg = this.acc / this.n, pr = this.r.getPixelRatio();
    this.acc = 0; this.n = 0;
    if (avg > 1 / 45 && pr > 1) { this.r.setPixelRatio(Math.max(1, pr - 0.25)); return true; }
    return false;
  };

  MM.GFX = {
    THREE: THREE,
    reducedMotion: reducedMotion,
    finePointer: finePointer,
    coarse: coarse,
    CARD_H: CARD_H,
    themeKey: themeKey,
    onThemeChange: onThemeChange,
    cardGeo: cardGeo,
    makeRenderer: makeRenderer,
    makeEnv: makeEnv,
    sharedMaterials: sharedMaterials,
    refreshShared: refreshShared,
    frontMaterial: frontMaterial,
    frontTexture: frontTexture,
    staticTexture: staticTexture,
    buildCard: buildCard,
    addLights: addLights,
    Spring: Spring,
    Governor: Governor
  };
})(window);
