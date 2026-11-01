import { RULES, WEAPONS, HAZARDS, type ProjectileDef, type BlastDef } from '../spec.ts';
import { circleHits, hasGround, surfaceNormal } from './physics.ts';
import type { TerrainMask } from './terrain.ts';
import type { PlayerStats } from './types.ts';

const C = RULES.character;
const W = RULES.world;

export interface MoveInput {
  move: number;
  up: boolean;
  down: boolean;
}

/** A critter on the battlefield. (x, y) is the centre of its collision circle. */
export class Character {
  slot: number;
  name: string;
  species: string;
  team: number;
  hp: number;
  maxHp: number;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  onGround = false;
  alive = true;
  drowned = false;
  facing = 1;
  aim = -Math.PI / 4;
  power = 0.6;
  energy: number = C.maxEnergy;
  crouching = false;
  fired = false;
  weaponId = 'rocket';
  inventory: Record<string, number>;
  cooldowns: Record<string, number>;
  lastAttacker = -1;
  input: MoveInput = { move: 0, up: false, down: false };
  pendingJump = false;
  stats: PlayerStats = { damageDealt: 0, damageTaken: 0, selfDamage: 0, shots: 0, hits: 0, kills: 0, turns: 0 };

  constructor(slot: number, name: string, species: string, team: number, hp: number) {
    this.slot = slot;
    this.name = name;
    this.species = species;
    this.team = team;
    this.hp = hp;
    this.maxHp = hp;
    this.inventory = Object.fromEntries(WEAPONS.map((w) => [w.id, w.ammo]));
    this.cooldowns = Object.fromEntries(WEAPONS.map((w) => [w.id, 0]));
  }

  canUse(id: string): boolean {
    const n = this.inventory[id];
    return n !== undefined && n !== 0 && (this.cooldowns[id] ?? 0) <= 0;
  }

  /** First usable weapon at or after the current one. */
  ensureWeapon(): void {
    if (this.canUse(this.weaponId)) return;
    const i = WEAPONS.findIndex((w) => w.id === this.weaponId);
    for (let k = 1; k <= WEAPONS.length; k++) {
      const w = WEAPONS[(i + k) % WEAPONS.length];
      if (this.canUse(w.id)) {
        this.weaponId = w.id;
        return;
      }
    }
  }

  /** Walk along the surface, climbing slopes. Holding up allows steeper steps at extra cost. */
  walk(dir: number, dt: number, terrain: TerrainMask, boost: boolean): number {
    if (!this.onGround || this.energy <= 0) return 0;
    const R = C.radius;
    const maxUp = boost ? C.boostClimb : C.maxClimb;
    let budget = C.walkSpeed * dt;
    let cost = 0;
    let moved = 0;
    while (budget > 0) {
      const dx = dir * Math.min(1, budget);
      budget -= 1;
      let stepped = -1;
      for (let up = 0; up <= maxUp; up++) {
        if (!circleHits(terrain, this.x + dx, this.y - up, R)) {
          this.x += dx;
          this.y -= up;
          stepped = up;
          break;
        }
      }
      if (stepped < 0) break;
      moved += Math.abs(dx);
      cost += Math.abs(dx) * C.energyPerPx * (stepped > C.maxClimb ? C.boostCostMul : 1);
      for (let k = 0; k < 6 && !hasGround(terrain, this.x, this.y, R) && !circleHits(terrain, this.x, this.y + 1, R); k++) this.y += 1;
      if (!hasGround(terrain, this.x, this.y, R)) {
        this.onGround = false;
        this.vx = dir * 60;
        this.vy = 0;
        break;
      }
      if (cost >= this.energy) break;
    }
    this.energy = Math.max(0, this.energy - cost);
    if (moved > 0) this.facing = dir;
    return moved;
  }

  jump(dir: number): boolean {
    if (!this.onGround || this.energy < C.jumpCost) return false;
    this.energy -= C.jumpCost;
    this.vy = C.jumpVY;
    this.vx = dir * C.jumpVX;
    this.onGround = false;
    return true;
  }

  impulse(ix: number, iy: number): void {
    this.vx += ix;
    this.vy += iy;
    this.onGround = false;
  }

  /** Airborne motion. Returns the landing impact speed, or -1 if still flying. */
  fly(dt: number, terrain: TerrainMask): number {
    const R = C.radius;
    this.vy = Math.min(this.vy + W.gravity * dt, C.maxFallSpeed);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy)) * dt));
    let sx = (this.vx * dt) / steps;
    const sy = (this.vy * dt) / steps;
    for (let i = 0; i < steps; i++) {
      if (sx) {
        if (!circleHits(terrain, this.x + sx, this.y, R)) this.x += sx;
        else if (!circleHits(terrain, this.x + sx, this.y - 2, R)) {
          this.x += sx;
          this.y -= 2;
        } else {
          this.vx *= -0.3;
          sx = 0;
        }
      }
      if (!circleHits(terrain, this.x, this.y + sy, R)) {
        this.y += sy;
        continue;
      }
      if (sy > 0) {
        if (hasGround(terrain, this.x, this.y, R)) {
          const impact = this.vy;
          this.vx = 0;
          this.vy = 0;
          this.onGround = true;
          return impact;
        }
        // Caught on a steep edge: nudge off it so we never hang in mid-air.
        const n = surfaceNormal(terrain, this.x, this.y + R, R);
        const nudge = n.x >= 0 ? 1 : -1;
        if (!circleHits(terrain, this.x + nudge, this.y, R)) this.x += nudge;
        this.vy *= 0.5;
      } else {
        this.vy = 0;
      }
      break;
    }
    return -1;
  }
}

