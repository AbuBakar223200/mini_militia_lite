# Mini Militia Lite

A lightweight, web-based 2D jetpack deathmatch game inspired by Mini Militia (Doodle Army 2).
Pure HTML/CSS/JavaScript on Canvas — no frameworks, no build step, zero asset files (all sound is synthesized with WebAudio).

Now with **online multiplayer** — host a room, share the code, and play with friends (WebRTC peer-to-peer via PeerJS).

## Play

**On mobile:** open the site on your phone (landscape recommended). Touch controls switch on automatically — twin sticks like the original: **left stick** moves and fires the jetpack (push up), **right stick** aims and fires while pushed, plus **💣 grenade**, **⟳ reload**, **⏸ pause** and **⛶ fullscreen** buttons. The menu is the same on every device, so you can play on PC and phone alike — even in the same online match.

**Solo / Local:** just open `index.html` in any browser — or serve the folder and open it.

**Host on Vercel (free):**
1. Push this repo to GitHub (already done if you're reading this there).
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
3. Framework preset: **Other** (it's a static site) → Deploy. That's it — no config needed.
4. Share the deployed URL with friends.

**Multiplayer:**
1. One player clicks **HOST GAME**, gets a 5-letter room code.
2. Friends click **JOIN GAME**, enter the code and connect.
3. Host picks bot count + difficulty and hits **START MATCH**.
4. The host's browser runs the match simulation; everyone else streams the action and sends inputs (peer-to-peer WebRTC data channels — no game server required).

> Players connect through PeerJS's free public broker, then talk directly to the host. STUN + public TURN relays are configured, so most networks (including phones on mobile data) connect. For best results the host needs a reasonably stable connection.

## Multiplayer troubleshooting

- A small **NET status chip** appears under your health bar in online matches. `HOSTING <code> · 2P` (host) or `MP · 0.1s` (client, snapshot age) = healthy. **`MP · NO SIGNAL`** / **STALLED** blinking red = the stream from the host stopped.
- **Stuck on "Connecting…"**: the host's screen must be ON and the game page open; check the room code.
- **"MP · NO SIGNAL" after joining**: the peer connection couldn't punch through the network. Host and joiner on the same Wi-Fi always works — try that first.
- **Host on a phone**: keep the phone unlocked and the tab visible — locking the screen pauses the whole match for everyone.

## Controls

| Key | Action | Key | Action |
|---|---|---|---|
| A / D | Move left / right | ← ↑ ↓ → | Aim (8-way) |
| W | Jetpack | SPACE / J | Shoot |
| S | Fast fall | K | Grenade |
| R | Reload | TAB | Scoreboard |
| P / ESC | Pause (host in MP) | M | Mute |

Mouse aim + left-click shoot also works.

## Game features

- Jetpack deathmatch arena, first to 15 frags wins
- AI bots with seeking, strafing, burst fire and grenades (Easy / Normal / Hard)
- 4 weapons: Rifle, UZI, Shotgun, Sniper — as pickups; dead players drop theirs
- Health, grenade and jetpack-fuel pickups; weapon drop on death
- One-way platforms + solid cover, respawn protection, slow out-of-combat regen
- Kill feed, minimap, scoreboard, screen shake, particles, synthesized SFX
- Mobile/touch support: auto-detected twin-stick controls, full-screen adaptive view, landscape prompt (toggleable from the main menu on any device)

## Project layout

```
index.html      page + menus/HUD
style.css       all styling
audio.js        WebAudio synthesized sound engine
levels.js       world layout, spawns, pickups
input.js        keyboard/mouse input
entities.js     physics, characters, bots, bullets, grenades, pickups
net.js          multiplayer (PeerJS host-authoritative networking)
game.js         game loop, camera, rendering, HUD, modes
serve.js        tiny static server for local testing (node serve.js)
peerjs.min.js   PeerJS library (vendored)
```

## Local development

```
node serve.js        # serves http://localhost:8123
```
or just open `index.html` directly.

Test multiplayer locally by opening two tabs: host in one, join in the other.
(Note: browser background tabs throttle their render loop, so keep the tab you're playing visible.)

## Credits

Built with ZCode. Sound is 100% procedural WebAudio. Multiplayer powered by [PeerJS](https://peerjs.com).
