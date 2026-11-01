import { RULES, type BlastDef, type WeaponDef } from '../spec.ts';

const C = RULES.character;

/** Damage to a character whose centre is `dist` px from the blast. Contact = full damage. */
export function damageAt(dist: number, def: BlastDef): number {
  if (!def.damage) return 0;
  const eff = Math.max(0, dist - C.radius - RULES.damage.contactPad);
  if (eff >= def.radius) return 0;
  return Math.round(def.damage * (1 - eff / def.radius));
}

/** Muzzle position and launch velocity. Shared by the match, the bot planner and aim guides. */
export function launchParams(x: number, y: number, angle: number, power: number, w: WeaponDef) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const speed = w.fixedPower ? (w.speed ?? 0) : (w.speed ?? 0) * (0.15 + 0.85 * power);
  return { x: x + c * C.muzzleOffset, y: y - C.muzzleLift + s * C.muzzleOffset, vx: c * speed, vy: s * speed };
}

/** Fan offsets for multi-pellet weapons, in radians. Deterministic so every engine matches. */
export function pelletAngles(w: WeaponDef, angle: number): number[] {
  const n = w.pellets ?? 1;
  if (n <= 1) return [angle];
  return Array.from({ length: n }, (_, i) => angle + (i / (n - 1) - 0.5) * 2 * (w.spread ?? 0));
}

/** X positions of an air strike's bombs around the target. */
export function strikeColumns(w: WeaponDef, tx: number): number[] {
  const n = w.count ?? 1;
  return Array.from({ length: n }, (_, i) => tx + (i - (n - 1) / 2) * (w.spacing ?? 0));
}
