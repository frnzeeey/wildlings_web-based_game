// Online browser test: two independent browser contexts play through the real server.
// Covers quick match, private room + invite link, turn enforcement, shared state, and reconnection.
// Usage: node tools/e2e-online.mjs [url] [outDir]  (web dev server + game server must be running)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'e2e-shots';
mkdirSync(out, { recursive: true });
let browser;
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true });
    break;
  } catch {
    /* next */
  }
}
const errors = [];
const step = (m) => console.log(`• ${m}`);
const fail = (m) => {
  console.error(`✗ ${m}`);
  errors.push(m);
};

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('WebSocket') && errors.push(`${name} console: ${m.text()}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.screen-main');
  await page.evaluate((n) => {
    const a = window.wildlings.app;
    a.roster.players[0].name = n;
  }, name);
  return { ctx, page, name };
}

const state = (p) =>
  p.page.evaluate(() => {
    const s = window.wildlings.app.session;
    if (!s) return null;
    const w = s.world;
    return {
      you: s.you, phase: w.phase, active: w.activeSlot, turn: w.turnNumber, mine: s.controlledSlot(), status: s.status(),
      chars: w.characters.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), hp: c.hp, alive: c.alive })),
      sum: Array.from(w.terrain.data).reduce((h, v, i) => (v ? (h * 31 + i) % 1000000007 : h), 7),
    };
  });
async function waitFor(p, pred, ms, label) {
  const t0 = Date.now();
  for (;;) {
    const s = await state(p);
    if (s && pred(s)) return s;
    if (Date.now() - t0 > ms) {
      fail(`${p.name}: timeout waiting for ${label} (${JSON.stringify(s && { phase: s.phase, turn: s.turn, active: s.active })})`);
      return s;
    }
    await p.page.waitForTimeout(100);
  }
}

// ---------------------------------------------------------------- quick match
const A = await player('Alice');
const B = await player('Bob');
for (const p of [A, B]) {
  await p.page.click('[data-action=go][data-to=online]');
  await p.page.waitForSelector('.conn-online', { timeout: 10000 });
}
step('both clients connected to the server');
await A.page.click('[data-action=quick]');
await A.page.waitForSelector('.searching');
await A.page.screenshot({ path: join(out, 'on-01-queue.png') });
await B.page.click('[data-action=quick]');
await A.page.waitForSelector('.hud-top', { timeout: 10000 });
await B.page.waitForSelector('.hud-top', { timeout: 10000 });
step('quick match paired the two browsers');

let sa = await waitFor(A, (s) => s.phase === 'aim', 10000, 'aim phase');
const act = sa.mine >= 0 ? A : B;
const idle = act === A ? B : A;
await act.page.waitForTimeout(300);
await act.page.screenshot({ path: join(out, 'on-02-active.png') });
await idle.page.screenshot({ path: join(out, 'on-03-waiting.png') });

// The waiting player's click must not fire.
await idle.page.mouse.click(600, 300);
await idle.page.waitForTimeout(400);
let si = await state(idle);
if (si.phase !== 'aim') fail('idle player was able to act');
else step('waiting player cannot fire');

// Active player walks and fires.
await act.page.mouse.move(600, 380);
await act.page.keyboard.down('KeyD');
await act.page.waitForTimeout(500);
await act.page.keyboard.up('KeyD');
await act.page.waitForTimeout(400);
const sx = await state(act);
const sxIdle = await state(idle);
const me = sx.chars[sx.you];
if (Math.abs(sxIdle.chars[sx.you].x - me.x) > 3) fail(`positions differ across clients: ${me.x} vs ${sxIdle.chars[sx.you].x}`);
else step(`movement replicated (x=${me.x} on both)`);
const target = await act.page.evaluate(() => {
  const s = window.wildlings.app.session;
  const scene = window.wildlings.game.scene.getScene('battle');
  const w = s.world;
  const me = w.characters[s.you];
  const cam = scene.cameras.main;
  const wx = me.x + 120 * (me.x < 1300 ? 1 : -1);
  const wy = me.y - 160;
  return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
});
await act.page.mouse.move(target.x, target.y, { steps: 4 });
await act.page.waitForTimeout(200);
await act.page.mouse.click(target.x, target.y);
await waitFor(act, (s) => s.phase !== 'aim', 3000, 'shot to register');
step('active player fired');
await idle.page.waitForTimeout(700);
await idle.page.screenshot({ path: join(out, 'on-04-shot-seen-by-other.png') });
sa = await waitFor(A, (s) => s.turn === 2 && s.phase === 'aim', 25000, 'turn 2');
const sb = await waitFor(B, (s) => s.turn === 2 && s.phase === 'aim', 5000, 'turn 2 on B');
if (sa.sum !== sb.sum) fail('terrain differs between clients after the shot');
else step('both clients have identical terrain after the explosion');
if (JSON.stringify(sa.chars.map((c) => c.hp)) !== JSON.stringify(sb.chars.map((c) => c.hp))) fail('HP differs between clients');
if (sa.active !== sb.active || sa.active === (act === A ? sa.you : sb.you)) fail('turn did not pass to the other player');
else step('turn passed to the other player on both clients');

// ---------------------------------------------------------------- reconnection
await B.page.evaluate(() => window.wildlings.app.net.simulateDrop());
await A.page.waitForTimeout(400);
const statusA = (await state(A)).status;
if (!statusA || !statusA.includes('disconnected')) fail(`A was not told that B disconnected (status: ${statusA})`);
else step(`A sees: "${statusA}"`);
await A.page.screenshot({ path: join(out, 'on-05-opponent-dropped.png') });
await waitFor(B, (s) => s.status === null, 15000, 'B to reconnect');
await A.page.waitForTimeout(500);
const ra = await state(A);
const rb = await state(B);
if (ra.sum !== rb.sum) fail('terrain differs after reconnect');
else step('B reconnected automatically and has the same terrain and state');
if (ra.status) fail(`A still shows status after reconnect: ${ra.status}`);

// Resign to finish, then check results + rematch UI.
await B.page.evaluate(() => window.wildlings.app.net.send({ t: 'resign' }));
await A.page.waitForSelector('.gameover', { timeout: 10000 });
await B.page.waitForSelector('.gameover', { timeout: 10000 });
const titleA = await A.page.textContent('.gameover h2');
const titleB = await B.page.textContent('.gameover h2');
if (titleA !== 'Victory!' || titleB !== 'Defeat') fail(`results wrong: A="${titleA}" B="${titleB}"`);
else step('authoritative results: Alice wins, Bob loses');
await A.page.screenshot({ path: join(out, 'on-06-results.png') });
await A.page.click('[data-action=rematch]');
await B.page.click('[data-action=rematch]');
await waitFor(A, (s) => s.turn === 1, 10000, 'rematch to start');
step('rematch started');
await A.page.keyboard.press('Escape');
await A.page.click('[data-action=quit]');
await B.page.waitForTimeout(300);

// ---------------------------------------------------------------- private room via code
for (const p of [A, B]) {
  await p.page.evaluate(() => window.wildlings.app.show('online'));
  await p.page.waitForSelector('.conn-online');
}
// B may still be in the finished match; quit to lobby first.
await B.page.evaluate(() => window.wildlings.app.session && window.wildlings.app.net.send({ t: 'leaveRoom' }));
await A.page.click('[data-action=create]');
await A.page.waitForSelector('.room-code b');
const code = (await A.page.textContent('.room-code b')).trim();
await A.page.click('[data-action=set][data-group=room][data-value=jungle]');
await A.page.screenshot({ path: join(out, 'on-07-room.png') });
await B.page.evaluate(() => window.wildlings.app.show('online'));
await B.page.fill('#join-code', code);
await B.page.click('[data-action=join]');
await B.page.waitForSelector('.members .member:nth-child(2)');
step(`private room ${code} joined by code`);
await A.page.click('[data-action=ready]');
await B.page.click('[data-action=ready]');
await A.page.waitForSelector('.hud-top', { timeout: 10000 });
const mapName = await A.page.evaluate(() => window.wildlings.app.session.world.map.id);
if (mapName !== 'jungle') fail(`room map not applied (${mapName})`);
else step('room settings applied; match started in the Tropical Jungle');

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('\nonline e2e: all checks passed');
