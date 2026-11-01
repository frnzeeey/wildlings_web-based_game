// Cross-client multiplayer test: Godot vs Godot and Browser vs Godot through one real server.
// Starts its own server (temp DB, serving web/dist), drives headless Godot clients with
// --autoplay, and a real browser with playwright-core. Checks pairing, turn exchange, per-turn
// terrain checksums on every client, identical final terrain, and authoritative results.
// Usage: node tools/cross-client.mjs   (env GODOT=path/to/godot_console.exe)
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GODOT = process.env.GODOT ?? 'D:/Godot_v4.7.2-stable_win64.exe/Godot_v4.7.2-stable_win64_console.exe';
const PORT = 8899 + Math.floor(Math.random() * 50);
const WS = `ws://127.0.0.1:${PORT}/ws`;
const errors = [];
const step = (m) => console.log(`• ${m}`);
const fail = (m) => {
  console.error(`✗ ${m}`);
  errors.push(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

if (!existsSync(join(root, 'web/dist/index.html')) || process.argv.includes('--build')) {
  step('building web client');
  execSync('npm run build -w web', { cwd: root, stdio: 'ignore' });
}

const tmp = mkdtempSync(join(tmpdir(), 'wildlings-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/main.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmp, 'test.db'), STATIC_DIR: join(root, 'web/dist'), LOG_LEVEL: 'info' },
});
procs.push(server);
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; i < 50 && !serverLog.includes('wildlings server on'); i++) await sleep(100);
step(`server up on :${PORT}`);

function godot(name, extra = []) {
  const p = spawn(GODOT, ['--headless', '--path', join(root, 'godot'), '--', '--auto=quick', '--autoplay', `--server=${WS}`, `--settings=test_${name}.cfg`, `--name=${name}`, '--quit-after=240', ...extra]);
  procs.push(p);
  const g = { name, out: '', proc: p, results: [], starts: [], ok: 0, drift: 0 };
  const onData = (d) => {
    g.out += d;
    for (const line of String(d).split(/\r?\n/)) {
      if (line.startsWith('RESULT ')) g.results.push(JSON.parse(line.slice(7)));
      if (line.startsWith('MATCH_START ')) g.starts.push(JSON.parse(line.slice(12)));
      if (line.startsWith('TERRAIN_OK')) g.ok++;
      if (line.startsWith('TERRAIN_DRIFT')) g.drift++;
    }
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  return g;
}

async function until(pred, ms, label) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) {
      fail(`timeout: ${label}`);
      return false;
    }
    await sleep(200);
  }
  return true;
}

