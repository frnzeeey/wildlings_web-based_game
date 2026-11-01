import { RNG, makeNoise1D, clamp } from '../rng.ts';
import type { MapDef } from '../spec.ts';
import { TerrainMask, AIR, EARTH, ROCK, WOOD } from './terrain.ts';

/**
 * Deterministic battlefield generator. Same map + seed = same mask (within one engine).
 * Order of RNG draws is part of the contract with godot/sim/terrain_gen.gd — keep them in sync.
 */
export function generateTerrain(map: MapDef, seed: number, width: number, height: number, waterLevel: number): TerrainMask {
  const t = new TerrainMask(width, height);
  const rng = new RNG(seed ^ 0x5eed);
  const g = map.gen;
  const w = width;
  const h = height;
  const n1 = makeNoise1D(rng);
  const n2 = makeNoise1D(rng);
  const n3 = makeNoise1D(rng);

  const gaps: number[] = [];
  for (let i = 0; i < g.gaps; i++) gaps.push(((i + 1) / (g.gaps + 1)) * w + rng.float(-80, 80));
  const peaks: number[] = [];
  for (let i = 0; i < g.peaks; i++) peaks.push(rng.float(w * 0.3, w * 0.7));

  const surf = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let y = h * g.base + (n1(x / 430) - 0.5) * g.amp + (n2(x / 150) - 0.5) * g.amp * 0.35 + (n3(x / 40) - 0.5) * g.rough;
    if (g.mesa) {
      const q = Math.round(y / 80) * 80;
      y += (q - y) * 0.75;
    }
    for (const px of peaks) y -= 300 * Math.exp(-(((x - px) / 170) ** 2));
    for (const gx of gaps) y += 560 * Math.exp(-(((x - gx) / 80) ** 2));
    const edge = Math.min(x, w - 1 - x);
    if (edge < 180) y += (1 - edge / 180) ** 2 * 380;
    surf[x] = clamp(y, 160, h - 10);
  }
  if (g.mesa) medianSmooth(surf, 6);

  for (let x = 0; x < w; x++) {
    const top = Math.floor(surf[x]);
    t.surface[x] = top;
    for (let y = top; y < h; y++) t.data[y * w + x] = EARTH;
  }

  // Floating stone platforms.
  for (let i = 0; i < g.platforms; i++) {
    const cx = rng.float(w * 0.15, w * 0.85);
    const cy = surf[Math.floor(cx)] - rng.float(170, 280);
    const rx = rng.float(60, 115);
    const ry = rng.float(14, 24);
    if (cy > 140) fillBlob(t, cx, cy, rx, ry, ROCK);
  }

  // Rock pillars rising from the ground (canyon arches, volcanic spires).
  for (let i = 0; i < g.pillars; i++) {
    const cx = rng.float(w * 0.25, w * 0.75);
    const base = surf[Math.floor(cx)];
    const hgt = rng.float(110, 190);
    const hw = rng.float(18, 28);
    for (let y = Math.max(0, Math.floor(base - hgt)); y < Math.min(h, base + 20); y++) {
      const k = 1 - (base - y) / hgt; // wider at the bottom
      const half = hw * (0.7 + 0.5 * clamp(k, 0, 1));
      for (let x = Math.floor(cx - half); x <= cx + half; x++) if (x >= 0 && x < w) t.data[y * w + x] = ROCK;
    }
  }

  // Wooden bridges over the first gaps. Spans to the nearest ground on each side.
  for (let i = 0; i < Math.min(g.bridges, gaps.length); i++) {
    const gx = Math.floor(gaps[i]);
    const deck = Math.min(surf[clamp(gx - 150, 0, w - 1)], surf[clamp(gx + 150, 0, w - 1)]) - 4;
    if (deck > waterLevel - 60) continue;
    let left = gx;
    while (left > 0 && surf[left] > deck + 6) left--;
    let right = gx;
    while (right < w - 1 && surf[right] > deck + 6) right++;
    const y0 = Math.floor(deck);
    for (let x = left - 8; x <= right + 8; x++) {
      if (x < 0 || x >= w) continue;
      // A slight sag in the middle.
      const sag = Math.round(10 * Math.sin(((x - left) / Math.max(1, right - left)) * Math.PI));
      for (let y = y0 + sag; y < y0 + sag + 9; y++) {
        if (y >= 0 && y < h && t.data[y * w + x] === AIR) t.data[y * w + x] = WOOD;
      }
    }
  }

  // Caves under the surface.
  for (let i = 0; i < g.caves; i++) {
    const cx = rng.float(w * 0.12, w * 0.88);
    const cy = surf[Math.floor(cx)] + rng.float(90, 220);
    const rx = rng.float(50, 120);
    const ry = rng.float(26, 50);
    if (cy < waterLevel - 60) fillBlob(t, cx, cy, rx, ry, AIR);
  }

  t.dirty = null;
  return t;
}

function medianSmooth(surface: Float64Array, radius: number): void {
  const src = Float64Array.from(surface);
  const win: number[] = [];
  for (let x = 0; x < surface.length; x++) {
    win.length = 0;
    for (let k = Math.max(0, x - radius); k <= Math.min(surface.length - 1, x + radius); k++) win.push(src[k]);
    win.sort((a, b) => a - b);
    surface[x] = win[win.length >> 1];
  }
}

/** Superellipse fill (flat-ish top and bottom) used for platforms and caves. */
function fillBlob(t: TerrainMask, cx: number, cy: number, rx: number, ry: number, value: number): void {
  const { width: w, height: h } = t;
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(h - 1, cy + ry); y++) {
    const dy = (y - cy) / ry;
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(w - 1, cx + rx); x++) {
      const dx = (x - cx) / rx;
      if (dx ** 4 + dy * dy <= 1) t.data[y * w + x] = value;
    }
  }
}
