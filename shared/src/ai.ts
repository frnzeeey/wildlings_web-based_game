import { RULES, WEAPONS, HAZARDS, type BlastDef, type WeaponDef } from './spec.ts';
import { RNG, clamp, gaussian, lerp, lerpAngle } from './rng.ts';
import { Character, Projectile, type ProjWorld, type Barrel } from './sim/entities.ts';
import { damageAt, launchParams } from './sim/weapons.ts';
import { hasGround } from './sim/physics.ts';
import type { TerrainMask } from './sim/terrain.ts';
import type { Match } from './sim/match.ts';
import type { Command } from './sim/types.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Level {
  angleNoise: number;
  powerNoise: number;
  windSense: number; // how much of the wind the bot accounts for
  think: number;
  weapons: string[] | null;
  reposition: boolean;
  hazardSense: boolean; // barrels, edges, mines
  blunder: number; // chance of a clearly worse pick
}

const LEVELS: Record<Difficulty, Level> = {
  easy: { angleNoise: 0.1, powerNoise: 0.08, windSense: 0.35, think: 1.3, weapons: ['rocket', 'grenade', 'shotgun'], reposition: false, hazardSense: false, blunder: 0.25 },
  normal: { angleNoise: 0.04, powerNoise: 0.035, windSense: 0.85, think: 1.0, weapons: null, reposition: true, hazardSense: false, blunder: 0.05 },
  hard: { angleNoise: 0.016, powerNoise: 0.016, windSense: 1, think: 0.7, weapons: null, reposition: true, hazardSense: true, blunder: 0 },
};

const C = RULES.character;
const SKIP = new Set(['teleport', 'mine']);

interface Plan {
  score: number;
  weaponId: string;
  angle: number;
  power: number;
  target?: { x: number; y: number };
  walkTo?: number;
}

interface DryResult {
  x: number;
  y: number;
  water?: boolean;
  direct?: number;
}

/** A projectile world that records where the first explosion happens and changes nothing. */
class DryWorld implements ProjWorld {
  readonly dry = true;
  terrain: TerrainMask;
  wind: number;
  waterLevel: number;
  characters: readonly Character[];
  barrels: readonly Barrel[];
  result: DryResult | null = null;
  private ids = 1e6;

  constructor(m: Match, windSense: number) {
    this.terrain = m.terrain;
    this.wind = m.wind * windSense;
    this.waterLevel = m.waterLevel;
    this.characters = m.characters.filter((c) => c.alive);
    this.barrels = m.barrels;
  }
  nextId() { return ++this.ids; }
  random() { return 0.5; }
  explode(_p: Projectile, x: number, y: number, _d: BlastDef, direct: number) { this.result ??= { x, y, direct }; }
  spawn() {}
  splash(_p: Projectile, x: number) { this.result ??= { x, y: this.waterLevel, water: true }; }
  tunnel() {}
  bounced() {}
  settleMine(p: Projectile) { p.alive = false; this.result ??= { x: p.x, y: p.y }; }
  fizzle(p: Projectile) { this.result ??= { x: p.x, y: p.y, water: true }; }
}

/**
 * Bot opponent. Plans by simulating candidate shots with the real projectile code against the
 * real terrain, scores the landing spots, optionally walks somewhere better, then aims with
 * difficulty-based error. Produces the same commands a human client would.
 */
export class Bot {
  readonly difficulty: Difficulty;
  private cfg: Level;
  private rng: RNG;
  private state: 'idle' | 'think' | 'plan' | 'walk' | 'aim' | 'fire' | 'done' = 'idle';
  private timer = 0;
  private plan: Plan | null = null;
  private planner: Generator<void, Plan> | null = null;
  private walked = false;
  private aim0 = 0;
  private power0 = 0;
  private aimDur = 1;
  private lastX = 0;
  private stuck = 0;
  private turnSeen = -1;

