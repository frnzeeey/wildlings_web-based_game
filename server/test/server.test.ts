import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { decodeTerrain, type MatchStartMsg, type ServerMsg, type Snapshot, type SimEvent } from '@wildlings/shared';
import { Db } from '../src/db.ts';
import { testServer, TestClient, sleep } from './helpers.ts';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup = [];
});

async function setup(graceMs?: number) {
  const s = await testServer(graceMs);
  cleanup.push(s.close);
  return s;
}

async function client(url: string, name: string, opts = {}) {
  const c = await TestClient.connect(url, name, opts);
  cleanup.push(() => c.close());
  return c;
}

/** Two clients paired through Quick Match, both at the start of the match. */
async function pair(url: string) {
  const a = await client(url, 'Alice');
  const b = await client(url, 'Bob', { client: 'godot' });
  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  const sa = await a.waitFor<MatchStartMsg>((m) => m.t === 'matchStart');
  const sb = await b.waitFor<MatchStartMsg>((m) => m.t === 'matchStart');
  return { a, b, sa, sb };
}

const aimPhase = (c: TestClient, from = 0) => c.waitFor((m) => m.t === 'snap' && m.s.ph === 'aim', 10000, from);
function activeClient(a: TestClient, b: TestClient, snap: Snapshot) {
  return snap.ts === a.you ? [a, b] : [b, a];
}

