import type { TerrainMask } from './terrain.ts';

const RING: [number, number][] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

/** True if a circle at (x, y) overlaps solid terrain. */
export function circleHits(t: TerrainMask, x: number, y: number, r: number): boolean {
  if (t.isSolid(x, y)) return true;
  for (const [c, s] of RING) if (t.isSolid(x + c * r, y + s * r)) return true;
  return false;
}

const GROUND_PROBES: [number, number][] = Array.from({ length: 7 }, (_, k) => {
  const a = Math.PI / 2 + (k - 3) * 0.3;
  return [Math.cos(a), Math.sin(a)];
});

/** True if there is terrain just beneath the circle (within ~50° of straight down). */
export function hasGround(t: TerrainMask, x: number, y: number, r: number): boolean {
  for (const [c, s] of GROUND_PROBES) if (t.isSolid(x + c * (r + 1.5), y + s * (r + 1.5))) return true;
  return false;
}

/** Approximate outward surface normal at a point by sampling nearby solid pixels. */
export function surfaceNormal(t: TerrainMask, x: number, y: number, radius = 6): { x: number; y: number } {
  let nx = 0;
  let ny = 0;
  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      if (dx * dx + dy * dy > radius * radius) continue;
      if (t.isSolid(x + dx, y + dy)) {
        nx -= dx;
        ny -= dy;
      }
    }
  }
  const len = Math.hypot(nx, ny);
  return len ? { x: nx / len, y: ny / len } : { x: 0, y: -1 };
}
