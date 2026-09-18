'use strict';
// Keyboard + mouse + virtual (touch) input.
// Keyboard: A/D move, W jetpack, S fall, arrows aim, Space/J shoot, K grenade, R reload.
const Input = (function () {
  const keys = new Set(), just = new Set();
  const touch = { mx: 0, my: 0, ax: 0, ay: 0, aiming: false }; // stick axes, -1..1
  let mouseX = VIEW_W / 2, mouseY = VIEW_H / 2, mouseDown = false, lastMove = -1e9;
  let cv = null;

  function init(canvas) {
    cv = canvas;
    window.addEventListener('keydown', e => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!keys.has(e.code)) just.add(e.code);
      keys.add(e.code);
      AudioSys.ensure();
    });
    window.addEventListener('keyup', e => keys.delete(e.code));
    window.addEventListener('blur', () => { keys.clear(); mouseDown = false; });

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      const vw = (window.VIEW && window.VIEW.w) || canvas.width;
      const vh = (window.VIEW && window.VIEW.h) || canvas.height;
      mouseX = (e.clientX - r.left) * (vw / r.width);
      mouseY = (e.clientY - r.top) * (vh / r.height);
      lastMove = performance.now();
    });
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) { mouseDown = true; AudioSys.ensure(); }
    });
    window.addEventListener('mouseup', () => mouseDown = false);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  // virtual key press from touch UI (same edge semantics as real keys)
  function setVirtual(code, down) {
    if (down) {
      if (!keys.has(code)) just.add(code);
      keys.add(code);
    } else {
      keys.delete(code);
    }
  }

  return {
    init,
    down: c => keys.has(c),
    pressed: c => just.has(c),
    endFrame: () => just.clear(),
    setVirtual,
    touch,
    mouse: {
      get x() { return mouseX; },
      get y() { return mouseY; },
      get down() { return mouseDown; },
      get lastMove() { return lastMove; }
    }
  };
})();
