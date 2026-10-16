/* ===== Memory Master — Pointer-follow 3D tilt ===== */
(function (global) {
  "use strict";

  var enabled = (function () {
    try {
      return window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { return false; }
  })();

  // Attaches a pointer-follow 3D tilt to `el` using CSS custom properties
  // (--rx/--ry), which the stylesheet turns into a perspective transform.
  // `isDisabled()` lets the caller suspend tilting per-element at runtime
  // (e.g. a memory card that has already been flipped/matched).
  // `el` listens for pointer movement; the tilt is written onto `opts.target`
  // (defaults to `el` itself) — lets a whole panel's pointer motion drive a
  // smaller decorative element inside it (e.g. hero panel -> orb).
  function attachTilt(el, opts) {
    if (!enabled) return function () {};
    opts = opts || {};
    var maxDeg = opts.maxDeg || 10;
    var isDisabled = opts.isDisabled || function () { return false; };
    var target = opts.target || el;

    function reset() {
      target.style.setProperty("--rx", "0deg");
      target.style.setProperty("--ry", "0deg");
    }
    function onMove(e) {
      if (isDisabled()) { reset(); return; }
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var px = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      var py = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      px = Math.max(-1, Math.min(1, px));
      py = Math.max(-1, Math.min(1, py));
      target.style.setProperty("--ry", (px * maxDeg).toFixed(2) + "deg");
      target.style.setProperty("--rx", (-py * maxDeg).toFixed(2) + "deg");
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    return reset;
  }

  global.MM = global.MM || {};
  global.MM.attachTilt = attachTilt;
  global.MM.tiltEnabled = enabled;
})(window);
