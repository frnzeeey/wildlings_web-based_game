# Wildlings network protocol (v1)

JSON text frames over a WebSocket at `/ws`. The web client, the Godot client and the test bots
all speak it. TypeScript types live in `shared/src/protocol.ts`, and the Godot implementation is in
`godot/net/`. The server rejects a client unless both its `protocolVersion` and its `specVersion`
(from `shared/spec/rules.json`) match the server's.

Every message is an object with a string field `t`.

## Client → server

| `t` | Fields | Notes |
| --- | --- | --- |
| `hello` | `v`, `spec`, `client` (`web`\|`godot`\|`bot`\|`test`), `name`, `species?`, `token?` | Must come first. Send the stored `token` to keep the same identity. |
| `profile` | `name`, `species` | Updates your lobby name and critter. |
| `queue` / `unqueue` | | Join or leave Quick Match. |
| `createRoom` | `mapId?` (id or `random`), `settings?` | Creates a private room. You become the host. |
| `joinRoom` | `code` | Case-insensitive 5-letter code. |
| `leaveRoom` | | Leaving during a match forfeits. |
| `ready` | `ready` | The match starts when every member (2+) is ready and connected. |
| `roomConfig` | `mapId?`, `settings?` | Host only, lobby only. Resets everyone's ready flag. |
| `cmd` | `seq`, `c` (a [command](#commands)) | Rejections of `fire`, `weapon`, `jump` and `skip` are answered with `nack`. |
| `resync` | | Asks for a full `matchStart` (`resumed: true`), for example after terrain drift. |
| `rematch` | | Vote on the results screen. A new match starts when everyone has voted. |
| `resign` | | Forfeit the current match. |
| `ping` | `id` | Answered with `pong`. |

### Commands

The same objects that `Match.command()` accepts locally:

```jsonc
{ "t": "input",  "move": -1 | 0 | 1, "up": bool, "down": bool }   // held movement state
{ "t": "jump" }
{ "t": "aim",    "angle": rad, "power": 0..1 }                    // ~15/s while aiming
{ "t": "weapon", "id": "grenade" }
{ "t": "fire",   "weapon": "rocket", "angle": rad, "power": 0..1, "tx"?: x, "ty"?: y }
{ "t": "skip" }
```

The server checks the sender's slot, the turn phase, `fired` (one shot per turn), ammo, cooldown,
finite angle, power range, target bounds and teleport clearance.

## Server → client

| `t` | Fields | Notes |
| --- | --- | --- |
| `welcome` | `playerId`, `token`, `name`, `spec` | Store `token` (web: `localStorage`, Godot: `user://settings.cfg`). |
| `error` | `code`, `msg` | `version` / `spec` are fatal (the socket closes). Others are informational. |
| `queued` | `players` | Quick Match queue size. |
| `room` | `code`, `quick`, `state` (`lobby`\|`playing`\|`results`), `mapId`, `settings`, `members[]`, `rematch[]` | Sent on every change. |
| `left` | | You are no longer in a room. |
| `matchStart` | see below | Start of a match, a reconnect, or a resync (`resumed: true`). |
| `snap` | `s` (Snapshot) | 20 Hz while anything moves, 4 Hz otherwise. |
| `ev` | `tick`, `list` (SimEvents) | Everything that happened in that tick, in order. |
| `tsum` | `turn`, `tick`, `sum` | Terrain checksum at the start of a turn. |
| `nack` | `seq`, `error` | A command was rejected (`not-your-turn`, `no-ammo`, `cooldown`, …). |
| `presence` | `playerId`, `connected`, `graceLeft` | Disconnect and reconnect of a match member. |
| `matchEnd` | `result`, `players`, `reason` (`finished`\|`forfeit`\|`abandoned`) | Authoritative result. |
| `pong` | `id`, `time` | |

### `matchStart`

```jsonc
{
  "t": "matchStart", "matchId": "…", "mapId": "canyon", "seed": 123, "resumed": false,
  "settings": { "turnTime": 30, "wind": "normal", "startHP": 100, "suddenDeath": true },
  "players": [{ "slot": 0, "playerId": "…", "name": "Pip", "species": "fox", "team": 0, "client": "web" }],
  "you": 0,
  "terrain": { "w": 2600, "h": 1300, "rle": "<base64>", "surface": "<base64>" },
  "terrainSum": "16 hex chars",
  "chars": [{ "slot": 0, "maxHp": 100, "inv": { "rocket": -1, … }, "cd": { "heavy": 0, … } }],
  "snap": { …Snapshot… }
}
```

- `terrain.rle` is base64 of `[material, varint runLength]*` over the row-major `w×h` byte mask
  (0 air, 1 earth, 2 rock, 3 wood). `terrain.surface` is base64 of the little-endian int16 top line
  as generated, which is only used for drawing.
- `terrainSum` and `tsum.sum` are the first 16 hex characters of SHA-256 over the raw mask bytes.

### Snapshot

```jsonc
{ "tick": 1234, "ph": "aim", "ts": 0, "tn": 3, "tl": 21.4, "wind": -0.35, "water": 1235,
  "c":  [{ "s": 0, "x": 812.3, "y": 640.1, "vx": 0, "vy": 0, "hp": 87, "f": 3, "a": -0.8, "p": 0.62, "d": 1, "en": 64.2, "w": "rocket" }],
  "pr": [{ "id": 17, "k": "rocket", "x": 900.1, "y": 500.2, "vx": 700, "vy": -150, "dr": 1 }],
  "mn": [{ "id": 4, "x": 1500, "y": 700, "st": 1 }],
  "br": [{ "id": 5, "x": 1100, "y": 690, "st": 0 }] }
```

`f` flags: 1 on ground, 2 alive, 4 drowned, 8 crouching, 16 fired this turn. `tl = -1` means no
turn timer. Mine `st`: 0 unarmed, 1 armed, 2 triggered. Barrel `st`: 0 idle, 2 lit.

### Events (`ev.list`)

The same objects `Match` emits, keyed by `e`: `turn`, `aimPhase`, `fire`, `carve`, `explode`,
`damage`, `death`, `splash`, `bounce`, `jump`, `land`, `teleport`, `mineArmed`, `mineTrigger`,
`barrelLit`, `fizzle`, `weapon`, `timeUp`, `water`, `gameover`. See `SimEvent` in
`shared/src/sim/types.ts`.

## Client responsibilities

1. Decode the terrain from `matchStart`. Apply every `carve` event (`x`, `y`, `r`, already rounded
   to 0.01) with the shared carve rule. Compare the terrain against every `tsum`, and send `resync`
   on a mismatch. Godot's JSON parser is not correctly rounded in the last bit, so a rare
   one-pixel difference is possible. This check repairs it.
2. Render positions from snapshots with an interpolation delay of `rules.net.interpDelayMs`
   (100 ms). Release `ev` events when the render clock reaches their `tick`, so effects line up
   with the interpolated motion.
3. Never decide outcomes. HP, deaths, turns, timers and results always come from the server.
4. Reconnect automatically with backoff and send the stored token in `hello`. The server then
   re-sends `room` and `matchStart` (`resumed: true`).
