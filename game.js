'use strict';
// Main game: loop, camera, rendering, HUD, menus, effects.
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const mmCanvas = document.getElementById('minimap');
  const mmCtx = mmCanvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const wrap = $('wrap');

  // ---------- view / scaling ----------
  // Internal render resolution adapts to the screen aspect so the game is
  // full-bleed on phones (landscape) and desktops alike. Game logic uses these units.
  const VIEW = { w: VIEW_W, h: VIEW_H, rs: 1 };
  window.VIEW = VIEW;

  function isTouchDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }
  let touchPref = isTouchDevice();

  function createGradients() {
    skyGrad = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    skyGrad.addColorStop(0, '#6ec6ff');
    skyGrad.addColorStop(0.55, '#b3e5fc');
    skyGrad.addColorStop(1, '#e3f6fd');
    vignette = ctx.createRadialGradient(VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.45, VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.9);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.32)');
  }

  function viewportSize() {
    const vv = window.visualViewport;
    if (vv) return { w: Math.round(vv.width), h: Math.round(vv.height) };
    return {
      w: document.documentElement.clientWidth || window.innerWidth,
      h: document.documentElement.clientHeight || window.innerHeight
    };
  }

  function safeInsets() {
    return {
      t: $('safeProbeT') ? $('safeProbeT').offsetHeight : 0,
      b: $('safeProbeB') ? $('safeProbeB').offsetHeight : 0,
      l: $('safeProbeL') ? $('safeProbeL').offsetWidth : 0,
      r: $('safeProbeR') ? $('safeProbeR').offsetWidth : 0
    };
  }

  function fit() {
    const vp = viewportSize();
    const sa = safeInsets();
    const availW = Math.max(320, vp.w - sa.l - sa.r);
    const availH = Math.max(320, vp.h - sa.t - sa.b);
    const h = touchPref ? 720 : 900;
    const w = clamp(Math.round(h * availW / availH), 780, 1920);
    VIEW.w = w; VIEW.h = h;
    VIEW.rs = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * VIEW.rs);
    canvas.height = Math.round(h * VIEW.rs);
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    const s = Math.min(availW / w, availH / h);
    wrap.style.left = Math.round(sa.l + (availW - w * s) / 2) + 'px';
    wrap.style.top = Math.round(sa.t + (availH - h * s) / 2) + 'px';
    wrap.style.transform = 'scale(' + s + ')';
    createGradients();
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 120));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
  window.addEventListener('fullscreenchange', () => setTimeout(fit, 150));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(fit, 60); });

  // ---------- state ----------
  const state = { mode: 'menu', frame: 0, diff: 'normal', shake: 0, aimFrom: 'mouse', hintT: 600, mpBots: 2, mpDiff: 'normal' };
  const cam = { x: 0, y: WORLD.h - VIEW.h };
  let player = null, winner = null, matchT = 0, selectedDiff = 'normal';
  let clientAim = 0;
  const clientCounters = { s: 0, g: 0, r: 0 };

  const G = {
    frame: 0,
    bodies: [], bullets: [], grenades: [], pickups: [], particles: [], floaters: [], events: [],
    hitFlash: 0,
    clouds: CLOUDS.map(c => ({ ...c })),
    explode, sparks, burst, jetSmoke, floatText, addFeed, addShake, checkWin, dropWeapon,
  };
  window.G = G; // entities.js (separate script) resolves G through the global scope
  window.__G = {
    get player() { return player; },
    get bodies() { return G.bodies; },
    get bullets() { return G.bullets.length; },
    get grenades() { return G.grenades.length; },
    get state() { return state.mode; },
    startGame, checkWin,
  };

  window.__errors = [];
  window.addEventListener('error', e => {
    window.__errors.push(String(e.message));
    $('errBox').classList.remove('hidden');
    $('errText').textContent = window.__errors[window.__errors.length - 1];
  });

  // ---------- effects ----------
  function addShake(a) { state.shake = Math.max(state.shake, a); }
  function burst(x, y, n, color, speed, life, grav, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      G.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.5,
        life: (life * (0.5 + Math.random() * 0.5)) | 0, maxLife: life,
        color, size: size * (0.6 + Math.random() * 0.8), grav,
      });
    }
    if (G.particles.length > 500) G.particles.splice(0, G.particles.length - 500);
  }
  function sparks(x, y, n, color) { burst(x, y, n, color, 3.2, 18, 0.05, 2); }
  function jetSmoke(x, y, facing) {
    G.particles.push({
      x: x + (Math.random() - 0.5) * 4, y,
      vx: -facing * (0.6 + Math.random()), vy: 1.2 + Math.random() * 1.4,
      life: 22, maxLife: 22,
      color: Math.random() < 0.5 ? '#b0bec5' : '#ffcc80',
      size: 3 + Math.random() * 2.5, grav: -0.01,
    });
  }
  function floatText(x, y, text, color) { G.floaters.push({ x, y, text, color, t: 60 }); }
  function addFeed(html) {
    const feed = $('killFeed');
    const el = document.createElement('div');
    el.className = 'feedItem';
    el.innerHTML = html;
    feed.prepend(el);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 500); }, 3800);
  }
  function dropWeapon(x, y, wname) {
    G.pickups.push(new Pickup(clamp(x, 30, WORLD.w - 30), clamp(y, 30, WORLD.h - 40), 'weapon', wname, true));
  }
  function explode(x, y, radius, maxDmg, owner) {
    for (const b of G.bodies) {
      if (!b.alive) continue;
      const d = Math.hypot(b.cx - x, b.cy - y);
      const rr = radius + 14;
      if (d < rr) {
        const f = 1 - d / rr;
        b.takeDamage(maxDmg * f + 4, owner);
        const ang = Math.atan2(b.cy - y, b.cx - x);
        b.vx += Math.cos(ang) * f * 9;
        b.vy += Math.sin(ang) * f * 9 - 2;
      }
    }
    burst(x, y, 26, '#ffcc80', 5.5, 40, 0.06, 4);
    burst(x, y, 18, '#b0bec5', 3.5, 55, -0.02, 5);
    burst(x, y, 12, '#fff59d', 7, 18, 0.02, 2.5);
    // fireball bloom, hot core glows and a shockwave ring
    G.particles.push({ x, y, vx: 0, vy: 0, grav: 0, life: 14, maxLife: 14, color: '#ffb74d', size: 190, add: true });
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3.5;
      G.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 0, life: 16 + Math.random() * 10, maxLife: 24, color: Math.random() < 0.5 ? '#ff9800' : '#ffcc80', size: 26 + Math.random() * 22, add: true });
    }
    G.particles.push({ x, y, r: 10, vr: 6.5, life: 18, maxLife: 18, ring: true });
    addShake(12);
    AudioSys.explode();
  }

  // ---------- flow ----------
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startGame(diff) {
    state.diff = diff;
    G.bodies.length = 0; G.bullets.length = 0; G.grenades.length = 0;
    G.particles.length = 0; G.floaters.length = 0; G.events.length = 0;
    G.pickups = PICKUP_SPOTS.map(s => new Pickup(s.x, s.y, s.type, s.w));
    const d = BOT_DIFFS[diff];
    const names = shuffle(['Viper', 'Rex', 'Ghost', 'Blaze', 'Nova', 'Falcon', 'Piranha', 'Diesel']);
    const colors = ['#ff5252', '#ffa726', '#ab47bc', '#66bb6a', '#ec407a', '#26c6da', '#9ccc65'];
    const isMp = Net.mode === 'host';
    player = new Character(SPAWNS[0].x, SPAWNS[0].y, 'Player', isMp ? Net.myColor : '#42a5f5', true);
    player.id = 0;
    if (isMp) player.disp = Net.myName;
    G.bodies.push(player);
    if (isMp) {
      for (const c of Net.conns) {
        const s = SPAWNS[(1 + c.id * 2) % SPAWNS.length];
        const b = new Character(s.x, s.y, c.name, c.color, false);
        b.id = c.id;
        b.remote = true;
        c.body = b;
        G.bodies.push(b);
      }
    }
    const botCount = isMp ? state.mpBots : d.count;
    for (let i = 0; i < botCount; i++) {
      const s = SPAWNS[(2 + i * 2) % SPAWNS.length];
      const bot = new Bot(s.x, s.y, names[i], colors[i % colors.length], d);
      bot.id = 100 + i;
      G.bodies.push(bot);
    }
    cam.x = clamp(player.cx - VIEW.w / 2, 0, WORLD.w - VIEW.w);
    cam.y = clamp(player.cy - VIEW.h / 2, 0, WORLD.h - VIEW.h);
    matchT = 0; winner = null;
    G.frame = 0;
    state.mode = 'playing';
    state.hintT = 600;
    $('startMenu').classList.add('hidden');
    $('endMenu').classList.add('hidden');
    $('pauseMenu').classList.add('hidden');
    $('hostPanel').classList.add('hidden');
    $('joinPanel').classList.add('hidden');
    $('deathOverlay').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('killFeed').innerHTML = '';
    AudioSys.ensure();
    if (Net.mode === 'host') { Net.broadcastGo(); Net.sendLobby(); }
    $('touchUI').classList.remove('hidden');
  }

  function toMenu() {
    state.mode = 'menu';
    AudioSys.jetStop();
    $('hud').classList.add('hidden');
    $('touchUI').classList.add('hidden');
    $('pauseMenu').classList.add('hidden');
    $('endMenu').classList.add('hidden');
    $('deathOverlay').classList.add('hidden');
    $('startMenu').classList.remove('hidden');
  }

  function pauseToggle() {
    if (state.mode === 'playing') {
      state.mode = 'paused';
      $('pauseMenu').classList.remove('hidden');
      AudioSys.jetStop();
      if (Net.mode === 'host') Net.broadcastEvent({ t: 'pa', on: true });
    } else if (state.mode === 'paused') {
      state.mode = 'playing';
      $('pauseMenu').classList.add('hidden');
      if (Net.mode === 'host') Net.broadcastEvent({ t: 'pa', on: false });
    }
  }

  function checkWin() {
    if (state.mode !== 'playing') return;
    for (const b of G.bodies) {
      if (b.score >= KILL_LIMIT) { winner = b; endMatch(); return; }
    }
  }

  function endMatch() {
    state.mode = 'over';
    AudioSys.jetStop();
    $('deathOverlay').classList.add('hidden');
    $('scoreboard').classList.add('hidden');
    $('waitHost').classList.add('hidden');
    $('endTitle').textContent = winner === player ? '\uD83C\uDFC6 VICTORY!' : '\uD83D\uDC80 DEFEAT';
    $('endSub').textContent = winner.disp + ' reached ' + KILL_LIMIT + ' kills first';
    fillTable($('endTable'), G.bodies);
    $('endMenu').classList.remove('hidden');
    if (Net.mode === 'host') Net.broadcastEvent({ t: 'end', wid: winner.id, wname: winner.disp, wcolor: winner.color });
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function fillTable(tbl, list) {
    const rows = [...(list || G.bodies)].sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    tbl.innerHTML = '<tr><th>Player</th><th>Kills</th><th>Deaths</th></tr>' +
      rows.map(b =>
        '<tr class="' + (Net.mode === 'client' ? (b.id === Net.myId ? 'me' : '') : (b === player ? 'me' : '')) + '">' +
        '<td style="color:' + b.color + '">' + escHtml(b.disp) + '</td>' +
        '<td>' + b.score + '</td><td>' + b.deaths + '</td></tr>'
      ).join('');
  }

  // ---------- input -> player command ----------
  function playerControl() {
    const c = player.cmd;
    c.left = Input.down('KeyA');
    c.right = Input.down('KeyD');
    c.jet = Input.down('KeyW');
    c.drop = Input.down('KeyS');
    const up = Input.down('ArrowUp'), dn = Input.down('ArrowDown');
    const lf = Input.down('ArrowLeft'), rt = Input.down('ArrowRight');
    const ax = (rt ? 1 : 0) - (lf ? 1 : 0);
    const ay = (dn ? 1 : 0) - (up ? 1 : 0);
    const m = Input.mouse;
    const mouseActive = (performance.now() - m.lastMove < 2500) || m.down;
    let aimed = false;
    if (ax || ay) {
      player.aimAngle = Math.atan2(ay, ax);
      aimed = true;
      state.aimFrom = 'keys';
    } else if (Input.touch.aiming) {
      player.aimAngle = Math.atan2(Input.touch.ay, Input.touch.ax);
      aimed = true;
      state.aimFrom = 'keys';
    } else if (mouseActive) {
      const wx = m.x + cam.x, wy = m.y + cam.y;
      const dx = wx - player.cx, dy = wy - player.cy;
      if (dx * dx + dy * dy > 49) {
        player.aimAngle = Math.atan2(dy, dx);
        aimed = true;
      }
      state.aimFrom = 'mouse';
    }
    if (aimed) c.facing = Math.cos(player.aimAngle) >= 0 ? 1 : -1;
    else if (c.left) c.facing = -1;
    else if (c.right) c.facing = 1;
    else c.facing = 0;

    c.shootEdge = Input.pressed('Space') || Input.pressed('KeyJ');
    c.shootHeld = Input.down('Space') || Input.down('KeyJ') || m.down;
    c.grenEdge = Input.pressed('KeyK');
    c.reloadEdge = Input.pressed('KeyR');
  }

  // ---------- update ----------
  function update() {
    if (Input.pressed('KeyM')) addFeed(AudioSys.toggleMute() ? '\uD83D\uDD07 Muted' : '\uD83D\uDD0A Unmuted');
    const mpClient = Net.mode === 'client';
    if (!mpClient && (Input.pressed('Escape') || Input.pressed('KeyP'))) {
      if (state.mode === 'playing' || state.mode === 'paused') pauseToggle();
    }
    if (state.mode === 'menu' && Input.pressed('Enter')) startGame(selectedDiff);
    else if (state.mode === 'over' && !mpClient && Input.pressed('Enter')) startGame(state.diff);

    if (state.mode !== 'playing') { Input.endFrame(); return; }

    if (mpClient) { clientUpdate(); Input.endFrame(); return; }

    G.frame++; state.frame++; matchT++;
    if (state.hintT > 0) state.hintT--;

    if (player.alive) playerControl();
    if (Net.mode === 'host') Net.applyInputs();
    for (const b of G.bodies) {
      if (!b.isPlayer && !b.remote && b.alive && b.think) b.think();
      b.updateFromCmd();
    }
    if (player.alive && player.jetting) AudioSys.jetStart(); else AudioSys.jetStop();

    for (const bl of G.bullets) bl.update();
    G.bullets = G.bullets.filter(b => !b.dead);
    for (const g of G.grenades) g.update();
    G.grenades = G.grenades.filter(g => !g.dead);
    for (const p of G.pickups) p.update(G.frame);
    G.pickups = G.pickups.filter(p => !p.dead);
    for (const p of G.particles) { p.x += p.vx; p.y += p.vy; p.vy += p.grav; if (p.vr) p.r += p.vr; p.life--; }
    G.particles = G.particles.filter(p => p.life > 0);
    for (const f of G.floaters) { f.y -= 0.7; f.t--; }
    G.floaters = G.floaters.filter(f => f.t > 0);
    for (const c of G.clouds) {
      c.x += c.v * 0.4;
      if (c.x > WORLD.w + 400) c.x = -400;
    }
    G.hitFlash *= 0.85;

    // camera
    const leadX = Math.cos(player.aimAngle) * 50;
    const leadY = Math.sin(player.aimAngle) * 30;
    const tx = clamp(player.cx + leadX - VIEW.w / 2, 0, WORLD.w - VIEW.w);
    const ty = clamp(player.cy - 40 + leadY - VIEW.h / 2, 0, WORLD.h - VIEW.h);
    cam.x += (tx - cam.x) * 0.12;
    cam.y += (ty - cam.y) * 0.12;
    state.shake *= 0.88;
    if (state.shake < 0.2) state.shake = 0;

    if (Net.mode === 'host') Net.hostTick();
    updateHUD();
    Input.endFrame();
  }

  // ---------- client-side update (renders host snapshots) ----------
  function clientUpdate() {
    G.frame++; state.frame++;
    Net.clientTick();
    const view = Net.updateView();
    if (view) matchT = view.matchT;
    if (state.hintT > 0) state.hintT--;

    clientControl(view ? view.self : null);
    processClientEvents();

    for (const p of G.particles) { p.x += p.vx; p.y += p.vy; p.vy += p.grav; if (p.vr) p.r += p.vr; p.life--; }
    G.particles = G.particles.filter(p => p.life > 0);
    for (const f of G.floaters) { f.y -= 0.7; f.t--; }
    G.floaters = G.floaters.filter(f => f.t > 0);
    for (const c of G.clouds) {
      c.x += c.v * 0.4;
      if (c.x > WORLD.w + 400) c.x = -400;
    }
    G.hitFlash *= 0.85;
    if (view) {
      for (const b of view.bodies) {
        if (b.jetting && b.alive && Math.random() < 0.55) G.jetSmoke(b.cx - b.facing * 9, b.cy + 4, b.facing);
      }
      const s = view.self;
      if (s) {
        const leadX = Math.cos(clientAim) * 50, leadY = Math.sin(clientAim) * 30;
        const tx = clamp(s.cx + leadX - VIEW.w / 2, 0, WORLD.w - VIEW.w);
        const ty = clamp(s.cy - 40 + leadY - VIEW.h / 2, 0, WORLD.h - VIEW.h);
        cam.x += (tx - cam.x) * 0.12;
        cam.y += (ty - cam.y) * 0.12;
      }
    }
    state.shake *= 0.88;
    if (state.shake < 0.2) state.shake = 0;
    updateHUDClient(view);
  }

  function clientControl(self) {
    const m = Input.mouse;
    const inp = {
      l: Input.down('KeyA') ? 1 : 0,
      r: Input.down('KeyD') ? 1 : 0,
      j: Input.down('KeyW') ? 1 : 0,
      d: Input.down('KeyS') ? 1 : 0,
      s: (Input.down('Space') || Input.down('KeyJ') || m.down) ? 1 : 0,
      a: clientAim, f: 0,
      cs: clientCounters.s, cg: clientCounters.g, cr: clientCounters.r,
    };
    if (self) {
      const up = Input.down('ArrowUp'), dn = Input.down('ArrowDown');
      const lf = Input.down('ArrowLeft'), rt = Input.down('ArrowRight');
      const ax = (rt ? 1 : 0) - (lf ? 1 : 0);
      const ay = (dn ? 1 : 0) - (up ? 1 : 0);
      const mouseActive = (performance.now() - m.lastMove < 2500) || m.down;
      let aimed = false;
      if (ax || ay) { inp.a = Math.atan2(ay, ax); aimed = true; state.aimFrom = 'keys'; }
      else if (Input.touch.aiming) { inp.a = Math.atan2(Input.touch.ay, Input.touch.ax); aimed = true; state.aimFrom = 'keys'; }
      else if (mouseActive) {
        const wx = m.x + cam.x, wy = m.y + cam.y;
        const dx = wx - self.cx, dy = wy - self.cy;
        if (dx * dx + dy * dy > 49) { inp.a = Math.atan2(dy, dx); aimed = true; }
        state.aimFrom = 'mouse';
      }
      if (aimed) inp.f = Math.cos(inp.a) >= 0 ? 1 : -1;
      else if (inp.l) inp.f = -1;
      else if (inp.r) inp.f = 1;
    }
    if (Input.pressed('Space') || Input.pressed('KeyJ')) clientCounters.s++;
    if (Input.pressed('KeyK')) clientCounters.g++;
    if (Input.pressed('KeyR')) clientCounters.r++;
    inp.cs = clientCounters.s; inp.cg = clientCounters.g; inp.cr = clientCounters.r;
    clientAim = inp.a;
    Net.clientSendInput(inp);
  }

  function processClientEvents() {
    for (const ev of Net.drainEvents()) {
      if (ev.t === 's') {
        G.sparks(ev.x, ev.y, 3, '#ffd54f');
        AudioSys.shoot(ev.w);
      } else if (ev.t === 'b') {
        G.burst(ev.x, ev.y, 26, '#ffcc80', 5.5, 40, 0.06, 4);
        G.burst(ev.x, ev.y, 14, '#b0bec5', 3.5, 55, -0.02, 5);
        G.particles.push({ x: ev.x, y: ev.y, vx: 0, vy: 0, grav: 0, life: 14, maxLife: 14, color: '#ffb74d', size: 190, add: true });
        G.particles.push({ x: ev.x, y: ev.y, r: 10, vr: 6.5, life: 18, maxLife: 18, ring: true });
        G.addShake(12);
        AudioSys.explode();
      } else if (ev.t === 'k') {
        const n = s => '<span style="color:' + s.c + ';font-weight:700">' + escHtml(s.n) + '</span>';
        if (ev.self) G.addFeed(n({ n: ev.vn, c: ev.vc }) + ' \uD83D\uDC80 fragged themselves');
        else G.addFeed(n({ n: ev.an, c: ev.ac }) + ' \uD83D\uDD2D ' + n({ n: ev.vn, c: ev.vc }));
        AudioSys.death();
      } else if (ev.t === 'p') {
        G.floatText(ev.x, ev.y, ev.lb, '#ffe082');
        AudioSys.pickup();
      } else if (ev.t === 'jl') {
        G.addFeed('<b>' + escHtml(ev.n) + (ev.k === 'join' ? ' joined the match' : ' left the match') + '</b>');
      } else if (ev.t === 'go') {
        G.particles.length = 0; G.floaters.length = 0;
        $('killFeed').innerHTML = '';
        matchT = 0;
        clientCounters.s = 0; clientCounters.g = 0; clientCounters.r = 0;
      } else if (ev.t === 'pa') {
        $('mpBanner').textContent = ev.on ? 'HOST PAUSED' : '';
        $('mpBanner').classList.toggle('hidden', !ev.on);
      } else if (ev.t === 'end') {
        clientEnd(ev);
      }
    }
  }

  function clientEnd(ev) {
    state.mode = 'over';
    AudioSys.jetStop();
    $('deathOverlay').classList.add('hidden');
    $('scoreboard').classList.add('hidden');
    $('mpBanner').classList.add('hidden');
    $('endTitle').textContent = ev.wid === Net.myId ? '\uD83C\uDFC6 VICTORY!' : '\uD83D\uDC80 DEFEAT';
    $('endSub').textContent = (ev.wname || 'Someone') + ' reached ' + KILL_LIMIT + ' kills first';
    $('waitHost').classList.remove('hidden');
    if (Net.view) fillTable($('endTable'), Net.view.bodies);
    $('endMenu').classList.remove('hidden');
  }

  function clientStartMatch() {
    state.mode = 'playing';
    G.particles.length = 0; G.floaters.length = 0;
    G.bullets.length = 0; G.grenades.length = 0;
    $('endMenu').classList.add('hidden');
    $('joinPanel').classList.add('hidden');
    $('hostPanel').classList.add('hidden');
    $('startMenu').classList.add('hidden');
    $('deathOverlay').classList.add('hidden');
    $('mpBanner').classList.add('hidden');
    $('waitHost').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('touchUI').classList.remove('hidden');
    $('killFeed').innerHTML = '';
    matchT = 0;
    state.hintT = 600;
    clientCounters.s = 0; clientCounters.g = 0; clientCounters.r = 0;
    AudioSys.ensure();
  }

  function updateHUDClient(view) {
    const self = view && view.self;
    if (!self) return;
    const w = WEAPONS[self.weapon];
    $('healthFill').style.width = clamp(self.hp, 0, 100) + '%';
    $('fuelFill').style.width = clamp(self.fuel, 0, 100) + '%';
    $('weaponText').textContent = w.name;
    $('ammoText').textContent = self.reloading ? 'RELOADING' : self.ammo + ' / ' + w.ammo;
    $('grenText').textContent = '\u2726 ' + self.grenades;
    if (G.frame % 15 === 0) updateNetChip();

    if (G.frame % 10 === 0) {
      const sorted = [...view.bodies].sort((a, b) => b.score - a.score);
      $('scoreStrip').innerHTML = sorted.map(b =>
        '<span class="chip' + (b.id === Net.myId ? ' me' : '') + '"><i style="background:' + b.color + '"></i>' +
        escHtml(b.disp) + ' <b>' + b.score + '</b></span>'
      ).join('') + '<span class="limit">FIRST TO ' + KILL_LIMIT + '</span>';
    }

    const dOv = $('deathOverlay');
    if (!self.alive) {
      dOv.classList.remove('hidden');
      $('deathText').textContent = 'RESPAWNING IN ' + Math.max(1, Math.ceil(self.respawnT / 60)) + '\u2026';
    } else dOv.classList.add('hidden');

    const sb = $('scoreboard');
    if (Input.down('Tab')) { sb.classList.remove('hidden'); fillTable($('sbTable'), view.bodies); }
    else sb.classList.add('hidden');

    $('hintBar').style.opacity = state.hintT > 0 ? 1 : 0.25;
  }

  // ---------- HUD ----------
  function updateNetChip() {
    const chip = $('netChip');
    if (Net.mode === 'off') { chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden');
    const d = Net.debugInfo();
    let txt = '', bad = false;
    if (d.mode === 'host') {
      txt = 'HOSTING ' + d.code.toUpperCase() + ' \u00b7 ' + d.players + 'P';
      if (d.players > 1 && d.lastInAgo > 4) { txt += ' \u00b7 STALLED'; bad = true; }
    } else if (d.mode === 'client') {
      if (d.snapAgo < 0 || d.snapAgo > 4) { txt = 'MP \u00b7 NO SIGNAL'; bad = true; }
      else txt = 'MP \u00b7 ' + d.snapAgo.toFixed(1) + 's';
    }
    chip.textContent = txt;
    chip.classList.toggle('bad', bad);
  }

  function updateHUD() {
    const w = WEAPONS[player.weapon];
    $('healthFill').style.width = clamp(player.hp, 0, 100) + '%';
    $('fuelFill').style.width = clamp(player.fuel, 0, 100) + '%';
    $('weaponText').textContent = w.name;
    $('ammoText').textContent = player.reloading ? 'RELOADING' : player.ammo + ' / ' + w.ammo;
    $('grenText').textContent = '\u2726 ' + player.grenades;
    if (G.frame % 15 === 0) updateNetChip();

    if (G.frame % 10 === 0) {
      const sorted = [...G.bodies].sort((a, b) => b.score - a.score);
      $('scoreStrip').innerHTML = sorted.map(b =>
        '<span class="chip' + (b === player ? ' me' : '') + '"><i style="background:' + b.color + '"></i>' +
        b.disp + ' <b>' + b.score + '</b></span>'
      ).join('') + '<span class="limit">FIRST TO ' + KILL_LIMIT + '</span>';
    }

    const dOv = $('deathOverlay');
    if (!player.alive) {
      dOv.classList.remove('hidden');
      $('deathText').textContent = 'RESPAWNING IN ' + Math.ceil(player.respawnT / 60) + '\u2026';
    } else dOv.classList.add('hidden');

    const sb = $('scoreboard');
    if (Input.down('Tab')) { sb.classList.remove('hidden'); fillTable($('sbTable')); }
    else sb.classList.add('hidden');

    $('hintBar').style.opacity = state.hintT > 0 ? 1 : 0.25;
  }

  // ---------- rendering ----------
  let skyGrad = null, vignette = null;

  function drawClouds(now) {
    for (const c of G.clouds) {
      let x = c.x - cam.x * 0.25 - now * 0.004 * c.v;
      const span = WORLD.w + 800;
      x = ((x % span) + span) % span - 400;
      const y = c.y - cam.y * 0.15;
      const s = c.s;
      const puff = (px, py, col) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px, py, 26 * s, 0, Math.PI * 2);
        ctx.arc(px + 24 * s, py - 10 * s, 20 * s, 0, Math.PI * 2);
        ctx.arc(px + 48 * s, py, 24 * s, 0, Math.PI * 2);
        ctx.fill();
      };
      puff(x + 4, y + 7, 'rgba(130,160,195,0.28)');
      puff(x, y, 'rgba(255,255,255,0.93)');
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.ellipse(x + 24 * s, y + 8 * s, 40 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  function render() {
    const now = performance.now();
    ctx.setTransform(VIEW.rs, 0, 0, VIEW.rs, 0, 0);
    // sky
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    // sun with bloom
    const sunX = VIEW.w - 180 - cam.x * 0.05, sunY = 110 - cam.y * 0.05;
    Scenery.glow(ctx, sunX, sunY, 150, '#fff59d', 0.5);
    ctx.fillStyle = '#fffde7';
    ctx.beginPath(); ctx.arc(sunX, sunY, 40, 0, Math.PI * 2); ctx.fill();
    drawClouds(now);
    Scenery.drawScenery(ctx, cam, VIEW.h);

    // world space
    const sx = (Math.random() * 2 - 1) * state.shake;
    const sy = (Math.random() * 2 - 1) * state.shake;
    ctx.save();
    ctx.translate(-cam.x + sx, -cam.y + sy);

    const view = Net.mode === 'client' ? Net.view : null;
    const V = view || { bodies: G.bodies, bullets: G.bullets, grenades: G.grenades, pickups: G.pickups };

    // pre-rendered world (platforms, ground, decor, baked shadows)
    ctx.drawImage(Scenery.layers.world, 0, 0);

    // dynamic shadows under everything alive
    for (const b of V.bodies) if (b.alive) Scenery.bodyShadow(ctx, b);

    for (const p of V.pickups) p.draw(ctx, G.frame);
    for (const g of V.grenades) g.draw(ctx);
    for (const b of V.bodies) if (!b.isPlayer) b.draw(ctx);
    if (Net.mode !== 'client' && player) player.draw(ctx);
    for (const b of V.bullets) b.draw(ctx);

    // particles (soft squares, additive glows, shockwave rings)
    for (const p of G.particles) {
      const t = Math.max(0, p.life / p.maxLife);
      if (p.ring) {
        ctx.strokeStyle = 'rgba(255,213,128,' + (t * 0.85).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      if (p.add) {
        Scenery.glow(ctx, p.x, p.y, p.size * (0.4 + t * 0.6), p.color, t * 0.9);
        continue;
      }
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // aim guide line
    if (state.mode === 'playing' && Net.mode !== 'client' && player && player.alive) {
      const a = player.aimAngle;
      const mx = player.cx + Math.cos(a) * 28, my = player.cy - 3 + Math.sin(a) * 28;
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(a) * 150, my + Math.sin(a) * 150);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (state.mode === 'playing' && view && view.self && view.self.alive) {
      const a = clientAim;
      const mx = view.self.cx + Math.cos(a) * 28, my = view.self.cy - 3 + Math.sin(a) * 28;
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(a) * 150, my + Math.sin(a) * 150);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // floaters
    ctx.font = 'bold 15px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const f of G.floaters) {
      ctx.globalAlpha = f.t / 60;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // crosshair (screen space)
    const mouseLive = (performance.now() - Input.mouse.lastMove < 2500) || Input.mouse.down;
    if (state.mode === 'playing' && player && player.alive && Net.mode !== 'client' && state.aimFrom === 'mouse' && mouseLive) {
      const mx = Input.mouse.x, my = Input.mouse.y;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - 14, my); ctx.lineTo(mx - 5, my);
      ctx.moveTo(mx + 5, my); ctx.lineTo(mx + 14, my);
      ctx.moveTo(mx, my - 14); ctx.lineTo(mx, my - 5);
      ctx.moveTo(mx, my + 5); ctx.lineTo(mx, my + 14);
      ctx.stroke();
      ctx.fillStyle = '#ff5252';
      ctx.beginPath(); ctx.arc(mx, my, 1.8, 0, Math.PI * 2); ctx.fill();
    }

    // FIGHT banner
    if (state.mode === 'playing' && matchT < 110) {
      const a = 1 - matchT / 110;
      ctx.globalAlpha = a;
      ctx.save();
      ctx.shadowColor = 'rgba(66,165,243,0.9)';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 84px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(20,40,80,0.85)';
      ctx.lineWidth = 8;
      ctx.strokeText('FIGHT!', VIEW.w / 2, VIEW.h / 2 - 30);
      ctx.fillText('FIGHT!', VIEW.w / 2, VIEW.h / 2 - 30);
      ctx.restore();
      ctx.font = '600 22px Segoe UI, sans-serif';
      ctx.fillStyle = '#e3f2fd';
      ctx.fillText('FIRST TO ' + KILL_LIMIT + ' KILLS', VIEW.w / 2, VIEW.h / 2 + 16);
      ctx.globalAlpha = 1;
    }

    // vignette + damage feedback
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    const hurt = Math.min(1, (G.hitFlash || 0) / 8);
    const lowHp = player && player.alive && player.hp < 30 ? 0.12 + 0.08 * Math.sin(now * 0.012) : 0;
    const redA = Math.max(hurt * 0.4, lowHp);
    if (redA > 0.01) {
      const rg = ctx.createRadialGradient(VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.3, VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.85);
      rg.addColorStop(0, 'rgba(180,20,20,0)');
      rg.addColorStop(1, 'rgba(180,20,20,' + redA.toFixed(3) + ')');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    }

    // minimap
    if (state.mode !== 'menu') drawMinimap(V);
  }

  function drawMinimap(V) {
    const s = 180 / WORLD.w; // 0.075
    mmCtx.clearRect(0, 0, 180, 105);
    mmCtx.fillStyle = 'rgba(10,20,40,0.6)';
    mmCtx.fillRect(0, 0, 180, 105);
    mmCtx.fillStyle = '#69a85c';
    for (const p of PLATFORMS) {
      mmCtx.fillRect(p.x * s, p.y * s, Math.max(2, p.w * s), Math.max(1.5, p.h * s));
    }
    mmCtx.fillStyle = '#ffe082';
    for (const p of V.pickups) {
      if (p.active) mmCtx.fillRect(p.x * s - 1.5, p.y * s - 1.5, 3, 3);
    }
    for (const b of V.bodies) {
      if (!b.alive) continue;
      mmCtx.fillStyle = b.color;
      mmCtx.fillRect(b.cx * s - 2, b.cy * s - 2, 4, 4);
      const isMe = Net.mode === 'client' ? b.id === Net.myId : b === player;
      if (isMe) {
        mmCtx.strokeStyle = '#ffffff';
        mmCtx.lineWidth = 1;
        mmCtx.strokeRect(b.cx * s - 3.5, b.cy * s - 3.5, 7, 7);
      }
    }
  }

  // ---------- main loop ----------
  let last = performance.now(), acc = 0;
  const STEP = 1 / 60;
  function frameLoop(t) {
    requestAnimationFrame(frameLoop);
    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.1) dt = 0.1;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 4) { update(); acc -= STEP; n++; }
    if (acc >= STEP) acc = 0;
    render();
  }

  // ---------- menu wiring ----------
  document.querySelectorAll('#startMenu .diffRow .diffBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      AudioSys.ensure(); AudioSys.click();
      document.querySelectorAll('#startMenu .diffRow .diffBtn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDiff = btn.dataset.diff;
    });
  });
  document.querySelectorAll('#botRow .diffBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      AudioSys.ensure(); AudioSys.click();
      document.querySelectorAll('#botRow .diffBtn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.mpBots = parseInt(btn.dataset.bots, 10);
      Net.sendLobby();
    });
  });
  document.querySelectorAll('#mpDiffRow .diffBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      AudioSys.ensure(); AudioSys.click();
      document.querySelectorAll('#mpDiffRow .diffBtn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.mpDiff = btn.dataset.diff;
    });
  });
  $('playBtn').addEventListener('click', () => { AudioSys.ensure(); AudioSys.click(); startGame(selectedDiff); });
  $('resumeBtn').addEventListener('click', () => { AudioSys.click(); pauseToggle(); });
  $('restartBtn').addEventListener('click', () => { AudioSys.click(); startGame(state.diff); });
  $('quitBtn').addEventListener('click', () => { AudioSys.click(); Net.leave(); toMenu(); });
  $('menuBtn').addEventListener('click', () => { AudioSys.click(); Net.leave(); toMenu(); });

  // ---------- multiplayer wiring ----------
  function renderLobby() {
    const rows = [{ name: Net.myName + ' (host)', color: Net.myColor }]
      .concat(Net.conns.map(c => ({ name: c.name, color: c.color })));
    $('lobbyList').innerHTML = rows.map(r =>
      '<div style="color:' + r.color + '">' + escHtml(r.name) + '</div>').join('');
  }

  function mpFail(msg) {
    $('joinStatus').textContent = msg;
    $('joinStatus').style.color = '#ff8a80';
  }

  const mpUi = {
    onHostReady(codeShown) {
      $('roomCode').textContent = codeShown;
      renderLobby();
      $('startMenu').classList.add('hidden');
      $('hostPanel').classList.remove('hidden');
    },
    onRosterChange(id, name, kind) {
      addFeed('<b>' + escHtml(name) + (kind === 'join' ? ' joined the room' : ' left the room') + '</b>');
      if (Net.mode === 'host') Net.broadcastEvent({ t: 'jl', n: name, k: kind });
      renderLobby();
    },
    onClientJoined(entry) {
      if (Net.mode !== 'host' || state.mode !== 'playing') return;
      const s = SPAWNS[(1 + entry.id * 2) % SPAWNS.length];
      const b = new Character(s.x, s.y, entry.name, entry.color, false);
      b.id = entry.id;
      b.remote = true;
      entry.body = b;
      G.bodies.push(b);
    },
    onClientLeft(entry) {
      if (!entry.body) return;
      const i = G.bodies.indexOf(entry.body);
      if (i >= 0) G.bodies.splice(i, 1);
      entry.body = null;
    },
    onJoined() {
      $('joinStatus').style.color = '#a9c1e0';
      $('joinStatus').textContent = 'Connected! Waiting for the host to start\u2026';
    },
    onLobby(players) {
      $('joinStatus').style.color = '#a9c1e0';
      $('joinStatus').textContent = 'In room (' + players.length + ' players) \u2014 waiting for the host to start\u2026';
    },
    onStart() { clientStartMatch(); },
    onStall(on) {
      $('mpBanner').textContent = on ? 'CONNECTION STALLED \u2014 trying to recover\u2026' : '';
      $('mpBanner').classList.toggle('hidden', !on);
    },
    onDropped() {
      toMenu();
      $('mpBanner').textContent = 'Disconnected from host';
      $('mpBanner').classList.remove('hidden');
      setTimeout(() => $('mpBanner').classList.add('hidden'), 4000);
    },
    onError(msg) {
      if (state.mode === 'menu') {
        $('startMenu').classList.remove('hidden');
        $('hostPanel').classList.add('hidden');
        $('joinPanel').classList.remove('hidden');
        mpFail(msg);
      } else {
        $('mpBanner').textContent = msg;
        $('mpBanner').classList.remove('hidden');
        setTimeout(() => $('mpBanner').classList.add('hidden'), 4000);
      }
    },
    onRestartRequest() { if (state.mode === 'over') startGame(state.diff); },
    getBots() { return state.mpBots; },
    getMatchT() { return matchT; },
  };

  $('hostBtn').addEventListener('click', () => {
    AudioSys.ensure(); AudioSys.click();
    if (typeof Peer === 'undefined') { mpFail('PeerJS library missing'); return; }
    Net.host($('nameInput').value, mpUi);
    $('startMenu').classList.add('hidden');
    $('hostPanel').classList.remove('hidden');
    $('roomCode').textContent = '\u2026';
  });
  $('joinBtn').addEventListener('click', () => {
    AudioSys.ensure(); AudioSys.click();
    if (typeof Peer === 'undefined') { mpFail('PeerJS library missing'); return; }
    $('startMenu').classList.add('hidden');
    $('joinPanel').classList.remove('hidden');
    $('joinStatus').style.color = '#a9c1e0';
    $('joinStatus').textContent = 'Enter the room code.';
    $('codeInput').value = '';
  });
  $('connectBtn').addEventListener('click', () => {
    AudioSys.ensure(); AudioSys.click();
    const codeIn = $('codeInput').value.trim();
    if (!codeIn) { mpFail('Enter a room code first.'); return; }
    $('joinStatus').style.color = '#a9c1e0';
    $('joinStatus').textContent = 'Connecting\u2026';
    Net.join(codeIn, $('nameInput').value, mpUi);
  });
  $('startMpBtn').addEventListener('click', () => { AudioSys.click(); startGame(state.mpDiff); });
  $('hostBackBtn').addEventListener('click', () => { AudioSys.click(); Net.leave(); toMenu(); });
  $('joinBackBtn').addEventListener('click', () => { AudioSys.click(); Net.leave(); toMenu(); });
  $('againBtn').addEventListener('click', () => {
    AudioSys.click();
    if (Net.mode === 'client') Net.requestRestart();
    else startGame(state.diff);
  });

  window.__G = {
    get player() { return player; },
    get bodies() { return G.bodies; },
    get bullets() { return G.bullets.length; },
    get grenades() { return G.grenades.length; },
    get state() { return state.mode; },
    get net() { return Net.mode; },
    startGame, checkWin,
  };

  // ---------- touch controls ----------
  function applyTouchMode() {
    document.body.classList.toggle('touchOn', touchPref);
    const t = $('touchToggle');
    if (t) t.textContent = touchPref
      ? (isTouchDevice() ? '\uD83D\uDCF1 TOUCH CONTROLS: ON' : '\uD83D\uDCF1 TOUCH CONTROLS: FORCED ON')
      : '\uD83D\uDCF1 TOUCH CONTROLS: OFF';
    if (touchPref) {
      $('hintBar').textContent = 'LEFT STICK move/jetpack \u00b7 RIGHT STICK aim + fire \u00b7 \uD83D\uDCA3 grenade \u00b7 \u27F3 reload \u00b7 \u23F8 pause \u00b7 \u26F6 fullscreen';
    } else {
      $('hintBar').textContent = 'A/D move \u00b7 W jetpack \u00b7 S fast-fall \u00b7 ARROWS aim \u00b7 SPACE/J or CLICK shoot \u00b7 K grenade \u00b7 R reload \u00b7 TAB scores \u00b7 P pause \u00b7 M mute';
    }
  }

  function setupTouchControls() {
    const t = Input.touch;

    function stick(elId, knobId, onMove, onEnd) {
      const el = $(elId), knob = $(knobId);
      let pid = null;
      function vec(e) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let dx = e.clientX - cx, dy = e.clientY - cy;
        const R = r.width / 2;
        const len = Math.hypot(dx, dy) || 1;
        const n = Math.min(1, len / (R * 0.75));
        dx = (dx / len) * n; dy = (dy / len) * n;
        knob.style.transform = 'translate(' + (dx * R * 0.55) + 'px,' + (dy * R * 0.55) + 'px)';
        onMove(dx, dy, n);
      }
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (pid !== null) return;
        pid = e.pointerId;
        try { el.setPointerCapture(pid); } catch (err) { }
        AudioSys.ensure();
        vec(e);
      });
      el.addEventListener('pointermove', e => {
        if (e.pointerId !== pid) return;
        e.preventDefault();
        vec(e);
      });
      const end = e => {
        if (e.pointerId !== pid) return;
        pid = null;
        knob.style.transform = 'translate(0,0)';
        onEnd();
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }

    // left stick: dx -> A/D, up -> W (jetpack), down -> S (fast fall)
    stick('stickL', 'knobL',
      (dx, dy) => {
        t.mx = dx; t.my = dy;
        Input.setVirtual('KeyA', dx < -0.3);
        Input.setVirtual('KeyD', dx > 0.3);
        Input.setVirtual('KeyW', dy < -0.38);
        Input.setVirtual('KeyS', dy > 0.55);
      },
      () => {
        t.mx = 0; t.my = 0;
        ['KeyA', 'KeyD', 'KeyW', 'KeyS'].forEach(c => Input.setVirtual(c, false));
      }
    );

    // right stick: aim direction; pushed = fire (Space), like Mini Militia
    stick('stickR', 'knobR',
      (dx, dy, n) => {
        const aiming = n > 0.28;
        if (aiming) { t.ax = dx; t.ay = dy; }
        if (aiming !== t.aiming) { t.ax = dx; t.ay = dy; Input.setVirtual('Space', aiming); }
        t.aiming = aiming;
      },
      () => {
        t.aiming = false;
        t.ax = 0; t.ay = 0;
        Input.setVirtual('Space', false);
      }
    );

    function button(elId, code, holdable) {
      const el = $(elId);
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        AudioSys.ensure();
        Input.setVirtual(code, true);
        if (!holdable) setTimeout(() => Input.setVirtual(code, false), 120);
      });
      const up = () => { if (holdable) Input.setVirtual(code, false); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    }
    button('btnNade', 'KeyK', false);   // tap = throw
    button('btnReload', 'KeyR', false); // tap = reload
    button('btnPause', 'KeyP', false);  // tap = pause/resume

    $('btnFull').addEventListener('pointerdown', e => {
      e.preventDefault();
      try {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().then(() => {
            try { screen.orientation.lock('landscape').catch(() => { }); } catch (err) { }
          }).catch(() => { });
        } else document.exitFullscreen();
      } catch (err) { }
    });

    $('touchToggle').addEventListener('click', () => {
      AudioSys.ensure(); AudioSys.click();
      touchPref = !touchPref;
      applyTouchMode();
      fit();
    });

    // unlock audio on touch, and show controls if a touch happens even without auto-detect
    window.addEventListener('touchstart', () => AudioSys.ensure(), { passive: true });
    window.addEventListener('touchend', () => AudioSys.ensure(), { passive: true });
  }

  fit();
  Input.init(canvas);
  applyTouchMode();
  setupTouchControls();
  requestAnimationFrame(frameLoop);
})();