  constructor(difficulty: Difficulty = 'normal', seed = 1) {
    this.difficulty = difficulty;
    this.cfg = LEVELS[difficulty] ?? LEVELS.normal;
    this.rng = new RNG(seed);
  }

  /** Call every tick while it is this bot's turn. `budgetMs` caps planning time per call. */
  update(dt: number, m: Match, slot: number, budgetMs = 6): Command[] {
    const me = m.characters[slot];
    if (m.turnNumber !== this.turnSeen) {
      this.turnSeen = m.turnNumber;
      this.state = 'think';
      this.timer = this.cfg.think + this.rng.float(0, 0.5);
      this.plan = null;
      this.planner = null;
      this.walked = false;
    }
    if (m.phase !== 'aim' || m.activeSlot !== slot || !me.alive) return [];
    const out: Command[] = [];
    this.timer -= dt;

    switch (this.state) {
      case 'think':
        if (this.timer <= 0 && me.onGround) {
          this.planner = this.makePlan(m, me);
          this.state = 'plan';
        }
        break;
      case 'plan': {
        const until = now() + budgetMs;
        let r = this.planner!.next();
        while (!r.done && now() < until) r = this.planner!.next();
        if (!r.done) break;
        this.plan = r.value;
        out.push({ t: 'weapon', id: this.plan.weaponId });
        if (this.plan.walkTo !== undefined && !this.walked) {
          this.walked = true;
          this.state = 'walk';
          this.timer = 4;
          this.lastX = me.x;
          this.stuck = 0;
        } else {
          this.startAim(me);
        }
        break;
      }
      case 'walk': {
        const dx = this.plan!.walkTo! - me.x;
        const dir = Math.sign(dx);
        if (Math.abs(dx) < 4 || this.timer <= 0 || me.energy <= C.jumpCost) {
          out.push({ t: 'input', move: 0, up: false, down: false });
          this.state = 'think';
          this.timer = 0.4;
          break;
        }
        out.push({ t: 'input', move: dir, up: true, down: false });
        if (Math.abs(me.x - this.lastX) < 0.2 && me.onGround) {
          this.stuck += dt;
          if (this.stuck > 0.25) {
            out.push({ t: 'jump' });
            this.stuck = 0;
          }
        } else this.stuck = 0;
        this.lastX = me.x;
        break;
      }
      case 'aim': {
        const p = this.plan!;
        const t = clamp(1 - this.timer / this.aimDur, 0, 1);
        const e = t * t * (3 - 2 * t);
        out.push({ t: 'aim', angle: lerpAngle(this.aim0, p.angle, e), power: lerp(this.power0, p.power, e) });
        if (this.timer <= 0) {
          this.state = 'fire';
          this.timer = 0.3;
        }
        break;
      }
      case 'fire':
        if (this.timer <= 0) {
          const p = this.plan!;
          out.push({ t: 'fire', weapon: p.weaponId, angle: p.angle, power: p.power, tx: p.target?.x, ty: p.target?.y });
          this.state = 'done';
        }
        break;
    }
    return out;
  }

  private startAim(me: Character): void {
    this.state = 'aim';
    this.aimDur = 0.9 + this.rng.float(0, 0.4);
    this.timer = this.aimDur;
    this.aim0 = me.aim;
    this.power0 = me.power;
  }

  // ------------------------------------------------------------------ planning

