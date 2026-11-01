// Art QA contact sheet: assembles every critter from its parts (all expression states, using the
// per-species rig in manifest.species) plus logo, UI kit, props, weapons, FX and background
// layers, at game scale (1x) and close up. Usage: node tools/art-sheet.mjs [out.png]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artDir = join(root, 'shared/assets/art');
const m = JSON.parse(readFileSync(join(artDir, 'manifest.json'), 'utf8'));
const url = (k) => pathToFileURL(join(artDir, `${k}.svg`)).href;
const TEAM = ['#ff4d6d', '#3a86ff', '#ffbe0b', '#8ac926'];

function img(key, x, y, s, extra = '') {
  const b = m.parts[key];
  if (!b) return '';
  return `<img src="${url(key)}" style="position:absolute;left:${(b.x + x) * s}px;top:${(b.y + y) * s}px;width:${b.w * s}px;height:${b.h * s}px;${extra}">`;
}

function teamImg(sp, s, team) {
  const key = `${sp}_team`;
  const b = m.parts[key];
  const box = `position:absolute;left:${b.x * s}px;top:${b.y * s}px;width:${b.w * s}px;height:${b.h * s}px;`;
  return `<i style="${box}background:${TEAM[team]};-webkit-mask:url(${url(key)}) 0 0/100% 100%;"></i>` + img(key, 0, 0, s, 'mix-blend-mode:multiply;');
}

/** Mirrors the engine rig (web/src/game/Critter.ts): same part order and anchors. */
function critter(sp, s, state = 'idle', team = 0) {
  const info = m.species[sp];
  let h = img('shadow', 0, 0, s);
  if (info.team === 'back') h += teamImg(sp, s, team);
  if (info.tail) h += img(`${sp}_tail`, 0, 0, s);
  h += img(`${sp}_foot`, info.feet[0][0], info.feet[0][1], s) + img(`${sp}_body`, 0, 0, s);
  if (info.team === 'body') h += teamImg(sp, s, team);
  h += img(`${sp}_head`, 0, 0, s);
  if (info.team === 'head') h += teamImg(sp, s, team);
  for (const e of info.eyes) {
    const k = e.r / 4;
    if (state === 'blink') h += img('eye_closed', e.x, e.y, s, `transform:scale(${k});`);
    else if (state === 'hurt') h += img('eye_hurt', e.x, e.y, s, `transform:scale(${e.far ? -k : k},${k});`);
    else if (state === 'happy') h += img('eye_happy', e.x, e.y, s, `transform:scale(${k});`);
    else h += img('eye_white', e.x, e.y, s, `transform:scale(${k});`) + img('eye_pupil', e.x + 0.6, e.y + (state === 'aim' ? -0.4 : 0.2), s, `transform:scale(${k});`);
    const rot = state === 'aim' ? (e.far ? 14 : -14) : state === 'hurt' ? (e.far ? -18 : 18) : 0;
    h += img('brow', e.x, e.y - e.r - 2.6, s, `transform:rotate(${rot}deg) scale(${e.far ? -k : k},${k});`);
  }
  if (state === 'hurt' || state === 'happy') h += img('mouth_open', info.mouth.x, info.mouth.y, s);
  h += img(`${sp}_foot`, info.feet[1][0], info.feet[1][1], s);
  if (state === 'aim') {
    h += `<div style="position:absolute;left:${info.arm.x * s}px;top:${info.arm.y * s}px;transform:rotate(-25deg);transform-origin:0 0">${img('held_rocket', 0, 0, s)}${img(`${sp}_hand`, 4, 2, s)}</div>`;
  }
  return `<div style="position:relative;display:inline-block;width:${54 * s}px;height:${78 * s}px;margin:4px"><div style="position:absolute;left:${27 * s}px;top:${74 * s}px">${h}</div></div>`;
}

const species = Object.keys(m.species);
const row = (title, inner, bg) => `<section style="background:${bg};padding:8px 12px;margin:0 0 6px"><h3>${title}</h3>${inner}</section>`;
let html = `<html><body style="margin:0;font:600 13px sans-serif;color:#1f1a3d;background:#eee"><style>h3{margin:2px 0 4px}</style>`;
html += row('Logo', `<img src="${url('logo')}" style="width:571px">`, 'linear-gradient(#6fcfff,#fff0c4)');
html += row('Roster at 2x (idle, team colours)', species.map((s, i) => critter(s, 2, 'idle', i % 4)).join(''), 'linear-gradient(#9bdcff,#fff0c4)');
html += row('Game scale 1x over terrain colours (idle + aiming)', species.map((s, i) => critter(s, 1, 'idle', i % 4)).join('') + species.map((s, i) => critter(s, 1, 'aim', i % 4)).join(''), 'linear-gradient(#7fc8ff 0 60%,#5cc23a 60% 66%,#c27a45 66%)');
html += row('Expressions — idle / blink / aim / hurt / happy', ['fox', 'bear', 'frog', 'penguin'].map((s) => ['idle', 'blink', 'aim', 'hurt', 'happy'].map((st) => critter(s, 2, st)).join('')).join('<br>'), '#3a2c6b');
html += row('Close-up 4x', critter('fox', 4, 'aim') + critter('bunny', 4) + critter('raccoon', 4, 'happy'), 'linear-gradient(#ff9466,#ffe4ad)');
const kit = Object.keys(m.parts).filter((k) => k.startsWith('ui_'));
html += row('UI kit', kit.map((k) => `<span style="display:inline-block;margin:6px;text-align:center"><img src="${url(k)}" style="width:${m.parts[k].w * 1.5}px"><br>${k}</span>`).join(''), '#2a2050');
const props = Object.keys(m.parts).filter((k) => /^(proj_|held_|icon_|fx_|deco_|mine|barrel|tomb|cloud|plane|crosshair)/.test(k));
html += row('Props, weapons, projectiles, FX, icons (3x)', props.map((k) => `<span style="display:inline-block;position:relative;width:${m.parts[k].w * 3}px;height:${m.parts[k].h * 3}px;margin:4px;background:${k.startsWith('fx_') ? '#3a3046' : 'transparent'}">${img(k, -m.parts[k].x, -m.parts[k].y, 3)}</span>`).join(''), '#cfe8ff');
for (const map of Object.keys(m.backgrounds)) {
  const layers = m.backgrounds[map].map((l, i) => `<img src="${url(l.key)}" style="position:absolute;left:0;top:${i * 18}px;width:900px;height:254px">`).join('');
  html += row(`Background layers: ${map}`, `<div style="position:relative;width:900px;height:290px;background:#7fc8ff;overflow:hidden">${layers}</div>`, '#ddd');
}
html += '</body></html>';

const dir = mkdtempSync(join(tmpdir(), 'wl-art-'));
const file = join(dir, 'sheet.html');
writeFileSync(file, html);
let browser;
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true, args: ['--allow-file-access-from-files'] });
    break;
  } catch {
    /* next */
  }
}
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto(pathToFileURL(file).href);
await page.waitForTimeout(800);
const outPath = process.argv[2] ?? join(tmpdir(), 'wildlings-art-sheet.png');
await page.screenshot({ path: outPath, fullPage: true });
// Also save viewport-sized slices (outPath-1.png, -2.png, ...) for close inspection.
const total = await page.evaluate(() => document.body.scrollHeight);
for (let i = 0, y = 0; y < total; i++, y += 900) {
  await page.screenshot({ path: outPath.replace(/\.png$/, `-${i + 1}.png`), clip: { x: 0, y, width: 1100, height: Math.min(900, total - y) }, fullPage: true });
}
await browser.close();
console.log(`art sheet: ${outPath}`);