try {
  // ---------------------------------------------------------------- Godot vs Godot
  const A = godot('GodotA', ['--resign-after=5']);
  const B = godot('GodotB');
  if (await until(() => A.starts.length && B.starts.length, 30000, 'two Godot clients paired')) {
    step(`Godot vs Godot paired: ${A.starts[0].players.join(' vs ')} on ${A.starts[0].map}`);
    if (A.starts[0].matchId !== B.starts[0].matchId) fail('Godot clients are in different matches');
  }
  if (await until(() => A.results.length && B.results.length, 150000, 'Godot vs Godot match to finish')) {
    const [ra, rb] = [A.results[0], B.results[0]];
    if (ra.won || !rb.won) fail(`wrong winner: A won=${ra.won}, B won=${rb.won}`);
    else step(`GodotA resigned at turn ${ra.turns}; GodotB wins on both clients`);
    if (ra.sum !== rb.sum) fail(`final terrain differs between Godot clients (${ra.sum} vs ${rb.sum})`);
    else step(`final terrain identical on both Godot clients (${ra.sum})`);
  }
  if (A.drift || B.drift) fail(`terrain drift on Godot clients (A ${A.drift}, B ${B.drift})`);
  else step(`per-turn terrain checksums verified: A ${A.ok}, B ${B.ok}, no drift`);
  A.proc.kill();
  B.proc.kill();

  // ---------------------------------------------------------------- Browser vs Godot
  const G = godot('GodotC');
  let browser;
  for (const channel of ['msedge', 'chrome']) {
    try {
      browser = await chromium.launch({ channel, headless: true });
      break;
    } catch {
      /* next */
    }
  }
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  const drift = [];
  page.on('console', (m) => m.text().includes('terrain drift') && drift.push(m.text()));
  page.on('pageerror', (e) => fail(`browser pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.screen-main');
  await page.evaluate(() => (window.wildlings.app.roster.players[0].name = 'Browser'));
  await page.click('[data-action=go][data-to=online]');
  await page.waitForSelector('.conn-online', { timeout: 10000 });
  await until(() => G.out.includes('Net') || true, 100, '');
  await sleep(1500); // let Godot connect and queue first
  await page.click('[data-action=quick]');
  await page.waitForSelector('.hud-top', { timeout: 20000 });
  const info = await page.evaluate(() => window.wildlings.app.session.slots.map((s) => `${s.name}/${s.kind}/${s.detail}`));
  if (!info.some((s) => s.includes('godot'))) fail(`browser does not see a Godot opponent (${info})`);
  else step(`Browser vs Godot paired: ${info.join(' vs ')}`);

  const st = () => page.evaluate(() => {
    const s = window.wildlings.app.session;
    return { phase: s.world.phase, mine: s.controlledSlot(), turn: s.world.turn_number ?? s.world.turnNumber, over: !!s.result() };
  });
  let lastTurn = 0;
  let browserShots = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const s = await st();
    if (s.over) break;
    if (s.turn >= 6) {
      await page.evaluate(() => window.wildlings.app.net.send({ t: 'resign' }));
      break;
    }
    if (s.mine >= 0 && s.phase === 'aim' && s.turn !== lastTurn) {
      lastTurn = s.turn;
      await page.waitForTimeout(500);
      const target = await page.evaluate(() => {
        const s = window.wildlings.app.session;
        const cam = window.wildlings.game.scene.getScene('battle').cameras.main;
        const me = s.world.characters[s.you];
        const enemy = s.world.characters[1 - s.you];
        const wx = me.x + Math.sign(enemy.x - me.x) * 150;
        const wy = me.y - 150;
        return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
      });
      await page.mouse.move(target.x, target.y, { steps: 3 });
      await page.waitForTimeout(150);
      await page.mouse.click(target.x, target.y);
      browserShots++;
    }
    await sleep(150);
  }
  step(`browser fired ${browserShots} shot(s) with real mouse input; Godot autoplayed its turns`);
  await page.waitForSelector('.gameover', { timeout: 15000 });
  const title = await page.textContent('.gameover h2');
  await until(() => G.results.length > 0, 15000, 'Godot to report the result');
  const rg = G.results[0];
  if (title !== 'Defeat' || !rg?.won) fail(`inconsistent results: browser "${title}", Godot won=${rg?.won}`);
  else step('authoritative result agrees: browser "Defeat", Godot "Victory"');
  const browserSum = await page.evaluate(async () => {
    const d = await crypto.subtle.digest('SHA-256', window.wildlings.app.session.world.terrain.data);
    return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  });
  if (rg && browserSum !== rg.sum) fail(`final terrain differs: browser ${browserSum} vs Godot ${rg.sum}`);
  else step(`final terrain identical in browser and Godot (${browserSum})`);
  if (drift.length || G.drift) fail(`terrain drift detected (browser ${drift.length}, Godot ${G.drift})`);
  else step(`Godot verified ${G.ok} turn checksums; browser reported no drift`);
  await browser.close();
} finally {
  for (const p of procs) p.kill();
}

const matches = (serverLog.match(/match \w+ over/g) ?? []).length;
step(`server completed ${matches} match(es)`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n${errors.join('\n')}`);
  console.error('\n--- server log tail ---\n' + serverLog.split('\n').slice(-15).join('\n'));
  process.exit(1);
}
console.log('\ncross-client: all checks passed');
process.exit(0);
