/**
 * mulberry32: a tiny 32-bit PRNG. Integer-only state, so the GDScript port
 * (godot/sim/rng.gd) produces the same sequence by masking to 32 bits.
 */
export class RNG {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(a = 0, b = 1): number {
    return a + (b - a) * this.next();
  }

  int(a: number, b: number): number {
    return Math.floor(this.float(a, b + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

/** Smooth 1D value noise in [0, 1]. */
export function makeNoise1D(rng: RNG, size = 512): (x: number) => number {
  const v = Array.from({ length: size }, () => rng.next());
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const t = f * f * (3 - 2 * f);
    const a = v[((i % size) + size) % size];
    const b = v[(((i + 1) % size) + size) % size];
    return a + (b - a) * t;
  };
}

/** Approximate standard normal sample. */
export function gaussian(rand: () => number): number {
  return (rand() + rand() + rand() - 1.5) * 2;
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function lerpAngle(a: number, b: number, t: number): number {
  const TAU = Math.PI * 2;
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * t;
}

/** Quantise to 0.01 so values survive a JSON round trip identically in every engine. */
export const q2 = (v: number): number => Math.round(v * 100) / 100;
