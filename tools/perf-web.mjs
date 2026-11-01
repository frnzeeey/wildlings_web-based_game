// Browser rendering stress: 2 explosions per frame for 2 s through the normal event path
// (terrain carve + chunk re-upload + particles), measuring frame times. Dev server must run.
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/';
let browser;
for (const channel of ['msedge', 'chrome']) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch {} }
const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('.screen-main');
await page.evaluate(() => { const a = window.wildlings.app; a.setup.mode = 'local'; a.setup.count = 2; a.setup.mapId = 'grasslands'; a.settings.turnTime = 0; a.startLocal(); });
await page.waitForTimeout(2000);
const r = await page.evaluate(() => new Promise((done) => {
  const m = window.wildlings.app.session.match;
  const times = [];
  let last = performance.now();
  let frames = 0;
  const heap0 = performance.memory?.usedJSHeapSize ?? 0;
  const tick = () => {
    const now = performance.now();
    times.push(now - last);
    last = now;
    if (frames < 120) {
      for (let k = 0; k < 2; k++) {
        const x = 600 + ((frames * 2 + k) * 53) % 1400, y = 700 + ((frames * 7 + k * 31) % 300), r = 55;
        m.terrain.carve(x, y, r);
        m.events.push({ e: 'carve', x, y, r }, { e: 'explode', x, y, r, id: 'rocket', shake: 0 });
      }
    }
    if (++frames < 200) requestAnimationFrame(tick);
    else {
      times.sort((a, b) => a - b);
      done({ avg: times.reduce((s, v) => s + v, 0) / times.length, p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1], heapMB: ((performance.memory?.usedJSHeapSize ?? 0) - heap0) / 1048576 });
    }
  };
  requestAnimationFrame(tick);
}));
console.log(`frame time under 240 explosions: avg ${r.avg.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms, heap +${r.heapMB.toFixed(1)} MB`);
await page.screenshot({ path: process.argv[3] ?? 'perf-web.png' });
await browser.close();
