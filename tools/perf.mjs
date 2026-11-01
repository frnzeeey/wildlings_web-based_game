// Performance checks: sim tick cost, memory across many matches, terrain carve/encode cost,
// server CPU with concurrent matches, and network traffic per client.
// Usage: node --expose-gc tools/perf.mjs
import { performance } from 'node:perf_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { Match, Bot, MAPS, RULES, generateTerrain, encodeTerrain, PROTOCOL_VERSION, SPEC_VERSION } from '../shared/src/index.ts';
process.env.LOG_LEVEL = 'silent';
const { startServer } = await import('../server/src/server.ts');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dt = 1 / RULES.world.tickRate;
const mb = (b) => (b / 1048576).toFixed(1);
const out = [];
const report = (k, v) => {
  out.push([k, v]);
  console.log(`${k.padEnd(44)} ${v}`);
};

// ---------------------------------------------------------------- sim
function botMatch(seed, mapId) {
  const m = new Match({ mapId, seed, players: [{ name: 'A', species: 'fox', team: 0 }, { name: 'B', species: 'bear', team: 1 }], settings: { turnTime: 30 } });
  const bots = [new Bot('normal', seed), new Bot('hard', seed + 1)];
  m.start();
  let stepTime = 0;
  let planTime = 0;
  let ticks = 0;
  let maxStep = 0;
  while (m.phase !== 'over' && ticks < 60 * 1500) {
    const s = m.activeSlot;
    const a = performance.now();
    for (const c of bots[s].update(dt, m, s, Infinity)) m.command(s, c);
    const b = performance.now();
    m.step();
    const c = performance.now();
    planTime += b - a;
    stepTime += c - b;
    maxStep = Math.max(maxStep, c - b);
    m.takeEvents();
    ticks++;
  }
  return { ticks, stepTime, planTime, maxStep, turns: m.turnNumber };
}

global.gc?.();
const heap0 = process.memoryUsage().heapUsed;
let totalTicks = 0;
let totalStep = 0;
let totalPlan = 0;
let maxStep = 0;
let turns = 0;
const N = 15;
for (let i = 0; i < N; i++) {
  const r = botMatch(1000 + i, MAPS[i % MAPS.length].id);
  totalTicks += r.ticks;
  totalStep += r.stepTime;
  totalPlan += r.planTime;
  maxStep = Math.max(maxStep, r.maxStep);
  turns += r.turns;
}
global.gc?.();
const heap1 = process.memoryUsage().heapUsed;
report('sim: matches played (bot vs bot)', `${N} (${turns} turns, ${Math.round(totalTicks / 60)} s of game time)`);
report('sim: avg Match.step()', `${((totalStep / totalTicks) * 1000).toFixed(1)} µs (budget 16 667 µs)`);
report('sim: worst Match.step()', `${maxStep.toFixed(2)} ms`);
report('sim: bot planning per turn (unsliced)', `${(totalPlan / turns).toFixed(0)} ms`);
report('sim: heap growth after all matches', `${mb(heap1 - heap0)} MB ${global.gc ? '(after GC)' : '(run with --expose-gc for exact)'}`);

// ---------------------------------------------------------------- terrain
const t = generateTerrain(MAPS[0], 5, RULES.world.width, RULES.world.height, RULES.world.waterLevel);
let a = performance.now();
for (let i = 0; i < 1000; i++) t.carve(200 + (i * 37) % 2200, 500 + (i * 13) % 600, 55);
report('terrain: carve r=55', `${((performance.now() - a) / 1000 * 1000).toFixed(0)} µs each`);
a = performance.now();
const enc = encodeTerrain(t);
report('terrain: encode for network', `${(performance.now() - a).toFixed(1)} ms, ${(enc.rle.length / 1024).toFixed(1)} kB base64`);
a = performance.now();
for (let i = 0; i < 5; i++) generateTerrain(MAPS[i], 9, RULES.world.width, RULES.world.height, RULES.world.waterLevel);
report('terrain: generate', `${((performance.now() - a) / 5).toFixed(0)} ms per map`);

// ---------------------------------------------------------------- server + network
process.env.LOG_LEVEL = 'silent';
const srv = await startServer({ port: 0, host: '127.0.0.1', dbPath: join(tmpdir(), `wl-perf-${Date.now()}.db`), migrationsDir: join(root, 'server/migrations') });
const url = `ws://127.0.0.1:${srv.server.address().port}/ws`;

function client(name) {
  return new Promise((ok) => {
    const ws = new WebSocket(url);
    const c = { ws, bytes: 0, msgs: 0, you: -1, snap: null, turn: 0, done: false, seq: 0, last: 0 };
    ws.on('message', (d) => {
      c.bytes += d.length;
      c.msgs++;
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') ok(c);
      if (m.t === 'matchStart') c.you = m.you;
      if (m.t === 'snap') c.snap = m.s;
      if (m.t === 'matchEnd') c.done = true;
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, spec: SPEC_VERSION, client: 'bot', name })));
  });
}

const PAIRS = 10;
const clients = [];
for (let i = 0; i < PAIRS * 2; i++) clients.push(await client(`P${i}`));
for (const c of clients) c.ws.send(JSON.stringify({ t: 'queue' }));
const cpu0 = process.cpuUsage();
const wall0 = performance.now();
const DURATION = 40000;
while (performance.now() - wall0 < DURATION) {
  for (const c of clients) {
    const s = c.snap;
    if (!s || s.ph !== 'aim' || s.ts !== c.you || c.last === s.tn) continue;
    c.last = s.tn;
    const me = s.c.find((x) => x.s === c.you);
    const other = s.c.find((x) => x.s !== c.you);
    const ang = Math.atan2(-0.9, Math.sign(other.x - me.x));
    c.ws.send(JSON.stringify({ t: 'cmd', seq: ++c.seq, c: { t: 'aim', angle: ang, power: 0.8 } }));
    c.ws.send(JSON.stringify({ t: 'cmd', seq: ++c.seq, c: { t: 'fire', weapon: 'grenade', angle: ang, power: 0.8 } }));
  }
  await new Promise((r) => setTimeout(r, 50));
}
const wall = performance.now() - wall0;
const cpu = process.cpuUsage(cpu0);
const playing = srv.lobby.stats.matches;
report('server: concurrent matches', `${PAIRS} (${playing} still running after ${Math.round(wall / 1000)} s)`);
report('server: process CPU (incl. 20 test clients)', `${(((cpu.user + cpu.system) / 1000 / wall) * 100).toFixed(1)} % of one core`);
const bytes = clients.reduce((s, c) => s + c.bytes, 0) / clients.length;
const msgs = clients.reduce((s, c) => s + c.msgs, 0) / clients.length;
report('net: downstream per client', `${(bytes / 1024 / (wall / 1000)).toFixed(2)} kB/s avg, ${(msgs / (wall / 1000)).toFixed(1)} msgs/s`);
report('net: match start payload', `${(enc.rle.length / 1024 + 1).toFixed(0)} kB once per match`);
for (const c of clients) c.ws.close();
await srv.close();
global.gc?.();
report('memory: rss at end', `${mb(process.memoryUsage().rss)} MB`);
process.exit(0);
