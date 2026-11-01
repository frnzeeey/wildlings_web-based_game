import { RULES, type BlastDef, type WeaponDef } from '../spec.ts';
import { Projectile, type Barrel, type Character, type ProjWorld } from './entities.ts';
import { launchParams } from './weapons.ts';
import type { TerrainMask } from './terrain.ts';

export interface PredictInput {
  terrain: TerrainMask;
  characters: readonly { slot: number; x: number; y: number; alive: boolean }[];
  barrels: readonly { x: number; y: number }[];
  wind: number;
  waterLevel: number;
  owner: number;
  weapon: WeaponDef;
  x: number;
  y: number;
  angle: number;
  power: number;
  maxTime: number;
}

export interface Prediction {
  points: { x: number; y: number }[];
  impact: { x: number; y: number } | null;
}

/** Trajectory preview for aim guides, using the real projectile code against the real terrain. */
export function predictPath(p: PredictInput): Prediction {
  let impact: { x: number; y: number } | null = null;
  const world: ProjWorld = {
    terrain: p.terrain,
    wind: p.wind,
    waterLevel: p.waterLevel,
    dry: true,
    characters: p.characters as unknown as Character[],
    barrels: p.barrels.map((b) => ({ ...b, alive: true })) as unknown as Barrel[],
    nextId: () => 0,
    random: () => 0.5,
    explode: (_pr: Projectile, x: number, y: number, _d: BlastDef) => void (impact ??= { x, y }),
    spawn: () => {},
    splash: (_pr: Projectile, x: number) => void (impact ??= { x, y: p.waterLevel }),
    tunnel: () => {},
    bounced: () => {},
    settleMine: (pr: Projectile) => {
      pr.alive = false;
      impact ??= { x: pr.x, y: pr.y };
    },
    fizzle: (pr: Projectile) => void (impact ??= { x: pr.x, y: pr.y }),
  };
  const L = launchParams(p.x, p.y, p.angle, p.weapon.fixedPower ? 1 : p.power, p.weapon);
  const pr = new Projectile(world, p.weapon, L.x, L.y, L.vx, L.vy, p.owner, 0);
  const dt = 1 / RULES.world.tickRate;
  const points = [{ x: L.x, y: L.y }];
  for (let t = 0; t < p.maxTime && pr.alive; t += dt) {
    pr.update(dt, world);
    points.push({ x: pr.x, y: pr.y });
  }
  return { points, impact: pr.alive ? null : impact };
}
