# Wildlings

A turn-based, cartoon critter artillery game that runs in the browser. Pick a critter, walk the
destructible battlefield, aim with the mouse, and blast the other critters off the map.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

The only dependency is Vite, used as the dev server and bundler. All art and sound are generated
in code, so there are no asset downloads.

## How to play

| Input | Action |
| --- | --- |
| `A` / `D` (or arrows) | Walk. Each step uses movement energy (the **Move** bar) |
| `W` / `Space` | Jump (costs energy). Hold `A`/`D` to jump sideways |
| `S` (hold) | Crouch to steady your aim. The guide gets longer and accounts for wind |
| Mouse | Aim. Distance from your critter sets the power |
| Left click | Fire. Each critter gets one attack per turn |
| Mouse wheel / `1`–`8` / click a slot | Switch weapon |
| Right-drag | Pan the camera |
| `+` / `-` | Zoom |
| `Esc` | Pause |

Wind changes every turn. Falling hurts, water means instant KO, and the last critter standing wins.

### Weapons

| # | Weapon | Notes |
| --- | --- | --- |
| 1 | Rocket | Unlimited. Explodes on impact, strongly affected by wind |
| 2 | Grenade | Bounces, 3 s fuse |
| 3 | Cluster Bomb | Splits into 5 bomblets on impact |
| 4 | Shotgun | 6 pellets, no wind, short range |
| 5 | Mega Bomb | Huge blast, heavy arc |
| 6 | Burrow Drill | Tunnels 160 px into the ground, then explodes |
| 7 | Meteor Shower | Five meteors fall on the cursor |
| 8 | Teleporter | Blink to any open spot (uses your turn) |

### Modes

- **Vs Bots**: you against 1–3 bots (Easy / Normal / Hard).
- **Local Multiplayer**: 2–4 players take turns on one machine (hot-seat).

Settings cover the turn timer (15–60 s or unlimited), wind strength, starting HP, aim guide, screen
shake and sound. Settings, critter choices and match setup are saved in `localStorage`.

## Architecture

```
src/
├── main.js                 App wiring: menus ↔ match lifecycle, pause, rematch
├── game/
│   ├── Game.js             One match: fixed 60 Hz simulation, render loop, explosions, damage
│   ├── TurnManager.js      start → aim → action → settle → next turn / game over
│   ├── Player.js           Critter state, walking/climbing, jumping, falling, inventory
│   ├── Projectile.js       Sub-stepped flight; impact / bounce / drill / cluster behaviours
│   ├── Weapon.js           Data-driven weapon registry + shared damage/launch maths
│   ├── Physics.js          Circle-vs-terrain collision, ground checks, surface normals
│   ├── Terrain.js          Procedural generation + destructible pixel mask & painted canvas
│   ├── AIController.js     Bots: simulate candidate shots with real physics, pick the best
│   ├── HumanController.js  Keyboard/mouse → intents
│   ├── Intents.js          The controller → game contract
│   ├── Input.js, Audio.js  Raw input; synthesized WebAudio SFX
│   ├── config.js           World constants, species, maps, defaults
│   └── utils.js            Seeded RNG, noise, maths helpers
├── rendering/
│   ├── Renderer.js         Sky, parallax hills, terrain, critters, aim guide, water, labels
│   ├── Camera.js           Follow, pan, zoom, screen shake
│   ├── Effects.js          Particles, rings, floating damage numbers
│   └── Sprites.js          Procedural critters, weapons, projectiles, icons
├── ui/                     Menu, HUD, GameOver/Pause (DOM overlays), previews, storage
├── assets/sprites.js       Optional image overrides for the procedural art
└── styles/main.css
```

### Physics notes

Terrain is a 1-byte-per-pixel solidity mask (authoritative) plus a painted canvas (visual).
Explosions carve both. Projectiles move in ≤2 px sub-steps, so they never tunnel through thin
ground. Critters are circles that climb up to 3 px per px walked and snap down slopes. No physics
engine (such as Matter.js) is needed, because a pixel mask models deformable ground more simply.

### Extending

- **New weapon**: add an entry to `WEAPONS` in `src/game/Weapon.js`. Combine the existing
  behaviours (`impact`, `bounce`, `drill`, `teleport`) with modifiers (`pellets`, `sub`, `fuse`,
  `targeted`). Add a case to `drawProjectileShape` / `drawHeldWeapon` in `Sprites.js` for custom art.
- **New critter**: add to `SPECIES` in `config.js` (colours, ear/tail/face style).
- **New map style**: add to `MAPS` in `config.js` (palette, generation parameters, decor).
- **Real sprites**: put images in `src/assets/` and map them in `src/assets/sprites.js`.

### Online multiplayer (future)

The groundwork is already in place:

- Every controller emits the same **intent** object (`Intents.js`). A `NetworkController` that
  receives intents from a socket can drive a remote player without any change to `Game`.
- Matches are **seeded** (`Game.seed`): terrain, spawns, wind and cluster spread all come from a
  deterministic RNG. Clients that share a seed and an intent stream reproduce the same match.
  Particle effects use `Math.random`, which is fine because they are cosmetic only.
- The simulation runs at a fixed 60 Hz step, separate from rendering.