  private *makePlan(m: Match, me: Character): Generator<void, Plan> {
    const enemies = m.characters.filter((c) => c.alive && c.team !== me.team);
    const allowed = WEAPONS.filter((w) => me.canUse(w.id) && !SKIP.has(w.id) && (!this.cfg.weapons || this.cfg.weapons.includes(w.id)));
    const world = new DryWorld(m, this.cfg.windSense);
    const candidates: Plan[] = [];

    for (const w of allowed) {
      const c = yield* this.bestShot(world, m, me, me.x, me.y, w, enemies);
      if (c) candidates.push(c);
    }
    candidates.sort((a, b) => b.score - a.score);
    let best: Plan = candidates[0] ?? { score: -Infinity, weaponId: 'rocket', angle: me.aim, power: me.power };
    if (candidates.length > 1 && this.rng.next() < this.cfg.blunder) best = candidates[1];

    // Nothing good from here: look for a better spot within walking range.
    if (!this.walked && best.score < 18 && me.energy > 40) {
      if (this.cfg.reposition) {
        const rocket = WEAPONS.find((w) => w.id === 'rocket')!;
        for (const dist of [50, 100, 160, -50, -100, -160]) {
          const spot = this.probeWalk(m, me, dist);
          if (!spot) continue;
          const c = yield* this.bestShot(world, m, me, spot.x, spot.y, rocket, enemies, true);
          if (c && c.score > best.score + 8) best = { ...c, walkTo: spot.x };
        }
      } else if (best.score <= 0 && enemies.length) {
        const e = enemies[0];
        best = { ...best, walkTo: me.x + Math.sign(e.x - me.x) * this.rng.float(40, 110) };
      }
    }
    if (best.walkTo !== undefined) return best; // aim again after walking

    const c = this.cfg;
    best.angle += gaussian(() => this.rng.next()) * c.angleNoise;
    best.power = clamp(best.power + gaussian(() => this.rng.next()) * c.powerNoise, 0.12, 1);
    if (best.target) best.target = { x: clamp(best.target.x + gaussian(() => this.rng.next()) * c.angleNoise * 500, 0, RULES.world.width), y: best.target.y };
    return best;
  }

  private *bestShot(world: DryWorld, m: Match, me: Character, x: number, y: number, w: WeaponDef, enemies: Character[], coarse = false): Generator<void, Plan | null> {
    const scarcity = w.ammo < 0 ? 1 : w.ammo <= 1 ? 0.8 : 0.9;
    if (w.targeted === 'column') {
      let best: Plan | null = null;
      for (const e of enemies) {
        const s = this.score(m, e.x, e.y, w, me, x, y, enemies, -1) * 1.4 * scarcity;
        if (!best || s > best.score) best = { score: s, weaponId: w.id, angle: me.aim, power: me.power, target: { x: e.x, y: e.y - 200 } };
      }
      return best;
    }
    let nearest: Character | null = null;
    for (const e of enemies) if (!nearest || Math.hypot(e.x - x, e.y - y) < Math.hypot(nearest.x - x, nearest.y - y)) nearest = e;

    if (w.pellets) {
      if (!nearest || Math.hypot(nearest.x - x, nearest.y - y) > (w.maxRange ?? 500) * 0.8) return null;
      const a = Math.atan2(nearest.y - y, nearest.x - x);
      let best: Plan | null = null;
      for (const da of [-0.06, 0, 0.06]) {
        const r = this.simulate(world, w, me, x, y, a + da, 1);
        if (!r || r.water) continue;
        const s = this.score(m, r.x, r.y, w, me, x, y, enemies, r.direct ?? -1) * (w.pellets ?? 1) * 0.65 * scarcity;
        if (!best || s > best.score) best = { score: s, weaponId: w.id, angle: a + da, power: 1 };
      }
      return best;
    }

    // Coarse sweep over angle x power, then refine around the best candidate.
    let local: Plan | null = null;
    const evalShot = (a: number, pw: number) => {
      const r = this.simulate(world, w, me, x, y, a, pw);
      const s = !r ? -1000 : r.water ? -100 : this.score(m, r.x, r.y, w, me, x, y, enemies, r.direct ?? -1);
      if (!local || s > local.score) local = { score: s, weaponId: w.id, angle: a, power: pw };
    };
    const aStep = coarse ? 0.14 : 0.09;
    const pStep = coarse ? 0.15 : 0.1;
    for (let a = -Math.PI - 0.45; a <= 0.45; a += aStep) {
      for (let pw = 0.3; pw <= 1.001; pw += pStep) evalShot(a, pw);
      yield;
    }
    const base: Plan = { ...local! };
    for (let da = -0.08; da <= 0.081; da += 0.02) {
      for (let dp = -0.08; dp <= 0.081; dp += 0.02) evalShot(base.angle + da, clamp(base.power + dp, 0.15, 1));
      yield;
    }
    const l = local! as Plan;
    return { ...l, score: l.score * (w.sub ? 1.25 : 1) * scarcity };
  }

