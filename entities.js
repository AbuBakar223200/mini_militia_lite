'use strict';
// Physics, characters (player + bots), bullets, grenades, pickups.
// Reads/writes the global G namespace defined in game.js.

const GRAV = 0.42, MAX_FALL = 10.5, FAST_FALL = 13, JET_UP_MAX = -7.6;
const MOVE_MAX = 4.3, MOVE_ACC = 0.55, AIR_ACC = 0.42;
const JET_CONSUME = 0.5, JET_REGEN = 0.42, JET_REGEN_GROUND = 0.9;

const WEAPONS = {
  rifle:   { name: 'Rifle',   short: 'RIF', dmg: 12, rof: 8,  speed: 15, spread: 0.05,  ammo: 30, auto: true,  pellets: 1, kick: 0.4,  reload: 66,  color: '#ffe08a' },
  uzi:     { name: 'UZI',     short: 'UZI', dmg: 7,  rof: 4,  speed: 14, spread: 0.14,  ammo: 42, auto: true,  pellets: 1, kick: 0.22, reload: 60,  color: '#ff9e80' },
  shotgun: { name: 'Shotgun', short: 'SG',  dmg: 8,  rof: 26, speed: 13, spread: 0.2,   ammo: 8,  auto: false, pellets: 6, kick: 1.8,  reload: 96,  color: '#80d8ff' },
  sniper:  { name: 'Sniper',  short: 'SN',  dmg: 40, rof: 38, speed: 24, spread: 0.006, ammo: 6,  auto: false, pellets: 1, kick: 1.4,  reload: 90,  color: '#ea80fc' },
};

const BOT_DIFFS = {
  easy:   { err: 0.26,  react: 46, burst: [10, 26], pause: [30, 60], speed: 0.85, count: 3 },
  normal: { err: 0.13,  react: 26, burst: [16, 40], pause: [20, 45], speed: 0.95, count: 4 },
  hard:   { err: 0.055, react: 12, burst: [24, 55], pause: [12, 30], speed: 1.05, count: 5 },
};

// ---------- small helpers ----------
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function ptInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- physics ----------
function moveBody(b) {
  // horizontal
  b.x += b.vx;
  for (const r of SOLIDS) {
    if (rectsOverlap(b.x, b.y, b.w, b.h, r.x, r.y, r.w, r.h)) {
      if (b.vx > 0) b.x = r.x - b.w;
      else if (b.vx < 0) b.x = r.x + r.w;
      b.vx = 0;
    }
  }
  if (b.x < 0) { b.x = 0; if (b.vx < 0) b.vx = 0; }
  if (b.x + b.w > WORLD.w) { b.x = WORLD.w - b.w; if (b.vx > 0) b.vx = 0; }

  // vertical
  const prevBottom = b.y + b.h;
  b.y += b.vy;
  b.onGround = false;
  for (const r of SOLIDS) {
    if (rectsOverlap(b.x, b.y, b.w, b.h, r.x, r.y, r.w, r.h)) {
      if (b.vy > 0) { b.y = r.y - b.h; b.vy = 0; b.onGround = true; }
      else if (b.vy < 0) { b.y = r.y + r.h; b.vy = 0; }
    }
  }
  for (const r of ONEWAYS) {
    if (b.vy > 0 && prevBottom <= r.y + 1 && rectsOverlap(b.x, b.y, b.w, b.h, r.x, r.y, r.w, r.h)) {
      b.y = r.y - b.h; b.vy = 0; b.onGround = true;
    }
  }
  if (b.y < 0) { b.y = 0; if (b.vy < 0) b.vy = 0; }
  if (b.y + b.h > WORLD.h) { b.y = WORLD.h - b.h; b.vy = 0; b.onGround = true; }
}

