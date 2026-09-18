'use strict';
// World layout, spawn points and pickup spots.
const VIEW_W = 1600, VIEW_H = 900;
const WORLD = { w: 2400, h: 1400 };
const KILL_LIMIT = 15;

// solid:true blocks movement + bullets from all sides; others are one-way platforms.
const PLATFORMS = [
  { x: 0,    y: 1300, w: 2400, h: 120, solid: true },  // ground
  { x: 0,    y: 1030, w: 190,  h: 36,  solid: true },  // left ledge
  { x: 2210, y: 1030, w: 190,  h: 36,  solid: true },  // right ledge
  { x: 565,  y: 1110, w: 130,  h: 190, solid: true },  // pillar
  { x: 1705, y: 1130, w: 130,  h: 170, solid: true },  // pillar
  { x: 200,  y: 1090, w: 320, h: 16 },
  { x: 820,  y: 1000, w: 300, h: 16 },
  { x: 1330, y: 1080, w: 340, h: 16 },
  { x: 1940, y: 980,  w: 300, h: 16 },
  { x: 470,  y: 820,  w: 280, h: 16 },
  { x: 1120, y: 840,  w: 280, h: 16 },
  { x: 1700, y: 760,  w: 300, h: 16 },
  { x: 230,  y: 600,  w: 260, h: 16 },
  { x: 940,  y: 620,  w: 300, h: 16 },
  { x: 2080, y: 600,  w: 280, h: 16 },
  { x: 620,  y: 420,  w: 260, h: 16 },
  { x: 1500, y: 460,  w: 280, h: 16 },
  { x: 980,  y: 280,  w: 320, h: 16 },
  { x: 1860, y: 280,  w: 260, h: 16 },
  { x: 1150, y: 150,  w: 260, h: 16 },
];
const SOLIDS = PLATFORMS.filter(p => p.solid);
const ONEWAYS = PLATFORMS.filter(p => !p.solid);

// top-left body spawn positions
const SPAWNS = [
  { x: 80,   y: 1240 }, { x: 2300, y: 1240 }, { x: 330,  y: 1020 }, { x: 2060, y: 910 },
  { x: 940,  y: 1150 }, { x: 1450, y: 1010 }, { x: 600,  y: 750 },  { x: 1830, y: 690 },
  { x: 1050, y: 550 },  { x: 220,  y: 530 },  { x: 1250, y: 80 },   { x: 1950, y: 210 }
];

// center positions; types: weapon / health / grenade / fuel
const PICKUP_SPOTS = [
  { x: 980,  y: 1272, type: 'health' },
  { x: 2140, y: 1272, type: 'health' },
  { x: 95,   y: 1006, type: 'weapon', w: 'rifle' },
  { x: 970,  y: 976,  type: 'weapon', w: 'shotgun' },
  { x: 1850, y: 736,  type: 'weapon', w: 'uzi' },
  { x: 1140, y: 256,  type: 'weapon', w: 'sniper' },
  { x: 610,  y: 796,  type: 'health' },
  { x: 1090, y: 596,  type: 'grenade' },
  { x: 1990, y: 256,  type: 'grenade' },
  { x: 2300, y: 1006, type: 'grenade' },
  { x: 1500, y: 1056, type: 'fuel' },
  { x: 1640, y: 436,  type: 'fuel' },
];

const CLOUDS = [
  { x: 200,  y: 120, s: 1.2, v: 0.12 },
  { x: 700,  y: 80,  s: 0.9, v: 0.09 },
  { x: 1200, y: 160, s: 1.4, v: 0.11 },
  { x: 1700, y: 70,  s: 1.0, v: 0.13 },
  { x: 2100, y: 180, s: 1.1, v: 0.08 },
  { x: 500,  y: 260, s: 0.8, v: 0.10 },
  { x: 1600, y: 300, s: 0.9, v: 0.07 },
  { x: 1000, y: 400, s: 1.3, v: 0.12 },
];
