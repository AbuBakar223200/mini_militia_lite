'use strict';
// Multiplayer over WebRTC data channels (PeerJS public broker).
// Host-authoritative: host runs the simulation, clients send inputs and render snapshots.
const Net = (function () {
  const WEAPON_ORDER = ['rifle', 'uzi', 'shotgun', 'sniper'];
  const TYPE_ORDER = ['weapon', 'health', 'grenade', 'fuel'];
  const COLORS = ['#42a5f5', '#ff5252', '#ffa726', '#ab47bc', '#66bb6a', '#ec407a', '#26c6da', '#9ccc65'];
  const PREFIX = 'mml-lite-';
  const SNAP_MS = 50;   // host sends a snapshot every 50ms (~20Hz)
  const INPUT_MS = 33;  // client sends input every 33ms (~30Hz)

  let peer = null;
  let mode = 'off'; // off | hosting | host | joining | client
  let code = '';
  let conns = [];   // host: client entries
  let nextId = 1;
  let hostConn = null;
  let myId = 0, myName = '', myColor = COLORS[0];
  let snapA = null, snapB = null, snapBAt = 0;
  let pendingEv = [];
  let myInput = { l: 0, r: 0, j: 0, d: 0, s: 0, a: 0, f: 1, cs: 0, cg: 0, cr: 0 };
  let sentAt = 0;
  let roster = []; // [{id,name,color}]
  let currentView = null;
  let retries = 0;
  let ui = {}; // callbacks provided by game.js

  function esc(s) { return String(s || '').replace(/[<>&"]/g, '').slice(0, 12); }
  function makeCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let c = '';
    for (let i = 0; i < 5; i++) c += chars[(Math.random() * chars.length) | 0];
    return c;
  }
  function errText(e) {
    if (e && e.type === 'peer-unavailable') return 'Room not found. Check the code.';
    if (e && e.type === 'unavailable-id') return 'Could not create room, try again.';
    if (e && e.type === 'network') return 'Cannot reach the matchmaking service. Are you online?';
    return 'Connection error: ' + (e && e.type ? e.type : e);
  }

  // ---------------- HOST ----------------
  function host(name, callbacks) {
    ui = callbacks;
    myName = esc(name) || 'Host';
    myColor = COLORS[0];
    myId = 0;
    roster = [{ id: 0, name: myName, color: myColor }];
    mode = 'hosting';
    conns = [];
    nextId = 1;
    createPeer();
  }

  function createPeer() {
    code = makeCode();
    peer = new Peer(PREFIX + code, { debug: 0 });
    peer.on('open', () => { mode = 'host'; ui.onHostReady(code, roster); });
    peer.on('connection', conn => {
      conn.on('data', d => onDataHost(conn, d));
      conn.on('close', () => dropClient(conn));
      conn.on('error', () => dropClient(conn));
    });
    peer.on('error', err => {
      if (err.type === 'unavailable-id' && mode === 'hosting' && retries < 3) {
        retries++;
        peer.destroy();
        createPeer();
        return;
      }
      ui.onError(errText(err));
      reset();
    });
  }

  function onDataHost(conn, d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hi') {
      let entry = conns.find(c => c.conn === conn);
      if (!entry) {
        if (conns.length >= 7) { conn.close(); return; }
        entry = {
          conn, id: nextId++, name: esc(d.name) || ('P' + nextId),
          color: COLORS[nextId % COLORS.length],
          input: { l: 0, r: 0, j: 0, d: 0, s: 0, a: 0, f: 1, cs: 0, cg: 0, cr: 0 },
          lastCs: 0, lastCg: 0, lastCr: 0, body: null, lastInAt: 0,
        };
        conns.push(entry);
        conn.send({ t: 'wc', id: entry.id, color: entry.color });
        roster.push({ id: entry.id, name: entry.name, color: entry.color });
        ui.onRosterChange(entry.id, entry.name, 'join');
      }
      broadcastRoster();
      sendLobby();
      return;
    }
    const entry = conns.find(c => c.conn === conn);
    if (!entry) return;
    if (d.t === 'in') {
      entry.input = d;
      entry.lastInAt = performance.now();
    } else if (d.t === 'rr') {
      ui.onRestartRequest();
    }
  }

  function dropClient(conn) {
    const i = conns.findIndex(c => c.conn === conn);
    if (i === -1) return;
    const entry = conns[i];
    conns.splice(i, 1);
    roster = roster.filter(r => r.id !== entry.id);
    ui.onRosterChange(entry.id, entry.name, 'leave');
    ui.onClientLeft(entry);
    broadcastRoster();
  }

  function broadcastRoster() {
    if (mode !== 'host') return;
    const msg = { t: 'ro', r: roster };
    for (const c of conns) { try { c.conn.send(msg); } catch (e) { } }
  }

  function sendLobby() {
    if (mode !== 'host') return;
    const msg = { t: 'lb', p: roster.map(r => r.name), bots: ui.getBots() };
    for (const c of conns) { try { c.conn.send(msg); } catch (e) { } }
  }

  function broadcastGo() {
    const msg = { t: 'go' };
    for (const c of conns) { try { c.conn.send(msg); } catch (e) { } }
  }

  function broadcastEvent(ev) {
    const msg = { t: 'ev', e: [ev] };
    for (const c of conns) { try { c.conn.send(msg); } catch (e) { } }
  }

  // called every frame by game.js while hosting a match
  function hostTick() {
    if (mode !== 'host') return;
    const now = performance.now();
    if (now - sentAt < SNAP_MS) return;
    sentAt = now;
    const snap = {
      t: 'sn',
      mt: ui.getMatchT(),
      b: G.bodies.map(b => [b.id, Math.round(b.x), Math.round(b.y),
        Math.round(b.vx * 100) / 100, Math.round(b.vy * 100) / 100,
        Math.round(b.aimAngle * 1000) / 1000, b.facing,
        Math.round(b.hp), Math.round(b.fuel),
        WEAPON_ORDER.indexOf(b.weapon), b.ammo,
        b.reloading ? 1 : 0, b.grenades,
        b.alive ? 1 : 0, b.score, b.deaths,
        b.jetting ? 1 : 0, b.flashT > 0 ? 1 : 0, b.invulnT > 0 ? 1 : 0,
        Math.round(b.walk * 100) / 100, Math.max(0, b.respawnT)]),
      bl: G.bullets.map(b => [Math.round(b.x), Math.round(b.y),
        Math.round(b.vx * 100) / 100, Math.round(b.vy * 100) / 100, b.owner.id]),
      gr: G.grenades.map(g => [Math.round(g.x), Math.round(g.y),
        Math.round(g.vx * 100) / 100, Math.round(g.vy * 100) / 100, g.fuse]),
      pk: G.pickups.map(p => [Math.round(p.x), Math.round(p.y),
        TYPE_ORDER.indexOf(p.type), p.wname ? WEAPON_ORDER.indexOf(p.wname) : -1,
        p.active ? 1 : 0, p.temp ? 1 : 0]),
      e: G.events.splice(0, G.events.length),
    };
    const msg = snap;
    for (const c of conns) { try { c.conn.send(msg); } catch (e) { } }
  }

  // fill remote bodies' command from latest input message
  function applyInputs() {
    if (mode !== 'host') return;
    const now = performance.now();
    for (const c of conns) {
      const b = c.body;
      if (!b) continue;
      // if a client stops sending (lag/crash), stop applying its last inputs
      if (c.lastInAt && now - c.lastInAt > 1500) {
        b.cmd.left = b.cmd.right = b.cmd.jet = b.cmd.drop = false;
        b.cmd.shootHeld = b.cmd.shootEdge = b.cmd.grenEdge = b.cmd.reloadEdge = false;
        continue;
      }
      const i = c.input;
      b.cmd.left = !!i.l; b.cmd.right = !!i.r; b.cmd.jet = !!i.j; b.cmd.drop = !!i.d;
      b.cmd.shootHeld = !!i.s;
      b.cmd.shootEdge = i.cs > c.lastCs; c.lastCs = i.cs;
      b.cmd.grenEdge = i.cg > c.lastCg; c.lastCg = i.cg;
      b.cmd.reloadEdge = i.cr > c.lastCr; c.lastCr = i.cr;
      b.cmd.facing = i.f || 0;
      b.aimAngle = i.a || 0;
    }
  }

  function getEntry(id) { return conns.find(c => c.id === id); }

  // ---------------- CLIENT ----------------
  function join(codeIn, name, callbacks) {
    ui = callbacks;
    myName = esc(name) || 'Player';
    mode = 'joining';
    snapA = snapB = null; pendingEv = []; currentView = null;
    countersReset();
    peer = new Peer({ debug: 0 });
    peer.on('open', () => {
      hostConn = peer.connect(PREFIX + String(codeIn || '').trim().toLowerCase(), { reliable: true });
      hostConn.on('open', () => hostConn.send({ t: 'hi', name: myName }));
      hostConn.on('data', d => onDataClient(d));
      hostConn.on('close', () => { if (mode === 'client' || mode === 'joining') { ui.onDropped(); reset(); } });
    });
    peer.on('error', err => { ui.onError(errText(err)); reset(); });
  }

  function countersReset() { countersSend.s = 0; countersSend.g = 0; countersSend.r = 0; }
  const countersSend = { s: 0, g: 0, r: 0 };

  function onDataClient(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'wc') {
      myId = d.id; myColor = d.color;
      mode = 'client';
      ui.onJoined();
    } else if (d.t === 'lb') {
      ui.onLobby(d.p, d.bots);
    } else if (d.t === 'ro') {
      roster = d.r;
      const me = roster.find(r => r.id === myId);
      if (me) { myName = me.name; myColor = me.color; }
    } else if (d.t === 'go') {
      ui.onStart();
    } else if (d.t === 'sn') {
      snapA = snapB;
      snapB = d;
      snapBAt = performance.now();
      if (d.e && d.e.length) pendingEv.push(...d.e);
    } else if (d.t === 'ev') {
      if (d.e && d.e.length) pendingEv.push(...d.e);
    } else if (d.t === 'pa') {
      ui.onPause(d.on);
    }
  }

  function clientTick() {
    if (mode !== 'client') return;
    const now = performance.now();
    if (now - sentAt < INPUT_MS) return;
    sentAt = now;
    try { hostConn.send({ t: 'in', ...myInput }); } catch (e) { }
  }

  function requestRestart() {
    if (mode === 'client' && hostConn) { try { hostConn.send({ t: 'rr' }); } catch (e) { } }
  }

  // ---------------- client-side view (interpolated ghosts) ----------------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function updateView() {
    if (mode !== 'client' || !snapB) { currentView = null; return null; }
    const alpha = snapA ? Math.min(1, Math.max(0, (performance.now() - snapBAt) / SNAP_MS)) : 1;
    const A = snapA, B = snapB;
    const byIdA = {};
    if (A) for (const r of A.b) byIdA[r[0]] = r;

    const rosterMap = {};
    for (const r of roster) rosterMap[r.id] = r;

    const bodies = B.b.map(row => {
      const a = A ? byIdA[row[0]] : null;
      const g = Object.create(Character.prototype);
      g.id = row[0];
      g.x = a ? lerp(a[1], row[1], alpha) : row[1];
      g.y = a ? lerp(a[2], row[2], alpha) : row[2];
      g.w = 26; g.h = 34;
      g.vx = row[3]; g.vy = row[4];
      g.aimAngle = a ? lerpAngle(a[5], row[5], alpha) : row[5];
      g.facing = row[6];
      g.hp = row[7]; g.fuel = row[8];
      g.weapon = WEAPON_ORDER[row[9]] || 'rifle';
      g.ammo = row[10]; g.reloading = !!row[11]; g.grenades = row[12];
      g.alive = !!row[13]; g.score = row[14]; g.deaths = row[15];
      g.jetting = !!row[16]; g.flashT = row[17] ? 2 : 0;
      g.invulnT = row[18] ? 90 : 0;
      g.walk = a ? lerp(a[19], row[19], alpha) : row[19];
      g.respawnT = row[20];
      g.onGround = false; g.color = '#fff'; g.disp = 'P'; g.isPlayer = false;
      const r = rosterMap[row[0]];
      if (r) { g.color = r.color; g.name = r.name; g.disp = r.id === myId ? 'You' : r.name; }
      if (row[0] === myId) g.isPlayer = true;
      return g;
    });

    const weaponOf = {};
    for (const b of bodies) weaponOf[b.id] = b.weapon;

    const bullets = B.bl.map(row => {
      const g = Object.create(Bullet.prototype);
      g.x = row[0]; g.y = row[1]; g.vx = row[2]; g.vy = row[3];
      g.speed = Math.hypot(g.vx, g.vy) || 1;
      g.len = g.speed > 20 ? 26 : 14;
      g.color = (WEAPONS[weaponOf[row[4]]] || WEAPONS.rifle).color;
      g.owner = { id: row[4] };
      g.dead = false; g.dmg = 0; g.life = 1;
      return g;
    });

    const grenades = B.gr.map(row => {
      const g = Object.create(Grenade.prototype);
      g.x = row[0]; g.y = row[1]; g.vx = row[2]; g.vy = row[3];
      g.w = 10; g.h = 10; g.fuse = row[4]; g.dead = false;
      return g;
    });

    const pickups = B.pk.map(row => {
      const g = Object.create(Pickup.prototype);
      g.x = row[0]; g.y = row[1];
      g.type = TYPE_ORDER[row[2]] || 'health';
      g.wname = row[3] >= 0 ? WEAPON_ORDER[row[3]] : null;
      g.active = !!row[4];
      g.temp = !!row[5];
      g.seed = (row[0] * 0.37) % 6.28;
      g.despawnT = 600;
      return g;
    });

    const self = bodies.find(b => b.id === myId) || null;
    currentView = { bodies, bullets, grenades, pickups, self, matchT: B.mt };
    return currentView;
  }

  function drainEvents() {
    const evs = pendingEv.splice(0, pendingEv.length);
    return evs;
  }

  function rosterName(id) {
    const r = roster.find(x => x.id === id);
    return r ? r : { name: '???', color: '#fff' };
  }

  function reset() {
    mode = 'off';
    try { if (peer) peer.destroy(); } catch (e) { }
    peer = null; hostConn = null; conns = [];
    snapA = snapB = null; pendingEv = []; currentView = null;
  }

  function leave() { reset(); }

  return {
    host, join, leave,
    hostTick, applyInputs, broadcastGo, broadcastEvent, sendLobby,
    clientTick, clientSendInput: input => { myInput = input; },
    requestRestart,
    updateView, drainEvents, rosterName,
    get view() { return currentView; },
    get mode() { return mode; },
    get myId() { return myId; },
    get myName() { return myName; },
    get myColor() { return myColor; },
    get conns() { return conns; },
    get roomCode() { return code; },
  };
})();