// ---------- bullets ----------
class Bullet {
  constructor(x, y, vx, vy, weapon, owner) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.dmg = weapon.dmg; this.owner = owner; this.color = weapon.color;
    this.speed = Math.hypot(vx, vy);
    this.len = weapon === WEAPONS.sniper ? 26 : 14;
    this.life = 70; this.dead = false;
  }
  update() {
    const steps = Math.max(1, Math.ceil(this.speed / 6));
    const sx = this.vx / steps, sy = this.vy / steps;
    for (let i = 0; i < steps && !this.dead; i++) {
      this.x += sx; this.y += sy;
      for (const r of SOLIDS) {
        if (ptInRect(this.x, this.y, r)) {
          this.dead = true;
          G.sparks(this.x, this.y, 4, this.color);
          return;
        }
      }
      for (const b of G.bodies) {
        if (b === this.owner || !b.alive || b.invulnT > 0) continue;
        if (this.x > b.x - 3 && this.x < b.x + b.w + 3 && this.y > b.y - 3 && this.y < b.y + b.h + 3) {
          this.dead = true;
          b.takeDamage(this.dmg, this.owner, Math.atan2(this.vy, this.vx));
          G.sparks(this.x, this.y, 6, '#ff6b6b');
          return;
        }
      }
    }
    this.life--;
    if (this.life <= 0 || this.x < -60 || this.x > WORLD.w + 60 || this.y < -60 || this.y > WORLD.h + 60) this.dead = true;
  }
  draw(ctx) {
    const n = this.speed || 1;
    const dx = this.vx / n, dy = this.vy / n;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - dx * this.len, this.y - dy * this.len);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ---------- grenades ----------
