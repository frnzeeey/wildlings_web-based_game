// Browser smoke/gameplay test for the web client. Drives the installed Edge/Chrome with
// playwright-core: menus, a VS Bot battle with real keyboard + mouse input, and console errors.
// Usage: node tools/e2e-web.mjs [url] [outDir]   (dev server must be running)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'e2e-shots';
mkdirSync(out, { recursive: true });

const channels = ['msedge', 'chrome'];
let browser;
for (const channel of channels) {
  try {
    browser = await chromium.launch({ channel, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    break;
  } catch {
    /* try next */
  }
}
if (!browser) throw new Error('No Edge or Chrome found');

const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const step = (msg) => console.log(`• ${msg}`);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  errors.push(msg);
};

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('.screen-main', { timeout: 20000 });
step('main menu rendered');
await shot('01-main');

for (const [to, sel] of [['characters', '.char-grid'], ['settings', '.panel h2'], ['howto', '.howto'], ['mode', '.mode-cards']]) {
  await page.click(`[data-action=go][data-to=${to}]`);
  await page.waitForSelector(sel);
  await shot(`02-${to}`);
  if (to !== 'mode') await page.click('[data-action=go][data-to=main]');
}
step('characters, settings, how-to and mode screens render');

await page.click('[data-action=go][data-to=bots]');
await page.click('[data-action=set][data-key=mapId][data-value=grasslands]');
await page.click('[data-action=set][data-key=turnTime][data-value="0"]');
await shot('03-bot-setup');
await page.click('[data-action=start]');
await page.waitForSelector('.hud-top', { timeout: 10000 });
step('battle started');

const state = () =>
  page.evaluate(() => {
    const s = window.wildlings.app.session;
    const w = s.world;
    return {
      phase: w.phase, active: w.activeSlot, mine: s.controlledSlot(), turn: w.turnNumber,
      chars: w.characters.map((c) => ({ x: c.x, y: c.y, hp: c.hp, energy: c.energy, alive: c.alive, weapon: c.weaponId })),
    };
  });
const waitFor = async (pred, ms, label) => {
  const t0 = Date.now();
  for (;;) {
    const s = await state();
    if (pred(s)) return s;
    if (Date.now() - t0 > ms) {
      fail(`timeout waiting for ${label} (phase ${s.phase}, turn ${s.turn})`);
      return s;
    }
    await page.waitForTimeout(100);
  }
};

// Wait for our own turn (bots may go first).
let s = await waitFor((x) => x.mine === 0 && x.phase === 'aim', 60000, 'our turn');
await page.waitForTimeout(400);
await shot('04-our-turn');

// Walk right with D, check movement and energy use.
const x0 = s.chars[0].x;
await page.mouse.move(683, 400);
await page.keyboard.down('KeyD');
await page.waitForTimeout(700);
await page.keyboard.up('KeyD');
s = await state();
if (Math.abs(s.chars[0].x - x0) < 5) fail(`D did not move the critter (${x0} -> ${s.chars[0].x})`);
if (s.chars[0].energy >= 100) fail('walking did not use energy');
step(`walked ${Math.round(s.chars[0].x - x0)} px, energy ${Math.round(s.chars[0].energy)}`);

// Jump with Space.
const y0 = s.chars[0].y;
await page.keyboard.press('Space');
await page.waitForTimeout(150);
s = await state();
if (s.chars[0].y >= y0) fail('Space did not jump');
else step('jumped');
await page.waitForTimeout(900);

// Cycle weapons with E and Q.
await page.keyboard.press('KeyE');
await page.waitForTimeout(150);
s = await state();
const w1 = s.chars[0].weapon;
await page.keyboard.press('KeyQ');
await page.waitForTimeout(150);
s = await state();
if (w1 === 'rocket' || s.chars[0].weapon !== 'rocket') fail(`E/Q weapon cycling failed (${w1}, ${s.chars[0].weapon})`);
else step(`E/Q cycle weapons (${w1} ↔ rocket)`);

// Aim at the enemy with the mouse and fire with a left click.
const target = await page.evaluate(() => {
  const app = window.wildlings.app;
  const scene = window.wildlings.game.scene.getScene('battle');
  const w = app.session.world;
  const me = w.characters[0];
  const enemy = w.characters[1];
  const cam = scene.cameras.main;
  // Aim up and toward the enemy at ~75% power.
  const ang = Math.atan2(-1, Math.sign(enemy.x - me.x));
  const wx = me.x + Math.cos(ang) * 200;
  const wy = me.y + Math.sin(ang) * 200;
  return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
});
await page.mouse.move(target.x, target.y, { steps: 5 });
await page.waitForTimeout(250);
await shot('05-aiming');
const hpBefore = (await state()).chars[1].hp;
await page.mouse.down();
await page.mouse.up();
s = await waitFor((x) => x.phase !== 'aim' || x.mine !== 0, 2000, 'fire to start action phase');
step(`fired (phase ${s.phase})`);
await page.waitForTimeout(500);
await shot('06-in-flight');
// A second click must not fire again.
await page.mouse.down();
await page.mouse.up();
s = await waitFor((x) => x.active !== 0 || x.phase === 'over', 20000, 'turn to pass to the bot');
step(`turn passed to slot ${s.active}; enemy hp ${hpBefore} -> ${s.chars[1].hp}`);

// Let the bot play its turn.
s = await waitFor((x) => (x.mine === 0 && x.phase === 'aim' && x.turn >= 3) || x.phase === 'over', 45000, 'bot turn to finish');
await shot('07-after-bot');
step(`bot finished; our hp ${s.chars[0].hp}`);

// Pause menu.
await page.keyboard.press('Escape');
await page.waitForSelector('.pause');
await shot('08-pause');
await page.click('[data-action=resume]');

// Other maps render.
for (const map of ['canyon', 'volcano', 'snow', 'jungle']) {
  await page.evaluate(() => window.wildlings.app.endSession?.());
  await page.evaluate((m) => {
    const app = window.wildlings.app;
    app.setup.mapId = m;
    app.setup.mode = 'bots';
    app.startLocal();
  }, map);
  await page.waitForTimeout(1800);
  await shot(`09-map-${map}`);
}
step('all maps render');

const fps = await page.evaluate(() => window.wildlings.game.loop.actualFps);
step(`fps ≈ ${Math.round(fps)}`);

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('\nweb e2e: all checks passed');
