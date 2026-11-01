# Wildlings — Technical Architecture

Wildlings is an original turn-based artillery game: cartoon critters on destructible 2D terrain,
mouse-aimed projectile weapons, wind, and short platform-style movement each turn.

It ships as two clients that play the same game and connect to the same server:

| Part | Tech | Folder |
| --- | --- | --- |
| Shared game spec (data) | JSON | `shared/spec/` |
| Shared simulation (rules, physics, AI, protocol types) | TypeScript, no DOM | `shared/src/` |
| Authoritative server | Node 24 + `ws` + built-in `node:sqlite` | `server/` |
| Web client | TypeScript + Phaser 4.2 + Vite | `web/` |
| Native client | Godot 4.7, typed GDScript | `godot/` |
| Shared art and sound | Generated SVG and WAV files | `shared/assets/` (built by `tools/`) |
| The original Canvas prototype | Vanilla JS (reference only) | `legacy/` |

## 1. Single source of truth

`shared/spec/*.json` holds every gameplay number:

- `rules.json`: world size, gravity, wind, character movement, turn timings, damage constants,
  sudden death, `specVersion` and `protocolVersion`.
- `weapons.json`: every weapon's stats and behaviour.
- `maps.json`: the five environments (palette, terrain generator parameters, structures, hazards,
  wind profile).
- `characters.json`: the critter roster (cosmetic only, so competitive play stays fair).

The TypeScript sim imports these files directly. Godot reads a byte-identical copy in
`godot/data/`, which `npm run sync:godot` writes. The test `tools/check-spec-sync` fails CI if the
copies drift. Each client sends `specVersion` when it connects, and the server rejects a client
whose version differs from its own, so a stale build cannot join a match with different balance.

## 2. Simulation model

The simulation is a fixed 60 Hz tick (`rules.world.tickRate`). It has no physics engine, because
a pixel mask models deformable ground more simply than rigid bodies:

- **Terrain** is a `width × height` byte mask. `0` is air, `1` is earth, `2` is rock (carves at
  60 % of the blast radius), `3` is wood (bridges). Explosions carve circles. Collision is a
  point/circle query against the mask, so updating the terrain never creates physics bodies.
- **Characters** are circles. They walk along the surface, climbing up to `maxClimb` px per px
  walked (more while holding W, at a higher energy cost). They snap down slopes, jump with an
  impulse, fall under gravity and take fall damage over `fallSafeSpeed`.
- **Projectiles** integrate gravity and wind every tick, sub-stepped at ≤2 px per step so they
  never tunnel through thin terrain. Behaviours are `impact`, `bounce`, `drill`, `mine`,
  `teleport` and `strike`, with modifiers `pellets`, `sub` (cluster), `fuse` and `maxRange`.
- **Damage** is a linear falloff over the blast radius, plus a `directHit` bonus. Knockback is
  `knockback × (1 − d/reach)` along the blast normal, with an upward bias.
- **Randomness** comes from a seeded `mulberry32` RNG. A match seed reproduces the terrain, the
  spawns, the wind sequence and the cluster spread. Cosmetic effects use their own RNG.

`Match` (`shared/src/sim/match.ts`) owns one match. It accepts **commands** (`input`, `jump`,
`aim`, `weapon`, `fire`, `skip`), validates them, advances with `step()`, and emits **events**
(`turn`, `fire`, `carve`, `explode`, `damage`, `death`, `gameover`, …). Renderers never mutate
the sim; they read its state and react to its events.

### Who runs the simulation

| Mode | Simulation runs on | Clients render |
| --- | --- | --- |
| Web vs Bot | `Match` in the browser (shared TS) | the local `Match` |
| Godot vs Bot | the GDScript port of `Match` (`godot/sim/`) | the local port |
| Online PvP (any client mix) | **the server's `Match` only** | server snapshots and events |

### Cross-engine consistency strategy

GDScript and JavaScript both use IEEE-754 doubles, but transcendental functions (`sin`, `exp`,
`atan2`) are not guaranteed to be bit-identical across runtimes. So **online play never relies on
lockstep determinism**:

1. The server generates the terrain and sends it to every client as a run-length-encoded mask
   (a few kB). Both clients therefore start with identical terrain, whatever their own generator
   would produce.
2. Every terrain change reaches the clients as a `carve` event. Coordinates are quantised to
   0.01 px in the sim itself, so every client applies exactly the same integer carve loop.
3. Each turn start carries an FNV-1a checksum of the mask. On a mismatch the client requests a
   full resync (`resync`), which is also how reconnection works.