class Grenade {
  constructor(x, y, vx, vy, owner) {
    this.x = x; this.y = y; this.w = 10; this.h = 10;
    this.vx = vx; this.vy = vy; this.owner = owner;
    this.fuse = 95; this.dead = false;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  update() {
    this.vy += 0.3;
    this.vx *= 0.995;
    // horizontal
    this.x += this.vx;
    for (const r of SOLIDS) {
      if (rectsOverlap(this.x, this.y, this.w, this.h, r.x, r.y, r.w, r.h)) {
        if (this.vx > 0) this.x = r.x - this.w; else this.x = r.x + r.w;
        this.vx *= -0.5;
      }
    }
    if (this.x < 0) { this.x = 0; this.vx *= -0.5; }
    if (this.x + this.w > WORLD.w) { this.x = WORLD.w - this.w; this.vx *= -0.5; }
    // vertical
    const prevBottom = this.y + this.h;
    this.y += this.vy;
    for (const r of SOLIDS) {
      if (rectsOverlap(this.x, this.y, this.w, this.h, r.x, r.y, r.w, r.h)) {
        if (this.vy > 0) { this.y = r.y - this.h; this.vy *= -0.45; if (Math.abs(this.vy) < 1.3) this.vy = 0; this.vx *= 0.85; }
        else { this.y = r.y + r.h; this.vy *= -0.45; }
      }
    }
    for (const r of ONEWAYS) {
      if (this.vy > 0 && prevBottom <= r.y + 1 && rectsOverlap(this.x, this.y, this.w, this.h, r.x, r.y, r.w, r.h)) {
        this.y = r.y - this.h; this.vy *= -0.45; if (Math.abs(this.vy) < 1.3) this.vy = 0; this.vx *= 0.85;
      }
    }
    if (this.y < 0) { this.y = 0; this.vy *= -0.5; }
    if (this.y + this.h > WORLD.h) { this.y = WORLD.h - this.h; this.vy *= -0.45; if (Math.abs(this.vy) < 1.3) this.vy = 0; }

    this.fuse--;
    if (this.fuse <= 0) {
      this.dead = true;
      G.explode(this.cx, this.cy, 95, 58, this.owner);
    }
  }
  draw(ctx) {
    const blink = this.fuse < 30 && (Math.floor(this.fuse / 4) % 2 === 0);
    ctx.fillStyle = blink ? '#ff5252' : '#33691e';
    ctx.beginPath(); ctx.arc(this.cx, this.cy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#827717';
    ctx.fillRect(this.cx - 1, this.cy - 9, 2, 4);
  }
}

// ---------- pickups ----------
const PICKUP_STYLE = {
  weapon:  p => ({ color: WEAPONS[p.wname].color, label: WEAPONS[p.wname].short, fs: 11 }),
  health:  () => ({ color: '#66bb6a', label: '+', fs: 20 }),
  grenade: () => ({ color: '#ffca28', label: '\u2726', fs: 15 }),
  fuel:    () => ({ color: '#42a5f5', label: '\u25b2', fs: 13 }),
};

class Pickup {
  constructor(x, y, type, wname, temp) {
    this.x = x; this.y = y; this.type = type; this.wname = wname || null;
    this.temp = !!temp;
    this.active = true; this.respawnT = 0;
    this.despawnT = temp ? 600 : 0;
    this.seed = Math.random() * Math.PI * 2;
  }
  style() { return PICKUP_STYLE[this.type](this); }
  apply(b) {
    if (this.type === 'weapon') {
      const w = WEAPONS[this.wname];
      if (b.weapon === this.wname && b.ammo >= w.ammo && !b.reloading) return false;
      b.weapon = this.wname; b.ammo = w.ammo; b.reloading = false;
      return true;
    }
    if (this.type === 'health') { if (b.hp >= 100) return false; b.hp = Math.min(100, b.hp + 50); return true; }
    if (this.type === 'grenade') { if (b.grenades >= 6) return false; b.grenades = Math.min(6, b.grenades + 2); return true; }
    if (this.type === 'fuel') { if (b.fuel >= 99) return false; b.fuel = 100; return true; }
    return false;
  }
  floatLabel() {
    if (this.type === 'health') return '+50 HP';
    if (this.type === 'grenade') return '+2 NADES';
    if (this.type === 'fuel') return 'FUEL FULL';
    return WEAPONS[this.wname].name.toUpperCase();
  }
  update(frame) {
    if (!this.active) {
      this.respawnT--;
      if (this.respawnT <= 0) this.active = true;
      return;
    }
    if (this.temp) { this.despawnT--; if (this.despawnT <= 0) { this.dead = true; return; } }
    const bobY = this.y + Math.sin(frame * 0.05 + this.seed) * 3;
    for (const b of G.bodies) {
      if (!b.alive) continue;
      if (rectsOverlap(b.x, b.y, b.w, b.h, this.x - 16, bobY - 16, 32, 32)) {
        if (this.apply(b)) {
          this.active = false;
          this.respawnT = this.type === 'health' ? 720 : 900;
          G.floatText(b.cx, b.y - 24, this.floatLabel(), this.style().color);
          AudioSys.pickup();
          G.events.push({ t: 'p', x: b.cx, y: b.y - 24, lb: this.floatLabel() });
          break;
        }
      }
    }
  }
  draw(ctx, frame) {
    if (!this.active) return;
    const y = this.y + Math.sin(frame * 0.05 + this.seed) * 3;
    const st = this.style();
    let alpha = 1;
    if (this.temp && this.despawnT < 120) alpha = 0.4 + 0.4 * Math.sin(this.despawnT * 0.4);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x, y);
    ctx.fillStyle = st.color;
    ctx.globalAlpha = alpha * 0.18;
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha;
    roundRect(ctx, -14, -14, 28, 28, 7);
    ctx.fillStyle = 'rgba(12,20,34,.85)';
    ctx.fill();
    ctx.strokeStyle = st.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = st.color;
    ctx.font = 'bold ' + st.fs + 'px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.label, 0, 1);
    ctx.restore();
  }
}

// ---------- characters ----------
function emptyCmd() {
  return { left: false, right: false, jet: false, drop: false, shootEdge: false, shootHeld: false, grenEdge: false, reloadEdge: false, facing: 0 };
}

class Character {
  constructor(x, y, name, color, isPlayer) {
    this.x = x; this.y = y; this.w = 26; this.h = 34;
    this.vx = 0; this.vy = 0; this.onGround = false;
    this.name = name;
    this.disp = isPlayer ? 'You' : name;
    this.color = color; this.isPlayer = isPlayer;
    this.hp = 100; this.fuel = 100;
    this.weapon = 'rifle'; this.ammo = WEAPONS.rifle.ammo;
    this.cooldown = 0; this.reloading = false; this.reloadT = 0;
    this.grenades = 2; this.grenadeCd = 0;
    this.aimAngle = 0; this.facing = 1;
    this.alive = true; this.score = 0; this.deaths = 0; this.respawnT = 0;
    this.invulnT = 90; this.lastHurt = 999;
    this.jetting = false; this.wasJetting = false; this.flashT = 0; this.walk = 0;
    this.speedMul = 1;
    this.id = 0;
    this.cmd = emptyCmd();
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  startReload() {
    const w = WEAPONS[this.weapon];
    if (this.reloading || this.ammo === w.ammo) return;
    this.reloading = true;
    this.reloadT = w.reload;
    if (this.isPlayer) AudioSys.reload();
  }

  tryFire() {
    const w = WEAPONS[this.weapon];
    if (this.cooldown > 0 || this.reloading) return;
    if (this.ammo <= 0) { this.startReload(); return; }
    this.cooldown = w.rof;
    this.ammo--;
    this.flashT = 3;
    const a = this.aimAngle;
    const mx = this.cx + Math.cos(a) * 26, my = this.cy - 3 + Math.sin(a) * 26;
    for (let i = 0; i < w.pellets; i++) {
      const sa = a + (Math.random() - 0.5) * w.spread * 2;
      const sp = w.speed * (0.92 + Math.random() * 0.16);
      G.bullets.push(new Bullet(mx, my, Math.cos(sa) * sp + this.vx * 0.3, Math.sin(sa) * sp + this.vy * 0.3, w, this));
    }
    this.vx -= Math.cos(a) * w.kick;
    this.vy -= Math.sin(a) * w.kick * 0.4;
    G.sparks(mx, my, 3, '#ffd54f');
    G.events.push({ t: 's', x: Math.round(mx), y: Math.round(my), w: this.weapon });
    if (this.isPlayer) { AudioSys.shoot(this.weapon); G.addShake(0.5 + w.kick * 0.5); }
    if (this.ammo <= 0) this.startReload();
  }

  throwGrenade() {
    if (this.grenades <= 0 || this.grenadeCd > 0) return;
    this.grenades--;
    this.grenadeCd = 32;
    const a = this.aimAngle;
    G.grenades.push(new Grenade(
      this.cx + Math.cos(a) * 20, this.cy - 6 + Math.sin(a) * 20,
      Math.cos(a) * 8 + this.vx * 0.4, Math.sin(a) * 8 - 1.5 + this.vy * 0.4, this
    ));
    if (this.isPlayer) AudioSys.throwNade();
  }

  takeDamage(amount, attacker, angle) {
    if (!this.alive || this.invulnT > 0) return;
    this.hp -= amount;
    this.lastHurt = 0;
    if (angle !== undefined) { this.vx += Math.cos(angle) * 0.6; this.vy += Math.sin(angle) * 0.4; }
    if (this.isPlayer) { G.addShake(2.2); AudioSys.hurt(); } else AudioSys.hit();
    if (this.hp <= 0) this.die(attacker);
  }

  die(attacker) {
    this.alive = false;
    this.deaths++;
    this.respawnT = this.isPlayer ? 130 : 160;
    this.jetting = false; this.wasJetting = false;
    G.burst(this.cx, this.cy, 26, this.color, 4.5, 50, 0.12, 3);
    G.addShake(6);
    AudioSys.death();
    if (this.weapon !== 'rifle') G.dropWeapon(this.cx, this.cy, this.weapon);
    const nm = c => '<span style="color:' + c.color + ';font-weight:700">' + c.disp + '</span>';
    if (attacker && attacker !== this) {
      attacker.score++;
      G.addFeed(nm(attacker) + ' \uD83D\uDD2D ' + nm(this));
      G.floatText(this.cx, this.cy - 26, '+1', attacker.color);
      G.events.push({ t: 'k', an: attacker.disp, ac: attacker.color, vn: this.disp, vc: this.color });
    } else {
      this.score = Math.max(0, this.score - 1);
      G.addFeed(nm(this) + ' \uD83D\uDC80 ' + (attacker === this ? 'fragged themselves' : 'died'));
      G.events.push({ t: 'k', an: '', ac: '', vn: this.disp, vc: this.color, self: true });
    }
    G.checkWin();
  }

  respawn() {
    let best = SPAWNS[0], bd = -1;
    for (const s of SPAWNS) {
      let md = 1e18;
      for (const b of G.bodies) {
        if (b !== this && b.alive) md = Math.min(md, dist2(s.x, s.y, b.x, b.y));
      }
      if (md > bd) { bd = md; best = s; }
    }
    this.x = best.x; this.y = best.y;
    this.vx = 0; this.vy = 0;
    this.hp = 100; this.fuel = 100;
    this.alive = true; this.invulnT = 90; this.lastHurt = 999;
    this.weapon = 'rifle'; this.ammo = WEAPONS.rifle.ammo; this.reloading = false;
    this.grenades = 2; this.cooldown = 0; this.grenadeCd = 0;
    this.aimAngle = 0;
    G.burst(this.cx, this.cy, 14, '#ffffff', 2.5, 30, 0, 2.5);
    G.events.push({ t: 'sp', x: this.cx, y: this.cy });
  }

  updateFromCmd() {
    const c = this.cmd;
    if (!this.alive) {
      this.respawnT--;
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    this.invulnT--; this.lastHurt++; this.cooldown--; this.grenadeCd--; this.flashT--;
    // horizontal move
    const acc = this.onGround ? MOVE_ACC : AIR_ACC;
    const mx = MOVE_MAX * this.speedMul;
    if (c.left) this.vx = Math.max(this.vx - acc, -mx);
    else if (c.right) this.vx = Math.min(this.vx + acc, mx);
    else this.vx *= this.onGround ? 0.78 : 0.985;
    // vertical: gravity then jetpack
    this.vy = Math.min(this.vy + GRAV, c.drop ? FAST_FALL : MAX_FALL);
    this.jetting = false;
    if (c.jet && this.fuel > 0) {
      if (!this.wasJetting) this.vy -= 2.1;
      this.vy = Math.max(this.vy - 0.62, JET_UP_MAX);
      this.fuel = Math.max(0, this.fuel - JET_CONSUME);
      this.jetting = true;
      if (Math.random() < 0.55) G.jetSmoke(this.cx - this.facing * 9, this.cy + 4, this.facing);
    } else {
      this.fuel = Math.min(100, this.fuel + (this.onGround ? JET_REGEN_GROUND : JET_REGEN));
    }
    this.wasJetting = this.jetting;
    moveBody(this);
    this.walk += Math.abs(this.vx) * 0.09;
    if (c.facing) this.facing = c.facing;
    // reload / shoot / grenade
    if (this.reloading) {
      this.reloadT--;
      if (this.reloadT <= 0) { this.reloading = false; this.ammo = WEAPONS[this.weapon].ammo; }
    }
    if (c.shootEdge || (c.shootHeld && (WEAPONS[this.weapon].auto || !this.isPlayer))) this.tryFire();
    if (c.grenEdge) this.throwGrenade();
    if (c.reloadEdge) this.startReload();
    // slow regen when out of combat
    if (this.lastHurt > 300 && this.hp < 100) this.hp = Math.min(100, this.hp + 0.05);
  }

  draw(ctx) {
    if (!this.alive) return;
    const cx = this.cx, cy = this.cy;
    ctx.save();
    if (this.invulnT > 0) ctx.globalAlpha = 0.55 + 0.3 * Math.sin(this.invulnT * 0.5);

    // jet flame
    if (this.jetting) {
      const jx = cx - this.facing * 7;
      const fl = 10 + Math.random() * 8;
      ctx.fillStyle = '#ffb300';
      ctx.beginPath();
      ctx.moveTo(jx - 3, cy + 7); ctx.lineTo(jx + 3, cy + 7); ctx.lineTo(jx, cy + 7 + fl);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffe082';
      ctx.beginPath();
      ctx.moveTo(jx - 1.5, cy + 7); ctx.lineTo(jx + 1.5, cy + 7); ctx.lineTo(jx, cy + 7 + fl * 0.55);
      ctx.closePath(); ctx.fill();
    }
    // legs
    ctx.fillStyle = '#3b4652';
    ctx.fillRect(cx - 7, this.y + this.h - 8, 5, 8);
    ctx.fillRect(cx + 2, this.y + this.h - 8, 5, 8);
    // jetpack tank (behind torso)
    ctx.fillStyle = '#546e7a';
    ctx.fillRect(cx - this.facing * 13 - 3, cy - 8, 7, 16);
    // torso
    ctx.fillStyle = this.color;
    roundRect(ctx, cx - 10, cy - 8, 20, 18, 5);
    ctx.fill();
    // head + helmet + eye
    ctx.fillStyle = '#ffd9b0';
    ctx.beginPath(); ctx.arc(cx, cy - 14, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(cx, cy - 15, 8.6, Math.PI, 0); ctx.fill();
    ctx.fillRect(cx - 8.6, cy - 16, 17.2, 2.4);
    ctx.fillStyle = '#263238';
    ctx.beginPath(); ctx.arc(cx + this.facing * 4, cy - 12.5, 1.8, 0, Math.PI * 2); ctx.fill();
    // gun
    ctx.save();
    ctx.translate(cx, cy - 3);
    ctx.rotate(this.aimAngle);
    ctx.fillStyle = '#263238';
    ctx.fillRect(6, -3, 20, 6);
    ctx.fillStyle = '#455a64';
    ctx.fillRect(6, -3, 8, 6);
    if (this.flashT > 0) {
      ctx.fillStyle = '#fff59d';
      ctx.beginPath(); ctx.arc(28, 0, 5 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // health bar + name
    const bw = 34;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(cx - bw / 2, this.y - 16, bw, 5);
    const hpf = clamp(this.hp, 0, 100) / 100;
    ctx.fillStyle = hpf > 0.5 ? '#66bb6a' : hpf > 0.25 ? '#ffa726' : '#ef5350';
    ctx.fillRect(cx - bw / 2 + 1, this.y - 15, (bw - 2) * hpf, 3);
    if (!this.isPlayer) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 11px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(this.name, cx, this.y - 20);
    }
    ctx.restore();
  }
}

// ---------- bots ----------
class Bot extends Character {
  constructor(x, y, name, color, diff) {
    super(x, y, name, color, false);
    this.diff = diff;
    this.speedMul = diff.speed;
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 60 + Math.random() * 90;
    this.seed = Math.random() * 1000;
    this.target = null;
    this.canSeeNow = false;
    this.burstLeft = 0; this.pauseLeft = 0; this.reactionT = 30;
    this.lastX = x;
    this.grenadeT = 300 + Math.random() * 400;
    this.weapon = this.pickWeapon();
    this.ammo = WEAPONS[this.weapon].ammo;
  }
  pickWeapon() {
    const r = Math.random();
    return r < 0.4 ? 'rifle' : r < 0.7 ? 'uzi' : r < 0.92 ? 'shotgun' : 'sniper';
  }
  lineOfSight(t) {
    const x1 = this.cx, y1 = this.cy, x2 = t.cx, y2 = t.cy;
    const d = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.ceil(d / 26);
    for (let i = 1; i < n; i++) {
      const px = x1 + (x2 - x1) * i / n, py = y1 + (y2 - y1) * i / n;
      for (const r of SOLIDS) if (ptInRect(px, py, r)) return false;
    }
    return true;
  }
  think() {
    const c = this.cmd;
    c.left = c.right = c.jet = c.drop = false;
    c.shootEdge = c.shootHeld = c.grenEdge = c.reloadEdge = false;
    // pick target
    if (!this.target || !this.target.alive || G.frame % 10 === 0) {
      let best = null, bd = 1e18;
      for (const b of G.bodies) {
        if (b === this || !b.alive) continue;
        const d = dist2(this.cx, this.cy, b.cx, b.cy);
        if (d < bd) { bd = d; best = b; }
      }
      if (best !== this.target) {
        this.target = best;
        this.reactionT = this.diff.react * (0.7 + Math.random() * 0.7);
        this.burstLeft = 0;
      }
    }
    if (!this.target) return;
    const t = this.target;
    const dx = t.cx - this.cx, dy = t.cy - this.cy;
    const d = Math.hypot(dx, dy) || 1;

    if (G.frame % 6 === 0) this.canSeeNow = this.lineOfSight(t);
    if (this.canSeeNow && this.reactionT > 0) this.reactionT--;

    // horizontal: keep preferred standoff distance, strafe back and forth
    this.strafeT--;
    if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 60 + Math.random() * 110; }
    const standoff = { rifle: 260, uzi: 210, shotgun: 150, sniper: 430 }[this.weapon];
    const desiredX = t.cx + this.strafe * standoff * (0.7 + 0.3 * Math.sin(this.seed + G.frame * 0.01));
    if (desiredX < this.cx - 16) c.left = true;
    else if (desiredX > this.cx + 16) c.right = true;
    if (this.x <= 2 && c.left) this.strafe = 1;
    if (this.x + this.w >= WORLD.w - 2 && c.right) this.strafe = -1;

    // vertical: hover slightly above target height
    const desiredY = t.cy - 40 + Math.sin(G.frame * 0.025 + this.seed) * 50;
    if (this.cy > desiredY + 22) c.jet = true;
    else if (this.cy < desiredY - 30) c.drop = true;

    // aim with lead + error
    const tt = d / WEAPONS[this.weapon].speed;
    const px = t.cx + t.vx * tt * 0.6, py = t.cy + t.vy * tt * 0.6;
    let ang = Math.atan2(py - this.cy, px - this.cx);
    ang += (Math.random() - 0.5) * 2 * this.diff.err * (0.4 + d / 650);
    this.aimAngle = ang;
    c.facing = Math.cos(ang) >= 0 ? 1 : -1;

    // burst fire
    if (this.canSeeNow && d < 640 && this.reactionT <= 0 && t.invulnT <= 0) {
      if (this.burstLeft > 0) { c.shootHeld = true; this.burstLeft--; }
      else if (this.pauseLeft > 0) this.pauseLeft--;
      else {
        this.burstLeft = this.diff.burst[0] + Math.random() * (this.diff.burst[1] - this.diff.burst[0]);
        this.pauseLeft = this.diff.pause[0] + Math.random() * (this.diff.pause[1] - this.diff.pause[0]);
      }
    } else this.burstLeft = 0;

    // occasional grenade
    this.grenadeT--;
    if (this.grenadeT <= 0 && d > 140 && d < 380 && this.grenades > 0 && this.canSeeNow) {
      c.grenEdge = true;
      this.grenadeT = 400 + Math.random() * 400;
      this.aimAngle = Math.atan2(dy - d * 0.35, dx);
    }

    // unstick: if trying to move but not progressing, hop and flip
    if (G.frame % 75 === 0) {
      if (Math.abs(this.cx - this.lastX) < 7 && (c.left || c.right || d > 150)) {
        c.jet = true;
        this.strafe *= -1;
        this.vy -= 2.5;
      }
      this.lastX = this.cx;
    }
  }
}
