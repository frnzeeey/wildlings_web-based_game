const RING = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

/** True if a circle at (x, y) overlaps solid terrain. */
export function circleHits(terrain, x, y, r) {
  if (terrain.isSolid(x, y)) return true;
  for (const [c, s] of RING) if (terrain.isSolid(x + c * r, y + s * r)) return true;
  return false;
}

/** True if there is terrain just beneath the circle (within ~50° of straight down). */
export function hasGround(terrain, x, y, r) {
  for (let i = -3; i <= 3; i++) {
    const a = Math.PI / 2 + i * 0.3;
    if (terrain.isSolid(x + Math.cos(a) * (r + 1.5), y + Math.sin(a) * (r + 1.5))) return true;
  }
  return false;
}

/** Approximate outward surface normal at a point by sampling nearby solid pixels. */
export function surfaceNormal(terrain, x, y, radius = 6) {
  let nx = 0;
  let ny = 0;
  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      if (dx * dx + dy * dy > radius * radius) continue;
      if (terrain.isSolid(x + dx, y + dy)) {
        nx -= dx;
        ny -= dy;
      }
    }
  }
  const len = Math.hypot(nx, ny);
  return len ? { x: nx / len, y: ny / len } : { x: 0, y: -1 };
}
