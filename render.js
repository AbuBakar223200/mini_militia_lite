'use strict';
// Scenery: pre-rendered world + parallax layers and lighting helpers for the 2.5D look.
const Scenery = (function () {
  const PI2 = Math.PI * 2;

  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // local rounded-rect path (render.js loads before entities.js, which owns roundRect)
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // lighten (amt > 0) or darken (amt < 0) a '#rrggbb' color
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  // additive radial glow
  function glow(ctx, x, y, r, color, alpha) {
    if (r <= 0 || alpha <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, PI2); ctx.fill();
    ctx.restore();
  }

  function flame(ctx, x, y, facing) {
    const fl = 12 + Math.random() * 8;
    glow(ctx, x, y + 4 + fl / 2, 18, '#ff9800', 0.4);
    ctx.fillStyle = '#ff8f00';
    ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + fl); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffcc80';
    ctx.beginPath(); ctx.moveTo(x - 2.2, y); ctx.lineTo(x + 2.2, y); ctx.lineTo(x, y + fl * 0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff3e0';
    ctx.beginPath(); ctx.moveTo(x - 1, y); ctx.lineTo(x + 1, y); ctx.lineTo(x, y + fl * 0.3); ctx.closePath(); ctx.fill();
  }

  // nearest platform/ground surface below a point (for dynamic shadows)
  function surfaceYBelow(x, fromY) {
    let best = Infinity;
    const test = r => { if (x >= r.x && x <= r.x + r.w && r.y >= fromY - 2 && r.y < best) best = r.y; };
    for (const r of SOLIDS) test(r);
    for (const r of ONEWAYS) test(r);
    return best === Infinity ? null : best;
  }

  function bodyShadow(ctx, b) {
    const sy = surfaceYBelow(b.cx, b.y + b.h - 6);
    if (sy === null) return;
    const d = clamp((sy - (b.y + b.h)) / 420, 0, 1);
    const rx = 17 * (1 - d * 0.45);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.28 * (1 - d)).toFixed(3) + ')';
    ctx.beginPath(); ctx.ellipse(b.cx, sy + 3, rx, 4.5 * (1 - d * 0.4), 0, 0, PI2); ctx.fill();
  }

  // ---------- pre-rendered layers ----------
  const layers = {
    world: makeCanvas(WORLD.w, WORLD.h),
    hillsFar: makeCanvas(2560, 1000),
    hillsNear: makeCanvas(3040, 1100),
  };

  function grassStrip(c, x, y, w, rnd) {
    let g = c.createLinearGradient(0, y - 3, 0, y + 12);
    g.addColorStop(0, '#8fdd6f'); g.addColorStop(0.5, '#5cb84e'); g.addColorStop(1, '#3f8f3a');
    c.fillStyle = g;
    c.fillRect(x, y - 3, w, 14);
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.fillRect(x + 2, y - 2, w - 4, 2.5);
    // blades + flowers
    for (let bx = x + 4; bx < x + w - 4; bx += 6 + rnd() * 12) {
      const bh = 3 + rnd() * 6;
      c.fillStyle = rnd() < 0.5 ? '#5cb84e' : '#79cf60';
      c.beginPath(); c.moveTo(bx, y - 2); c.lineTo(bx + 2.2, y - 2 - bh); c.lineTo(bx + 4.4, y - 2); c.closePath(); c.fill();
      if (rnd() < 0.08) {
        c.fillStyle = rnd() < 0.5 ? '#fff59d' : '#f8bbd0';
        c.beginPath(); c.arc(bx + 2, y - 3 - bh, 1.6, 0, PI2); c.fill();
      }
    }
  }

  function buildPlatform(c, p, rnd) {
    const { x, y, w, h } = p;
    let g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#7a5c40'); g.addColorStop(1, '#463322');
    c.fillStyle = g;
    rr(c, x + 2, y + 7, w - 4, h - 5, 5); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.3)';
    rr(c, x + 4, y + h - 7, w - 8, 4, 2); c.fill();
    // roots
    c.strokeStyle = 'rgba(40,28,16,0.5)'; c.lineWidth = 1.5;
    for (let bx = x + 10; bx < x + w - 10; bx += 26 + rnd() * 40) {
      c.beginPath(); c.moveTo(bx, y + h - 2); c.quadraticCurveTo(bx + 2, y + h + 3, bx + 5, y + h + 5); c.stroke();
    }
    // grass cap with overhang
    g = c.createLinearGradient(0, y - 4, 0, y + 10);
    g.addColorStop(0, '#8fdd6f'); g.addColorStop(0.5, '#5cb84e'); g.addColorStop(1, '#3f8f3a');
    c.fillStyle = g;
    rr(c, x - 3, y - 4, w + 6, 14, 7); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.28)';
    rr(c, x + 2, y - 3, w - 4, 3, 2); c.fill();
    for (let bx = x + 3; bx < x + w - 3; bx += 7 + rnd() * 13) {
      const bh = 3 + rnd() * 5;
      c.fillStyle = rnd() < 0.5 ? '#5cb84e' : '#79cf60';
      c.beginPath(); c.moveTo(bx, y - 3); c.lineTo(bx + 2.4, y - 3 - bh); c.lineTo(bx + 4.8, y - 3); c.closePath(); c.fill();
    }
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 1.5;
    rr(c, x - 3, y - 4, w + 6, 14, 7); c.stroke();
  }

  function buildSolid(c, p, rnd) {
    const { x, y, w, h } = p;
    if (h <= 44) { // low ledge: dirt block with grass top
      let g = c.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#8a6a4b'); g.addColorStop(1, '#4a3626');
      c.fillStyle = g; c.fillRect(x, y, w, h);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x, y + h - 8, w, 8);
      grassStrip(c, x, y, w, rnd);
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1.5; c.strokeRect(x + 1, y + 10, w - 2, h - 12);
      return;
    }
    // tall stone pillar
    let g = c.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#a49a8e'); g.addColorStop(0.5, '#7c7268'); g.addColorStop(1, '#544d46');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    // block joints
    c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = 1.5;
    let row = 0;
    for (let by = y + 24; by < y + h; by += 24) {
      c.beginPath(); c.moveTo(x, by); c.lineTo(x + w, by); c.stroke();
      for (let jx = x + (row % 2 ? 18 : 38); jx < x + w; jx += 56) {
        c.beginPath(); c.moveTo(jx, by - 24); c.lineTo(jx, Math.min(by, y + h)); c.stroke();
      }
      row++;
    }
    // cracks
    c.strokeStyle = 'rgba(0,0,0,0.16)';
    for (let i = 0; i < 4; i++) {
      const cx0 = x + rnd() * w, cy0 = y + rnd() * h;
      c.beginPath(); c.moveTo(cx0, cy0);
      c.lineTo(cx0 + (rnd() - 0.5) * 18, cy0 + 8 + rnd() * 12);
      c.lineTo(cx0 + (rnd() - 0.5) * 24, cy0 + 18 + rnd() * 14);
      c.stroke();
    }
    // top cap + moss
    let g2 = c.createLinearGradient(0, y, 0, y + 10);
    g2.addColorStop(0, '#b5ab9e'); g2.addColorStop(1, '#8b8177');
    c.fillStyle = g2; c.fillRect(x, y, w, 10);
    c.fillStyle = 'rgba(92,184,78,0.55)';
    for (let mx = x + 4; mx < x + w - 6; mx += 10 + rnd() * 22) c.fillRect(mx, y + 8, 5 + rnd() * 6, 2.5 + rnd() * 2);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x, y + h - 8, w, 8);
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function buildWorldLayer() {
    const c = layers.world.getContext('2d');
    const rnd = mulberry(1337);
    // ground first
    const gr = SOLIDS[0];
    let g = c.createLinearGradient(0, gr.y, 0, gr.y + gr.h);
    g.addColorStop(0, '#8a6a4b'); g.addColorStop(0.45, '#63452e'); g.addColorStop(1, '#352417');
    c.fillStyle = g; c.fillRect(gr.x, gr.y, gr.w, gr.h);
    for (let i = 0; i < 600; i++) {
      c.fillStyle = 'rgba(0,0,0,' + (0.04 + rnd() * 0.08).toFixed(3) + ')';
      c.fillRect(gr.x + rnd() * gr.w, gr.y + 18 + rnd() * (gr.h - 18), 2 + rnd() * 3, 2 + rnd() * 3);
      if (i % 7 === 0) {
        c.fillStyle = 'rgba(255,235,200,' + (0.03 + rnd() * 0.05).toFixed(3) + ')';
        c.fillRect(gr.x + rnd() * gr.w, gr.y + 18 + rnd() * (gr.h - 18), 2, 2);
      }
    }
    grassStrip(c, gr.x, gr.y, gr.w, rnd);
    // soft shadows that actually land on the ground
    for (const p of ONEWAYS) {
      const cxm = p.x + p.w / 2;
      const sy = surfaceYBelow(cxm, p.y + p.h);
      if (sy === null || sy - (p.y + p.h) > 300) continue;
      const a = 0.26 * (1 - (sy - (p.y + p.h)) / 320);
      const gg = c.createRadialGradient(cxm, sy + 6, 4, cxm, sy + 6, p.w * 0.4);
      gg.addColorStop(0, 'rgba(0,0,0,' + a.toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gg;
      c.beginPath(); c.ellipse(cxm, sy + 6, p.w * 0.4, 13, 0, 0, PI2); c.fill();
    }
    // other solids
    for (const p of SOLIDS.slice(1)) buildSolid(c, p, rnd);
    // floating platforms
    for (const p of ONEWAYS) buildPlatform(c, p, rnd);
    // bushes + rocks on the ground
    for (let i = 0; i < 26; i++) {
      const bx = 40 + rnd() * (WORLD.w - 80);
      const by = gr.y + 14 + rnd() * 6;
      if (rnd() < 0.6) {
        const s = 10 + rnd() * 16;
        c.fillStyle = rnd() < 0.5 ? '#3f8f3a' : '#356f31';
        c.beginPath(); c.arc(bx, by, s * 0.5, Math.PI, 0); c.fill();
        c.beginPath(); c.arc(bx + s * 0.4, by, s * 0.36, Math.PI, 0); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.beginPath(); c.arc(bx - s * 0.15, by - s * 0.28, s * 0.18, 0, PI2); c.fill();
      } else {
        c.fillStyle = '#6e655c';
        c.beginPath(); c.ellipse(bx, by + 2, 5 + rnd() * 5, 3.5 + rnd() * 2.5, 0, Math.PI, 0); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.15)';
        c.beginPath(); c.ellipse(bx - 1, by + 0.5, 2.5, 1.4, 0, Math.PI, 0); c.fill();
      }
    }
    // world-edge darkening for depth
    let eg = c.createLinearGradient(0, 0, 110, 0);
    eg.addColorStop(0, 'rgba(0,0,0,0.22)'); eg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = eg; c.fillRect(0, 0, 110, WORLD.h);
    eg = c.createLinearGradient(WORLD.w, 0, WORLD.w - 110, 0);
    eg.addColorStop(0, 'rgba(0,0,0,0.22)'); eg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = eg; c.fillRect(WORLD.w - 110, 0, 110, WORLD.h);
  }

  function tree(c, x, y, s, color, rnd) {
    c.fillStyle = color;
    c.fillRect(x - 1.5, y - s * 0.5, 3, s * 0.55);
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.arc(x + (rnd() - 0.5) * s * 0.5, y - s * (0.6 + i * 0.2), s * (0.3 - i * 0.06), 0, PI2);
      c.fill();
    }
  }

  function buildHills(strip, amp, top, bottom, seed, treeChance) {
    const c = strip.getContext('2d');
    const W = strip.width, H = strip.height, base = 460;
    const yAt = x => base + Math.sin(x * 0.004 + seed) * amp + Math.sin(x * 0.011 + seed * 2) * amp * 0.45;
    let g = c.createLinearGradient(0, base - amp * 1.8, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(0.4, bottom);
    g.addColorStop(1, shade(bottom, -0.4));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) c.lineTo(x, yAt(x));
    c.lineTo(W, H); c.closePath(); c.fill();
    // crest rim light
    c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 3;
    c.beginPath();
    for (let x = 0; x <= W; x += 16) { if (x === 0) c.moveTo(x, yAt(x)); else c.lineTo(x, yAt(x)); }
    c.stroke();
    // tree silhouettes
    const rnd = mulberry((seed * 7919) | 0);
    for (let x = 70; x < W - 70; x += 80 + rnd() * 170) {
      if (rnd() < treeChance) tree(c, x, yAt(x) + 6, 16 + rnd() * 26, shade(bottom, -0.45), rnd);
    }
  }

  function buildAll() {
    buildWorldLayer();
    buildHills(layers.hillsFar, 55, '#cfe8b8', '#a5cf92', 1.7, 0.5);
    buildHills(layers.hillsNear, 75, '#a8d68f', '#8bc276', 4.2, 0.75);
  }
  buildAll();

  function drawScenery(ctx, cam, vh) {
    ctx.drawImage(layers.hillsFar, -cam.x * 0.25, vh * 0.62 - 460 - cam.y * 0.125);
    ctx.drawImage(layers.hillsNear, -cam.x * 0.45, vh * 0.78 - 460 - cam.y * 0.225);
  }

  return { layers, drawScenery, glow, flame, shade, bodyShadow, surfaceYBelow };
})();
