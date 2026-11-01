# Development progress

Last updated: 2026-11-02.

## Phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| 1. Repository and architecture audit | Done | `docs/ARCHITECTURE.md`. The existing Canvas prototype is kept in `legacy/` (tag `legacy-canvas-prototype`). |
| 2. Core gameplay prototype | Done | Shared TS sim (`shared/src/sim`), with movement, jumping, aiming, firing, explosions, HP, turns |
| 3. Combat and terrain | Done | 9 data-driven weapons, wind, falloff, knockback, rock and wood materials, barrels, mines, sudden death |
| 4. VS Bot | Done | `shared/src/ai.ts` and `godot/sim/sim_bot.gd`: Easy, Normal and Hard |
| 5. Multiplayer backend | Done | `server/`: authoritative sim, quick match, private rooms, ready, rematch, reconnect, SQLite history |
| 6. Web implementation | Done | `web/`: Phaser 4.2 + TypeScript, every screen, offline and online |
| 7. Godot implementation | Done | `godot/`: GDScript sim port, shader terrain, every screen, offline and online |
| 8. UI, polish and content | Done | 5 maps, 8 critters, generated 2.5D art ("Sunlit Isles") and audio, particles, shake, hit-stop, banners |
| 9. Testing and optimisation | Done | See test results below. Terrain seams, crater rendering, input and UI bugs found and fixed. |
| 10. Build and deployment | Mostly done | Web production build verified. Godot pack export verified. Release `.exe` needs export templates. Dockerfile not built (Docker daemon not running). |

## Test results (last run)

- **Typecheck**: shared, server and web are clean.
- **Vitest (51 tests)**: terrain generation for every map, RLE round trip, rock resistance, turn
  flow, validation, timer, movement allowance, jumping, damage falloff, direct hit, knockback,
  ammo, cooldown, every weapon behaviour, barrels, mines, teleport, water deaths, forfeit, 2v2
  turn order, determinism, bots on every map at every difficulty (hard bots deal more damage than
  easy but still miss), bot-vs-bot matches to completion, and server integration (identity,
  spec-version rejection, malformed input, quick match with identical terrain, turn enforcement,
  duplicate-fire rejection, event and state convergence, checksum reproduction, private rooms,
  host-only config, full rooms, reconnect restoring state, forfeit on timeout, resign, rematch,
  migrations).
- **Godot headless (202 assertions)**: the GDScript port is bit-identical to the TS reference for
  the RNG and **all 10 terrain fixtures**, with matching damage and launch maths. It decodes the
  server terrain payload, and covers rules, weapons, bots on every map and difficulty, and a full
  bot match.
- **Browser e2e**: menus, a VS Bot match with real WASD, Space, E/Q and mouse input, bot turns,
  the pause menu, and all 5 maps rendering at about 60 fps.
- **Online e2e (two browsers)**: quick match, the idle player cannot fire, movement replicated,
  identical terrain and HP after explosions, turn hand-over, opponent-disconnected notice,
  automatic reconnect with identical state, authoritative Victory/Defeat, rematch, and a private
  room by code with host map choice.
- **Cross-client**: Godot vs Godot and Browser vs Godot through one server. Per-turn checksums
  verified on every client with no drift, final terrain byte-identical across clients, and
  consistent results.