  private simulate(world: DryWorld, w: WeaponDef, me: Character, x: number, y: number, angle: number, power: number): DryResult | null {
    world.result = null;
    const L = launchParams(x, y, angle, w.fixedPower ? 1 : power, w);
    const pr = new Projectile(world, w, L.x, L.y, L.vx, L.vy, me.slot, 0);
    const dt = 1 / RULES.world.tickRate;
    for (let t = 0; t < 7 && pr.alive && !world.result; t += dt) pr.update(dt, world);
    return world.result as DryResult | null;
  }

  /** Expected value of an explosion at (x, y): damage to enemies minus risk to self. */
  private score(m: Match, x: number, y: number, w: BlastDef, me: Character, sx: number, sy: number, enemies: Character[], direct: number): number {
    let s = 0;
    let minD = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      minD = Math.min(minD, d);
      let dmg = damageAt(d, w) + (e.slot === direct ? (w.directHit ?? 0) : 0);
      if (this.cfg.hazardSense) {
        for (const b of m.barrels) {
          if (Math.hypot(b.x - x, b.y - y) < w.radius + b.bodyRadius) dmg += damageAt(Math.hypot(e.x - b.x, e.y - b.y), HAZARDS.barrel) * 0.8;
        }
        if (dmg > 0 && this.nearDrop(m.terrain, m.waterLevel, e.x, Math.sign(e.x - x) || 1)) dmg += 18;
      }
      if (dmg > 0) s += dmg + (dmg >= e.hp ? 40 : 0);
    }
    let self = damageAt(Math.hypot(sx - x, sy - y), w);
    if (this.cfg.hazardSense) {
      for (const b of m.barrels) {
        if (Math.hypot(b.x - x, b.y - y) < w.radius + b.bodyRadius) self += damageAt(Math.hypot(sx - b.x, sy - b.y), HAZARDS.barrel);
      }
    }
    if (self > 0) s -= self * 2.5 + (self >= me.hp ? 200 : 0);
    if (s === 0) s = -minD * 0.05;
    return s;
  }

  /** Is there a fall into the hazard just past x in direction dir? */
  private nearDrop(t: TerrainMask, water: number, x: number, dir: number): boolean {
    for (const off of [40, 80, 120]) {
      const top = t.surfaceAt(x + dir * off, 0, water);
      if (top == null) return true;
    }
    return false;
  }

  /** Simulate walking `dist` px on a copy of the bot. Returns where it ends up if that's safe. */
  private probeWalk(m: Match, me: Character, dist: number): { x: number; y: number } | null {
    const c = new Character(me.slot, me.name, me.species, me.team, me.hp);
    Object.assign(c, { x: me.x, y: me.y, onGround: true, energy: me.energy - 25 });
    const dir = Math.sign(dist);
    const dt = 1 / RULES.world.tickRate;
    for (let i = 0; i < 400 && Math.abs(c.x - me.x) < Math.abs(dist); i++) {
      if (!c.walk(dir, dt, m.terrain, true)) break;
      if (!c.onGround) return null; // walked off a ledge
    }
    if (Math.abs(c.x - me.x) < Math.abs(dist) * 0.6) return null;
    if (!hasGround(m.terrain, c.x, c.y, C.radius) || c.y > m.waterLevel - 60) return null;
    if (m.mines.some((mn) => Math.hypot(mn.x - c.x, mn.y - c.y) < 70)) return null;
    return { x: c.x, y: c.y };
  }
}

const perf = (globalThis as { performance?: { now(): number } }).performance;
const now = (): number => (perf ? perf.now() : Date.now());
