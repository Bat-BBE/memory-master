/* ===== Memory Master — Service worker (offline play) =====
   Network-first for the app's own files so updates show up right away when
   online; the cached copy is the fallback when offline. Bump VERSION when the
   file list changes. */
var VERSION = "mm-v2";
var CORE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "icons/icon.svg",
  "icons/icon-192.png",
  "js/icons.js",
  "js/levels.js",
  "js/storage.js",
  "js/scoring.js",
  "js/rng.js",
  "js/tilt.js",
  "js/achievements.js",
  "js/vendor/three.min.js",
  "js/gfx-core.js",
  "js/board3d.js",
  "js/hero3d.js",
  "js/game.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;
  // Large unused 3D model files are never cached.
  if (/\.glb$/.test(url.pathname)) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && (res.ok || res.type === "opaque")) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === "navigate" ? caches.match("index.html") : undefined);
      });
    })
  );
});