/** Anything a projectile flies through: the live match, or the bot's dry-run world. */
export interface ProjWorld {
  readonly terrain: TerrainMask;
  readonly wind: number;
  readonly waterLevel: number;
  readonly dry: boolean;
  readonly characters: readonly Character[];
  readonly barrels: readonly Barrel[];
  nextId(): number;
  random(): number;
  explode(pr: Projectile, x: number, y: number, def: BlastDef, directSlot: number): void;
  spawn(pr: Projectile): void;
  splash(pr: Projectile, x: number): void;
  tunnel(x: number, y: number, r: number): void;
  bounced(pr: Projectile, x: number, y: number, speed: number): void;
  settleMine(pr: Projectile): void;
  fizzle(pr: Projectile): void;
}

export class Projectile {
  id: number;
  def: ProjectileDef;
  owner: number;
  shotId: number;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  fuse: number;
  age = 0;
  alive = true;
  leftOwner: boolean;
  drilling = false;
  drilled = 0;
  travelled = 0;
  rest = 0;

  constructor(world: ProjWorld, def: ProjectileDef, x: number, y: number, vx: number, vy: number, owner: number, shotId: number, leftOwner = false) {
    this.id = world.nextId();
    this.def = def;
    this.owner = owner;
    this.shotId = shotId;
    this.kind = def.sprite ?? def.id;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.radius = def.projectileRadius ?? 4;
    this.fuse = def.fuse ?? Infinity;
    this.leftOwner = leftOwner;
  }