- **Performance**: `Match.step` averages about 1 µs, worst case under 1 ms. Heap grew 0.9 MB after
  15 full matches (GC'd), so no leak. A carve costs 24 µs and the terrain payload is 8.6 kB. 10
  concurrent matches used about 6 % of one core. Downstream is about 8.5 kB/s per client. The
  browser held 60 fps through 240 explosions (p95 18 ms).

## Visual overhaul: "Sunlit Isles" (2.5D cartoon)

The whole presentation was rebuilt toward a modern 2.5D cartoon look, specified in
`docs/ART_DIRECTION.md`. Gameplay, physics, controls, networking and the spec version are unchanged.

- **Rendering model**: one volume shader (`tools/art-kit.mjs` `vol()`) for every sprite: soft key
  light, warm form shadow, ambient occlusion, rim and bounce light, specular, and coloured line art.
  It uses only gradients, clips and strokes, because Godot's ThorVG ignores SVG filters.
- **Characters**: all 8 redrawn with the new shading and determined faces. New gear for fox
  (goggles and bandana), bunny (commando headband), cat (leather jacket and earring) and penguin
  (aviator cap and knitted scarf). Rig anchors and animation states are unchanged.
- **Weapons, projectiles and FX**: chunkier weapons, striped rockets and skull bombs, cumulus smoke,
  and a new `fx_burst` cartoon blast in both clients.
- **Terrain** (web painter and Godot shader in sync): a thick scalloped grass cap with occlusion,
  cliffs of bevelled stacked rock blocks, masonry platforms and bevelled planks.
- **Decor**: terrain details are now shaded sprites (`deco_<map>_*`) in both clients instead of
  primitives.
- **Worlds**: 15 new painted parallax layers (`tools/art-worlds.mjs`): a castle mesa with
  waterfalls, floating islands, a watchtower, arch and buttes, volcanoes with lava falls, snowy
  peaks, and a jungle temple. Map palettes are brighter, with saturated skies.
- **UI**: the dusk-plum theme became sky-navy (kit SVGs, `theme.css`, Godot `ui.gd`). Layout and
  actions are unchanged.
- **Verified after the overhaul**: typecheck clean, 51/51 Vitest, 202/202 Godot assertions,
  browser e2e, two-browser online e2e, and cross-client (Godot vs Godot, browser vs Godot) with
  identical final terrain and no checksum drift. The web perf stress test reports avg 16.7 ms and
  p95 18.8 ms under 240 explosions, the same as before. Screenshots of every map, the menu,
  explosions and the Godot client were reviewed.

## Notable decisions

- **One rules engine, server-authoritative online.** Online matches never depend on
  cross-engine float determinism. The server sends the terrain and every carve, plus per-turn
  checksums with automatic resync. This mattered: Godot's JSON parser is not correctly rounded in
  the last bit.
- **Pixel-mask terrain, no physics engine**, in both clients. The web paints chunked canvas
  textures and re-uploads only dirty chunks. Godot renders the mask with a fragment shader, so no
  GDScript pixel loops are needed.
- **Shared art and audio are generated** (`tools/gen-art.mjs`, `tools/gen-sfx.mjs`) as SVG and WAV
  files that both engines load: original assets, identical look, no third-party art.
- **The Godot bot uses the same scoring with a faster trajectory integrator** and time-sliced
  planning, since GDScript is far slower than JS. Its behaviour is equivalent but not
  bit-identical. Offline play is the only place this matters.
- **Guest identities with tokens** (only SHA-256 hashes are stored) rather than accounts: enough
  for reconnection and history without passwords or email.
- **Legacy features kept**: hot-seat local multiplayer (2–4), the Burrow Drill, the Teleporter,
  a mouse-distance power control, and an alternative wheel-for-power mode.

## Known limitations and next steps

1. **Godot release executables**: install the 4.7.2 export templates, then run the export
   commands in `docs/DEPLOYMENT.md`. The pack export was verified to run.
2. **Docker image** is written but was not built here (the Docker daemon was not running). The
   same production server setup is exercised by `tools/cross-client.mjs`.
3. **No client-side prediction** for the active player's walking online. Movement shows about
   RTT + 100 ms after input. It is fine for turn-based play but noticeable on very slow links.
4. **2v2**: the sim, protocol and server support up to 4 players with teams, but rooms are
   capped at 2 and the lobby UI is 1v1. Raising `Room.capacity` and adding team selection is the
   remaining work.
5. **Accounts**: guest tokens only. Clearing browser storage creates a new identity.
6. **Touch controls** are not implemented. The web layout is responsive, but play needs a mouse.
7. Live rooms are in memory, so restarting the server ends running matches.
