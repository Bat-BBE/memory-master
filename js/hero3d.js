/* ===== Memory Master — WebGL 3D home hero ===== */
// A glowing orb with the 🧠 mascot, orbiting 3D cards, light rings and a
// starfield — replaces the CSS orb/float-cards when WebGL is available.
// Only renders while the home screen is shown and the hero is on screen.
(function (global) {
  "use strict";

  var MM = global.MM = global.MM || {};
  var G = MM.GFX;
  if (!G) { MM.Hero3D = null; return; }
  var THREE = G.THREE;

  var ORBIT_EMOJIS = ["🐴", "🦅", "🐺", "🐫", "🏹", "⛺"];
  var FOV = 35;

  var host, canvas, renderer, scene, camera, root, shared, governor, lights;
  var orb, orbMat, brain, halo, rings = [], beads = [], cards = [], stars;
  var W = 1, H = 1, D = 1, R = 60, orbitX = 120, orbitZ = 70, cardW = 40;
  var raf = 0, lastT = 0, clock = 0, homeActive = true, onScreen = true, failed = false;
  var tiltX, tiltY, pointer = { x: 0, y: 0, on: false };

  var THEMES = {
    dark:  { top: "#394fa8", bottom: "#0b102b", rimA: "#5ee7ff", rimB: "#b98bff", halo: "#7d63ff", ring1: "#8a92ff", ring2: "#4de6ff", star: 0.9 },
    light: { top: "#d6e0ff", bottom: "#5a6fe0", rimA: "#ffffff", rimB: "#b48cff", halo: "#8ea3ff", ring1: "#6d7fe8", ring2: "#0ea5c4", star: 0.45 }
  };

  function orbMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
        uRimA: { value: new THREE.Color() }, uRimB: { value: new THREE.Color() }, uTime: { value: 0 }
      },
      vertexShader:
        "varying vec3 vN; varying vec3 vV; varying float vY;" +
        "void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal);" +
        "vV=normalize(-mv.xyz); vY=normal.y; gl_Position=projectionMatrix*mv; }",
      fragmentShader:
        "uniform vec3 uTop,uBottom,uRimA,uRimB; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;" +
        "void main(){ float f=pow(1.0-clamp(dot(vN,vV),0.0,1.0),2.4);" +
        "vec3 base=mix(uBottom,uTop,smoothstep(-0.9,0.9,vY+vN.x*0.25));" +
        "float spec=pow(max(dot(vN,normalize(vec3(-0.45,0.6,0.7))),0.0),28.0);" +
        "vec3 rim=mix(uRimA,uRimB,0.5+0.5*sin(uTime*0.8+vY*2.5));" +
        "gl_FragColor=vec4(base*(1.0-f*0.5)+rim*f*1.5+spec*0.4,1.0); }"
    });
  }

  function additive(color, opacity, map) {
    return new THREE.MeshBasicMaterial({
      color: color, opacity: opacity, map: map || null, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
  }

  function build() {
    canvas = document.createElement("canvas");
    canvas.className = "gl-canvas";
    canvas.setAttribute("aria-hidden", "true");
    renderer = G.makeRenderer(canvas);
    governor = new G.Governor(renderer);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV, 1, 1, 6000);
    lights = G.addLights(scene);
    shared = G.sharedMaterials(G.makeEnv(renderer));
    root = new THREE.Group();
    scene.add(root);

    orbMat = orbMaterial();
    orb = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), orbMat);
    root.add(orb);

    var glowTex = G.staticTexture("glow");
    halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    root.add(halo);

    brain = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.staticTexture("🧠"), transparent: true }));
    brain.renderOrder = 3;
    root.add(brain);

    [{ r: 1.32, tx: 1.13, ty: 0.0 }, { r: 1.6, tx: 1.22, ty: 0.28 }].forEach(function (cfg, i) {
      var pivot = new THREE.Group();
      pivot.rotation.set(cfg.tx, cfg.ty, 0);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(cfg.r, 0.012, 6, 160), additive(0xffffff, i ? 0.4 : 0.55));
      pivot.add(ring);
      for (var b = 0; b < 2; b++) {
        var bead = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        bead.userData = { r: cfg.r, phase: b * Math.PI + i, speed: i ? -0.55 : 0.75 };
        pivot.add(bead);
        beads.push(bead);
      }
      root.add(pivot);
      rings.push({ pivot: pivot, mesh: ring, r: cfg.r });
    });

    ORBIT_EMOJIS.forEach(function (emoji, i) {
      var card = G.buildCard(shared, G.frontMaterial(emoji, shared.env));
      card.userData = { emoji: emoji, phase: (i / ORBIT_EMOJIS.length) * Math.PI * 2, bob: Math.random() * 6 };
      root.add(card);
      cards.push(card);
    });

    var N = G.coarse ? 110 : 200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    var palette = ["#ffffff", "#5ee7ff", "#c17bff", "#ffd35a"].map(function (c) { return new THREE.Color(c); });
    for (var s = 0; s < N; s++) {
      pos[s * 3] = Math.random() - 0.5; pos[s * 3 + 1] = Math.random() - 0.5; pos[s * 3 + 2] = -0.2 - Math.random() * 0.8;
      var c = palette[(Math.random() * palette.length) | 0];
      col[s * 3] = c.r; col[s * 3 + 1] = c.g; col[s * 3 + 2] = c.b;
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({
      size: 2.4, sizeAttenuation: false, map: G.staticTexture("dot"), vertexColors: true,
      transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    scene.add(stars);

    tiltX = new G.Spring(0, 30, 10);
    tiltY = new G.Spring(0, 30, 10);
    applyTheme();
  }

  function applyTheme() {
    var t = THEMES[G.themeKey()] || THEMES.dark;
    var u = orbMat.uniforms;
    u.uTop.value.set(t.top); u.uBottom.value.set(t.bottom); u.uRimA.value.set(t.rimA); u.uRimB.value.set(t.rimB);
    halo.material.color.set(t.halo);
    rings[0].mesh.material.color.set(t.ring1);
    rings[1].mesh.material.color.set(t.ring2);
    beads.forEach(function (b, i) { b.material.color.set(i < 2 ? t.ring1 : t.ring2); });
    stars.material.opacity = t.star;
    G.refreshShared(shared);
    cards.forEach(function (c) {
      var tex = G.frontTexture(c.userData.emoji), m = c.children[2].material;
      m.map = tex; m.emissiveMap = tex;
    });
  }

  function layout() {
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    D = (H / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.position.set(0, 0, D);
    camera.near = D * 0.2; camera.far = D * 3;
    camera.updateProjectionMatrix();
    lights.key.position.set(-0.5 * W, 0.8 * H, D);
    lights.sheen.position.set(W * 0.25, H * 0.3, D * 0.4);

    R = Math.min(W * 0.17, H * 0.27);
    cardW = Math.max(30, Math.min(84, R * 0.62));
    orbitX = Math.min(R * 2.15, W / 2 - cardW * 0.75);
    orbitZ = R * 1.15;
    orb.scale.setScalar(R);
    halo.scale.setScalar(R * 3.6);
    halo.position.z = -R * 0.6;
    brain.scale.setScalar(R * 1.25);
    brain.position.z = R + 2;
    rings.forEach(function (r) { r.pivot.scale.setScalar(R); });
    beads.forEach(function (b) { b.scale.setScalar(0.22); });
    stars.scale.set(W * 1.1, H * 1.1, R * 4);
    cards.forEach(function (c) { c.scale.setScalar(cardW); });
    render(0);
  }

  function render(dt) {
    var t = clock;
    orbMat.uniforms.uTime.value = t;
    var pulse = 1 + Math.sin(t * 1.5) * 0.03;
    orb.scale.setScalar(R * pulse);
    halo.material.opacity = 0.55 + Math.sin(t * 1.5) * 0.2;
    brain.scale.setScalar(R * 1.25 * (1 + Math.sin(t * 1.85) * 0.04));

    beads.forEach(function (b) {
      var u = b.userData, a = u.phase + t * u.speed;
      b.position.set(Math.cos(a) * u.r, Math.sin(a) * u.r, 0);
    });

    cards.forEach(function (c, i) {
      var u = c.userData, a = u.phase + t * 0.28;
      c.position.set(Math.cos(a) * orbitX, Math.sin(a * 2 + u.bob) * R * 0.22 + Math.sin(a) * R * 0.25, Math.sin(a) * orbitZ);
      c.rotation.set(Math.sin(t * 0.6 + i) * 0.18, -a + Math.PI / 2 + t * 0.5, Math.sin(t * 0.8 + u.bob) * 0.16);
    });

    if (!G.finePointer || !pointer.on) {
      tiltX.t = Math.sin(t * 0.35) * 0.06;
      tiltY.t = Math.sin(t * 0.27) * 0.1;
    }
    tiltX.step(dt); tiltY.step(dt);
    root.rotation.set(tiltX.x, tiltY.x, 0);
    stars.material.size = 2.2 + Math.sin(t * 2.2) * 0.4;

    renderer.render(scene, camera);
  }

  function running() { return homeActive && onScreen && !document.hidden && !failed && !G.reducedMotion; }
  function loop(now) {
    raf = 0;
    if (!running()) { lastT = 0; return; }
    var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now; clock += dt;
    render(dt);
    if (governor.sample(dt)) layout();
    raf = requestAnimationFrame(loop);
  }
  function syncLoop() {
    if (running()) { if (!raf) { lastT = 0; raf = requestAnimationFrame(loop); } }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; lastT = 0; }
  }

  function fallback() {
    failed = true;
    syncLoop();
    host.classList.remove("gl");
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  function mount(el) {
    if (!el || host) return !!host;
    host = el;
    try {
      build();
      host.insertBefore(canvas, host.firstChild);
      host.classList.add("gl");
      canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); fallback(); });

      host.addEventListener("pointermove", function (e) {
        if (!G.finePointer) return;
        var r = host.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width * 2 - 1, py = (e.clientY - r.top) / r.height * 2 - 1;
        pointer.on = true;
        tiltY.t = px * 0.35; tiltX.t = py * 0.25;
      });
      host.addEventListener("pointerleave", function () { pointer.on = false; });

      new ResizeObserver(function () { layout(); }).observe(host);
      new IntersectionObserver(function (entries) {
        onScreen = entries[entries.length - 1].isIntersecting;
        syncLoop();
      }).observe(host);
      document.addEventListener("visibilitychange", syncLoop);
      document.addEventListener("mm:screen", function (e) {
        homeActive = e.detail === "home";
        if (homeActive) layout();
        syncLoop();
      });
      G.onThemeChange(function () { applyTheme(); render(0); });

      homeActive = !!document.querySelector("#homeScreen.active");
      layout();
      syncLoop();
      return true;
    } catch (err) {
      if (global.console) console.warn("[Memory Master] 3D hero unavailable, using CSS art:", err);
      fallback();
      return false;
    }
  }

  MM.Hero3D = { mount: mount };
})(window);