4. Character, projectile, mine and barrel positions come from server snapshots (20 Hz in motion,
   4 Hz when idle). Clients interpolate them with a 100 ms buffer.
5. Damage, eliminations, turn order, timers and results come only from the server.

Offline, the GDScript port follows the same algorithms and constants, so bots and physics behave
equivalently. In practice it is bit-identical for the RNG and for terrain generation on every
tested map and seed (`godot/tests/fixtures.json` comes from `tools/gen-fixtures.mjs`). Exact
equality is still not *relied on*, because no other client depends on it. One known source of
divergence is Godot's JSON parser, which is not correctly rounded in the last bit. That is why
step 3 above exists.

The Godot bot uses the same scoring as `shared/src/ai.ts`, but with a faster trajectory
integrator and time-sliced planning (GDScript is roughly 20–50× slower than JS), so its choices
are equivalent rather than identical.

## 3. Controls and input

Input is turned into the same command vocabulary on every platform, so gameplay code never
reads devices:

| Input | Command |
| --- | --- |
| A / D | `input.move = −1 / +1` (uses movement energy) |
| W (held) | `input.up`: climb steeper slopes, at double energy cost |
| S (held) | `input.down`: crouch, which steadies aim and extends the trajectory guide |
| Space | `jump` |
| Mouse | `aim` (angle from the critter, power from distance) |
| Left click | `fire` (edge-triggered, one shot per turn) |
| Wheel, E / Q, 1–9 | `weapon` (wheel can switch to power fine-tuning in Settings) |
| Esc | pause / menu (client-side only; online matches keep running) |

Web uses Phaser keyboard and pointer input. Godot uses Input Map actions (`move_left`,
`move_right`, `climb`, `crouch`, `jump`, `fire`, `weapon_next`, `weapon_prev`, `pause`).

## 4. Multiplayer

Authoritative server, one Node process, JSON over WebSocket (`/ws`). The full message reference
is `docs/PROTOCOL.md`; TypeScript types are in `shared/src/protocol.ts`.

- **Identity**: guest accounts. `hello` returns a `playerId` plus a secret `token` that the
  client stores (`localStorage` / `user://`). Presenting the token again restores the identity
  for reconnection and match history. Only a SHA-256 hash of the token is stored.
- **Rooms**: Quick Match (a FIFO queue paired into a room) or a Private Room with a 5-letter code
  that friends join by code or invite link (`?room=CODE`). A room holds 2 players today, and up
  to 4 with teams by design. Flow: lobby → everyone ready → match → results → rematch votes.
- **Validation**: every command goes through `Match.command()` on the server, which checks the
  sender's slot, the turn phase, energy, ammo and cooldowns, the angle and power ranges, the
  target bounds and duplicate fires. Messages are rate-limited per connection.
- **Disconnects**: a dropped player's slot is kept for `reconnectGrace` seconds (60). The match
  continues, so their turns time out. Reconnecting with the token returns the full state. When
  the grace period expires the player forfeits.
- **Persistence**: SQLite (`node:sqlite`, no native build) stores players, matches and per-player
  results. Migrations live in `server/migrations/*.sql` and are tracked in `schema_version`.

## 5. Clients

### Web (`web/`)

Phaser scenes: `Boot` (art, textures, audio) → `Menu` (DOM UI overlay) → `Battle` (world
rendering) + `Hud` (DOM HUD). The terrain is a `CanvasTexture` painted from the mask. A carve
redraws only the affected region and uploads it once per frame. Characters are modular sprite
rigs built from the shared SVG parts: body, head, feet, tail, eyes, scarf and the held weapon.

### Godot (`godot/`)

Scenes: `Main` (screen switching), menu screens (`Control` nodes, a shared `Theme`), `Battle`
(world `Node2D`), `Hud`. The terrain is an `Image` painted from the mask and shown through an
`ImageTexture`. A carve repaints the dirty rectangle and calls `ImageTexture.update`. Character
rigs use the same SVG parts, rasterised at load time. Only genuinely global state is an autoload:
`Settings`, `Net` (the WebSocket client) and `Sfx`.

## 6. Engine-specific differences (documented, not gameplay-relevant)

- Background parallax, particles and UI layouts are implemented natively per engine.
- Godot's offline sim is a port, not a shared binary (see §2). Online play is identical because
  the server owns the result.
- Font rendering and UI metrics differ slightly between the DOM and Godot `Control` nodes.