describe('identity and versions', () => {
  it('welcomes a guest and restores identity from the token', async () => {
    const s = await setup();
    const a = await client(s.url, 'Alice');
    expect(a.playerId).toMatch(/^[0-9a-f]{16}$/);
    const again = await client(s.url, 'Alice2', { token: a.token });
    expect(again.playerId).toBe(a.playerId);
  });

  it('rejects clients with different game data', async () => {
    const s = await setup();
    const c = await client(s.url, 'Old', { spec: '0.0.1' });
    const err = await c.waitFor<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error');
    expect(err.code).toBe('spec');
  });

  it('ignores malformed and unknown messages without crashing', async () => {
    const s = await setup();
    const a = await client(s.url, 'Alice');
    a.ws.send('not json');
    a.ws.send(JSON.stringify({ t: 'cmd', seq: 1, c: null }));
    a.ws.send(JSON.stringify({ hello: 1 }));
    a.send({ t: 'joinRoom', code: 'ZZZZZ' });
    const err = await a.waitFor<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error' && m.code === 'no-room');
    expect(err).toBeTruthy();
    const res = await fetch(`${s.http}/health`);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe('quick match', () => {
  it('pairs two players into the same match with identical terrain', async () => {
    const s = await setup();
    const { a, b, sa, sb } = await pair(s.url);
    expect(sa.matchId).toBe(sb.matchId);
    expect(new Set([sa.you, sb.you])).toEqual(new Set([0, 1]));
    expect(sa.terrain.rle).toBe(sb.terrain.rle);
    const t = decodeTerrain(sa.terrain);
    expect(createHash('sha256').update(t.data).digest('hex').slice(0, 16)).toBe(sa.terrainSum);
    expect(sa.players.map((p) => p.client)).toContain('godot');
    void a;
    void b;
  });

  it('only the active player can act; duplicate fire is rejected', async () => {
    const s = await setup();
    const { a, b } = await pair(s.url);
    const snap = (await aimPhase(a)) as Extract<ServerMsg, { t: 'snap' }>;
    const [act, idle] = activeClient(a, b, snap.s);
    const bad = idle.cmd({ t: 'fire', weapon: 'rocket', angle: -1, power: 0.5 });
    const nack = await idle.waitFor<Extract<ServerMsg, { t: 'nack' }>>((m) => m.t === 'nack' && m.seq === bad);
    expect(nack.error).toBe('not-your-turn');

    act.cmd({ t: 'fire', weapon: 'rocket', angle: -Math.PI / 2, power: 0.3 });
    const dup = act.cmd({ t: 'fire', weapon: 'rocket', angle: -Math.PI / 2, power: 0.3 });
    const n2 = await act.waitFor<Extract<ServerMsg, { t: 'nack' }>>((m) => m.t === 'nack' && m.seq === dup);
    expect(['already-fired', 'wrong-phase']).toContain(n2.error);
    const noAmmo = act.cmd({ t: 'fire', weapon: 'nuke', angle: 0, power: 1 });
    expect((await act.waitFor<Extract<ServerMsg, { t: 'nack' }>>((m) => m.t === 'nack' && m.seq === noAmmo)).error).toBeTruthy();
  });

  it('both clients see the same events and converge on the same state', async () => {
    const s = await setup();
    const { a, b } = await pair(s.url);
    let snap = ((await aimPhase(a)) as Extract<ServerMsg, { t: 'snap' }>).s;
    for (let turn = 0; turn < 2; turn++) {
      const [act] = activeClient(a, b, snap);
      const me = snap.c.find((c) => c.s === snap.ts)!;
      const other = snap.c.find((c) => c.s !== snap.ts)!;
      act.cmd({ t: 'weapon', id: 'grenade' });
      act.cmd({ t: 'fire', weapon: 'grenade', angle: Math.atan2(-0.8, Math.sign(other.x - me.x)), power: 0.8 });
      const from = a.msgs.length;
      snap = ((await a.waitFor((m) => m.t === 'snap' && m.s.ph === 'aim' && m.s.tn === turn + 2, 45000, from)) as Extract<ServerMsg, { t: 'snap' }>).s;
    }
    await sleep(400);
    const events = (c: TestClient) => c.msgs.filter((m) => m.t === 'ev').flatMap((m) => (m as { list: SimEvent[] }).list);
    expect(JSON.stringify(events(a))).toBe(JSON.stringify(events(b)));
    expect(events(a).filter((e) => e.e === 'explode').length).toBeGreaterThanOrEqual(2);
    // Applying the carve events to the initial terrain reproduces the server checksum.
    const t = decodeTerrain(a.last('matchStart')!.terrain);
    for (const e of events(a)) if (e.e === 'carve') t.carve(e.x, e.y, e.r);
    const sum = a.last('tsum')!.sum;
    expect(createHash('sha256').update(t.data).digest('hex').slice(0, 16)).toBe(sum);
    expect(JSON.stringify(a.last('snap'))).toBe(JSON.stringify(b.last('snap')));
  }, 120_000);
});

describe('private rooms', () => {
  it('create, join by code, host-only config, ready up and start', async () => {
    const s = await setup();
    const host = await client(s.url, 'Host');
    const guest = await client(s.url, 'Guest');
    host.send({ t: 'createRoom', mapId: 'snow', settings: { turnTime: 20 } });
    const room = await host.waitFor<Extract<ServerMsg, { t: 'room' }>>((m) => m.t === 'room');
    expect(room.code).toMatch(/^[A-Z]{5}$/);
    expect(room.mapId).toBe('snow');
    guest.send({ t: 'joinRoom', code: room.code.toLowerCase() });
    await guest.waitFor((m) => m.t === 'room' && m.members.length === 2);
    guest.send({ t: 'roomConfig', mapId: 'canyon' });
    const err = await guest.waitFor<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error');
    expect(err.code).toBe('config');
    host.send({ t: 'roomConfig', settings: { wind: 'high', startHP: 150 } });
    await guest.waitFor((m) => m.t === 'room' && m.settings.wind === 'high');
    const third = await client(s.url, 'Third');
    third.send({ t: 'joinRoom', code: room.code });
    expect((await third.waitFor<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error')).code).toBe('room-full');
    host.send({ t: 'ready', ready: true });
    guest.send({ t: 'ready', ready: true });
    const start = await guest.waitFor<MatchStartMsg>((m) => m.t === 'matchStart');
    expect(start.mapId).toBe('snow');
    expect(start.settings).toMatchObject({ turnTime: 20, wind: 'high', startHP: 150 });
    expect(start.chars[0].maxHp).toBe(150);
  });
});

describe('disconnects', () => {
  it('reconnecting within the grace period restores the match state', async () => {
    const s = await setup();
    const { a, b } = await pair(s.url);
    const snap = ((await aimPhase(a)) as Extract<ServerMsg, { t: 'snap' }>).s;
    const [act] = activeClient(a, b, snap);
    act.cmd({ t: 'fire', weapon: 'rocket', angle: -Math.PI / 2 + 0.3, power: 0.6 });
    await a.waitFor((m) => m.t === 'ev' && m.list.some((e) => e.e === 'carve'), 10000);
    const token = b.token;
    await b.close();
    const p = await a.waitFor<Extract<ServerMsg, { t: 'presence' }>>((m) => m.t === 'presence' && !m.connected);
    expect(p.graceLeft).toBeGreaterThan(0);
    await sleep(300);
    const b2 = await client(s.url, 'Bob', { token });
    const resumed = await b2.waitFor<MatchStartMsg>((m) => m.t === 'matchStart');
    expect(resumed.resumed).toBe(true);
    // The resumed terrain contains the crater that was dug while we were away.
    expect(createHash('sha256').update(decodeTerrain(resumed.terrain).data).digest('hex').slice(0, 16)).toBe(resumed.terrainSum);
    expect(resumed.terrain.rle).not.toBe(a.last('matchStart')!.terrain.rle);
    await a.waitFor((m) => m.t === 'presence' && m.connected);
  });

  it('a player who does not return forfeits and the opponent wins', async () => {
    const s = await setup(400);
    const { a, b, sa } = await pair(s.url);
    await b.close();
    const end = await a.waitFor<Extract<ServerMsg, { t: 'matchEnd' }>>((m) => m.t === 'matchEnd', 5000);
    expect(end.reason).toBe('abandoned');
    expect(end.result.winners).toEqual([sa.you]);
    const hist = (await (await fetch(`${s.http}/api/history`, { headers: { authorization: `Bearer ${a.token}` } })).json()) as { won: boolean }[];
    expect(hist[0]).toMatchObject({ won: true });
  });

  it('resign ends the match and rematch starts a new one', async () => {
    const s = await setup();
    const { a, b, sa } = await pair(s.url);
    await aimPhase(a);
    b.send({ t: 'resign' });
    const end = await a.waitFor<Extract<ServerMsg, { t: 'matchEnd' }>>((m) => m.t === 'matchEnd');
    expect(end.result.winners).toEqual([sa.you]);
    a.send({ t: 'rematch' });
    b.send({ t: 'rematch' });
    const next = await a.waitFor<MatchStartMsg>((m) => m.t === 'matchStart' && m.matchId !== sa.matchId);
    expect(next.resumed).toBe(false);
  });

  it('the server keeps simulating when the active player vanishes; turns time out', async () => {
    const s = await setup();
    const a = await client(s.url, 'A');
    const b = await client(s.url, 'B');
    a.send({ t: 'createRoom', settings: { turnTime: 15 } });
    const room = await a.waitFor<Extract<ServerMsg, { t: 'room' }>>((m) => m.t === 'room');
    b.send({ t: 'joinRoom', code: room.code });
    await b.waitFor((m) => m.t === 'room' && m.members.length === 2);
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await a.waitFor((m) => m.t === 'matchStart');
    const snap = ((await aimPhase(a)) as Extract<ServerMsg, { t: 'snap' }>).s;
    const [act, other] = activeClient(a, b, snap);
    await act.close();
    const ev = await other.waitFor((m) => m.t === 'ev' && m.list.some((e) => e.e === 'timeUp'), 20000);
    expect(ev).toBeTruthy();
  }, 30000);
});

describe('database', () => {
  it('migrations apply once and are idempotent', () => {
    const db = new Db(':memory:', join(here, '../migrations'));
    expect(db.schemaVersion).toBe(1);
    const { player, token } = db.identify(undefined, 'X', 'fox');
    expect(db.playerByToken(token)?.id).toBe(player.id);
    db.close();
  });
});
