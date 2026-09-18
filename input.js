'use strict';
// Keyboard + mouse input. A/D move, W jetpack, S fall, arrows aim, Space/J shoot, K grenade, R reload.
const Input = (function () {
  const keys = new Set(), just = new Set();
  let mouseX = VIEW_W / 2, mouseY = VIEW_H / 2, mouseDown = false, lastMove = -1e9;

  function init(canvas) {
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
      mouseX = (e.clientX - r.left) * (VIEW_W / r.width);
      mouseY = (e.clientY - r.top) * (VIEW_H / r.height);
      lastMove = performance.now();
    });
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) { mouseDown = true; AudioSys.ensure(); }
    });
    window.addEventListener('mouseup', () => mouseDown = false);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  return {
    init,
    down: c => keys.has(c),
    pressed: c => just.has(c),
    endFrame: () => just.clear(),
    mouse: {
      get x() { return mouseX; },
      get y() { return mouseY; },
      get down() { return mouseDown; },
      get lastMove() { return lastMove; }
    }
  };
})();
