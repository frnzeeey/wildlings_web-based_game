// Screenshot helper for art review: node tools/shot.mjs <map|menu> <out.png> [waitMs] [explode]
import { chromium } from 'playwright-core';
const [what, out, wait = '2200', boom] = process.argv.slice(2);
let b;
for (const channel of ['msedge', 'chrome']) { try { b = await chromium.launch({ channel, headless: true }); break; } catch {} }
const page = await b.newPage({ viewport: { width: 1366, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.screen-main');
if (what !== 'menu') {
  await page.evaluate((m) => { const a = window.wildlings.app; a.setup.mapId = m; a.setup.mode = 'local'; a.setup.count = 2; a.settings.turnTime = 0; a.startLocal(); }, what);
  await page.waitForTimeout(Number(wait));
  if (boom) {
    await page.evaluate(() => { const s = window.wildlings.app.session; const m = s.match; const c = m.active; s.send({ t: 'fire', weapon: 'heavy', angle: -Math.PI / 2 + 0.35 * c.facing, power: 0.45 }); });
    await page.waitForTimeout(Number(boom));
  }
} else await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
if (errs.length) console.log('ERRORS', errs);
await b.close();