  update(dt: number, w: ProjWorld): void {
    const d = this.def;
    this.age += dt;
    if (this.age > RULES.turn.maxProjectileAge) {
      this.alive = false;
      return;
    }
    if (d.behavior === 'mine' && this.age > (d.maxFlight ?? 6)) return w.settleMine(this);
    this.fuse -= dt;
    if (this.fuse <= 0) return this.explode(w, -1);

    if (!this.drilling) {
      this.vx += w.wind * W.windAccel * (d.wind ?? 0) * dt;
      this.vy += W.gravity * (d.gravity ?? 1) * dt;
    }

    // Sub-step at ~2px so fast projectiles never tunnel through thin terrain.
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 2));
    const sx = (this.vx * dt) / steps;
    const sy = (this.vy * dt) / steps;
    const stepLen = Math.hypot(sx, sy);
    for (let i = 0; i < steps; i++) {
      const nx = this.x + sx;
      const ny = this.y + sy;

      const hit = this.touchingCharacter(nx, ny, w);
      if (hit) {
        if (d.behavior === 'bounce' || d.behavior === 'mine') {
          const len = Math.hypot(this.x - hit.x, this.y - hit.y) || 1;
          this.bounceOff((this.x - hit.x) / len, (this.y - hit.y) / len, w);
          break;
        }
        this.x = nx;
        this.y = ny;
        return this.explode(w, hit.slot);
      }
      const barrel = this.touchingBarrel(nx, ny, w);
      if (barrel && d.behavior !== 'mine') {
        this.x = nx;
        this.y = ny;
        if (d.behavior === 'bounce') {
          const len = Math.hypot(this.x - barrel.x, this.y - barrel.y) || 1;
          this.bounceOff((this.x - barrel.x) / len, (this.y - barrel.y) / len, w);
          break;
        }
        return this.explode(w, -1);
      }

      if (this.drilling) {
        this.x = nx;
        this.y = ny;
        this.drilled += stepLen;
        w.tunnel(nx, ny, d.tunnelRadius ?? 10);
        if (this.drilled >= (d.drillDistance ?? 0)) return this.explode(w, -1);
        continue;
      }

      if (w.terrain.isSolid(nx, ny)) {
        if (d.behavior === 'bounce' || d.behavior === 'mine') {
          const n = surfaceNormal(w.terrain, nx, ny, 6);
          this.bounceOff(n.x, n.y, w);
          if (d.behavior === 'mine') this.checkRest(dt, w);
          break;
        }
        this.x = nx;
        this.y = ny;
        if (d.behavior === 'drill') {
          this.drilling = true;
          continue;
        }
        return this.explode(w, -1);
      }

      this.x = nx;
      this.y = ny;
      this.travelled += stepLen;
      if (d.maxRange && this.travelled > d.maxRange) {
        this.alive = false;
        w.fizzle(this);
        return;
      }
      if (this.y > w.waterLevel) {
        this.alive = false;
        w.splash(this, this.x);
        return;
      }
      if (this.x < -RULES.world.edgeKill || this.x > W.width + RULES.world.edgeKill) {
        this.alive = false;
        return;
      }
    }
    if (d.behavior === 'mine' && this.alive) this.checkRest(dt, w);
  }

  /** A thrown mine becomes a static mine once it stops moving on the ground. */
  private checkRest(dt: number, w: ProjWorld): void {
    if (!this.alive) return;
    const slow = Math.hypot(this.vx, this.vy) < 40;
    const grounded = w.terrain.isSolid(this.x, this.y + this.radius + 2);
    this.rest = slow && grounded ? this.rest + dt : 0;
    if (this.rest > 0.15) w.settleMine(this);
  }

  private touchingCharacter(nx: number, ny: number, w: ProjWorld): Character | null {
    const rr = C.radius + this.radius;
    for (const p of w.characters) {
      if (!p.alive) continue;
      const dx = nx - p.x;
      const dy = ny - p.y;
      const d2 = dx * dx + dy * dy;
      if (p.slot === this.owner && !this.leftOwner) {
        if (d2 > (rr + 6) ** 2) this.leftOwner = true;
        continue;
      }
      if (d2 < rr * rr) return p;
    }
    return null;
  }

  private touchingBarrel(nx: number, ny: number, w: ProjWorld): Barrel | null {
    const rr = HAZARDS.barrel.bodyRadius + this.radius;
    for (const b of w.barrels) {
      if (!b.alive) continue;
      const dx = nx - b.x;
      const dy = ny - b.y;
      if (dx * dx + dy * dy < rr * rr) return b;
    }
    return null;
  }

  private bounceOff(nx: number, ny: number, w: ProjWorld): void {
    const dot = this.vx * nx + this.vy * ny;
    if (dot < 0) {
      this.vx -= 2 * dot * nx;
      this.vy -= 2 * dot * ny;
    }
    const b = this.def.bounce ?? 0.5;
    this.vx *= b;
    this.vy *= b;
    if (Math.abs(dot) > 120) w.bounced(this, this.x, this.y, Math.abs(dot));
  }

  explode(w: ProjWorld, directSlot: number): void {
    this.alive = false;
    const d = this.def;
    w.explode(this, this.x, this.y, d, directSlot);
    if (d.sub && !w.dry) {
      const s = d.sub;
      for (let i = 0; i < s.count; i++) {
        const t = s.count > 1 ? i / (s.count - 1) - 0.5 : 0;
        const vx = t * 2 * s.spread + (w.random() - 0.5) * 40;
        const vy = -s.lift - w.random() * s.liftJitter;
        w.spawn(new Projectile(w, s, this.x, this.y - 6, vx, vy, this.owner, this.shotId, true));
      }
    }
  }
}

/** A gravity-only prop resting on the terrain (mines and barrels). */
export abstract class Prop {
  id: number;
  x: number;
  y: number;
  vy = 0;
  alive = true;
  falling = false;
  abstract readonly bodyRadius: number;

  constructor(id: number, x: number, y: number) {
    this.id = id;
    this.x = x;
    this.y = y;
  }

  /** Fall when the ground under it is blown away. Returns true when it hits the water. */
  updateBody(dt: number, terrain: TerrainMask, waterLevel: number): boolean {
    const r = this.bodyRadius;
    if (!this.falling && !terrain.isSolid(this.x, this.y + r + 1)) this.falling = true;
    if (!this.falling) return false;
    this.vy = Math.min(this.vy + W.gravity * dt, C.maxFallSpeed);
    const steps = Math.max(1, Math.ceil(this.vy * dt));
    const sy = (this.vy * dt) / steps;
    for (let i = 0; i < steps; i++) {
      if (terrain.isSolid(this.x, this.y + r + sy)) {
        this.falling = false;
        this.vy = 0;
        break;
      }
      this.y += sy;
    }
    return this.y > waterLevel;
  }
}

export class Mine extends Prop {
  readonly bodyRadius = 5;
  def: BlastDef & { armTime: number; triggerRadius: number; triggerFuse: number };
  owner: number;
  armTimer: number;
  fuse = -1; // < 0 = not triggered

  constructor(id: number, x: number, y: number, def: Mine['def'], owner: number) {
    super(id, x, y);
    this.def = def;
    this.owner = owner;
    this.armTimer = def.armTime;
  }

  get armed(): boolean {
    return this.armTimer <= 0;
  }

  get state(): number {
    return this.fuse >= 0 ? 2 : this.armed ? 1 : 0;
  }
}

export class Barrel extends Prop {
  readonly bodyRadius = HAZARDS.barrel.bodyRadius;
  fuse = -1;

  get state(): number {
    return this.fuse >= 0 ? 2 : 0;
  }
}
