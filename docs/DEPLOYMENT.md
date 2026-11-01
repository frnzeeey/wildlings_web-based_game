# Building, running and deploying Wildlings

## Requirements

- Node.js 22.13+ (developed on 24.11). The server uses the built-in `node:sqlite` and runs
  TypeScript directly (type stripping), so it needs no build step.
- Godot 4.7.x for the native client (developed on 4.7.2, GL Compatibility renderer).
- Optional: Edge or Chrome for the automated browser tests (`playwright-core` drives the installed
  browser and does not download one).

## Local development

```bash
npm install
npm run assets        # regenerate shared art (SVG) and sound (WAV); outputs are committed
npm run sync:godot    # copy shared/spec + shared/assets into godot/ (byte for byte)

npm run dev:server    # game server on :8787 (restarts on change)
npm run dev           # web client on http://localhost:5173 (proxies /ws to :8787)
```

Open the `godot/` folder in the Godot 4.7 editor and press Play. The Godot client connects to
`ws://localhost:8787/ws` by default. Change the address in **Settings → Online server**, or with
`WILDLINGS_SERVER=ws://host:port/ws` or `-- --server=ws://host:port/ws`.

The original Canvas prototype is kept for reference (`npm run dev:legacy`, git tag
`legacy-canvas-prototype`).

## Tests

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript for shared, server and web |
| `npm test` | Spec sync check, then the simulation, AI and server integration tests (Vitest) |
| `npm run test:godot` | Godot headless suite: GDScript port vs the TS reference (RNG, terrain, maths), rules, weapons, bots |
| `npm run test:e2e` | Browser: menus, VS Bot match with real WASD/Space/E/Q/mouse input, all maps (dev server running) |
| `node tools/e2e-online.mjs` | Two browsers through the server: quick match, turn enforcement, replication, reconnect, results, rematch, private room |
| `npm run test:cross` | Godot vs Godot and Browser vs Godot through a fresh server, with terrain checksums and results |
| `node --expose-gc tools/perf.mjs` | Sim tick cost, memory across matches, carve/encode cost, server CPU at 10 concurrent matches, bandwidth |
| `node tools/perf-web.mjs` | Browser frame times under 240 explosions (dev server running) |
| `node tools/art-sheet.mjs [out.png]` | Art QA contact sheet: all critters, expressions, props, FX, backgrounds |
| `node tools/shot.mjs <mapId or menu> <out.png>` | Web screenshot of a map or the menu (dev server running) |

Set `GODOT=/path/to/Godot_console_binary` if Godot is not at the default path used in `tools/`.

## Production web build

```bash
npm run build         # assets + godot sync + web/dist
npm start             # serves web/dist and /ws on :8787
```

The server serves the static web build from `STATIC_DIR`, so one process hosts everything. To
host the web client elsewhere (a CDN, for example), build with
`VITE_SERVER_URL=wss://game.example.com/ws npm run build -w web` and set `CORS_ORIGIN` on the
server for the history API.

## Server configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `server/data/wildlings.db` | SQLite file (created automatically) |
| `STATIC_DIR` | `web/dist` | Web build to serve (skipped if missing) |
| `CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` for `/api/*` and `/health` |
| `RECONNECT_GRACE` | `60` (from `rules.json`) | Seconds a disconnected player's slot is held |
| `LOG_LEVEL` | `info` | `debug`, `info` or `silent` |

Endpoints: `GET /health` (status, versions, live counts), `GET /api/history` (needs
`Authorization: Bearer <token>`), and the WebSocket at `/ws`.

### Database and migrations

SQLite in WAL mode. Migrations are numbered SQL files in `server/migrations/` (`001_init.sql`, …).
They are applied in order at startup inside a transaction and recorded in `schema_version`. To
change the schema, add `002_<name>.sql`. Never edit a migration that has already shipped. Back up
by copying the `.db` file while the server is stopped, or use `sqlite3 .backup`.

### Deploying the server

One Node process, no other services. Behind a reverse proxy, forward WebSocket upgrades for
`/ws` and terminate TLS there, so clients use `wss://`.

```nginx
location /ws { proxy_pass http://127.0.0.1:8787; proxy_http_version 1.1;
               proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
               proxy_read_timeout 3600s; }
location /   { proxy_pass http://127.0.0.1:8787; }
```

With Docker (see `Dockerfile`):

```bash
docker build -t wildlings .
docker run -p 8787:8787 -v wildlings-data:/app/server/data wildlings
```

Rooms and live matches are held in memory, so restarting the server ends running matches. Match
history and identities persist in SQLite. One process comfortably runs many matches: 10
concurrent matches used about 6 % of one core in `tools/perf.mjs`.

## Godot desktop build

1. Install the export templates for your exact Godot version (Editor → Manage Export Templates →
   Download, or unpack `Godot_v4.7.2-stable_export_templates.tpz` into the editor's templates
   folder).
2. `npm run sync:godot`
3. Export:

```bash
godot --headless --path godot --export-release "Windows Desktop" build/windows/Wildlings.exe
godot --headless --path godot --export-release "Linux" build/linux/Wildlings.x86_64
```

The presets in `godot/export_presets.cfg` include the raw files the client reads at runtime
(`data/*.json`, `assets/art/*.svg`, `assets/art/manifest.json`) and exclude `tests/`. Without
templates you can still produce and test a game pack:

```bash
godot --headless --path godot --export-pack "Windows Desktop" build/wildlings.pck
godot --main-pack build/wildlings.pck
```

## Multiplayer testing by hand

1. `npm run dev:server`, then `npm run dev`.
2. Open two browser windows (or one browser and the Godot client) and choose **Online PvP**.
3. **Quick Match** in both, or **Private Room** in one and **Join Room** with the code (or the
   copied invite link `?room=CODE`) in the other.
4. To test reconnection, close one window mid-match and reopen it within 60 s (same browser, so
   the same stored token). Wait longer and the opponent wins by forfeit.

Godot automation flags (after `--`): `--auto=bot`, `--auto=quick`, `--join=CODE`, `--autoplay`,
`--resign-after=N`, `--server=URL`, `--name=NAME`, `--map=ID`, `--settings=file.cfg`,
`--shot=path.png --shot-delay=S`, `--quit-after=S`.
