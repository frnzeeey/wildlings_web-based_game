import { WORLD, PLAYER } from './config.js';
import { surfaceNormal } from './Physics.js';

let nextId = 1;

/**
 * A projectile in flight. `world` is either the live Game or the AI's lightweight simulation
 * world; both expose { terrain, players, wind, sim, explode, splash, spawn, random, sound }.
 */
export class Projectile {
  constructor(world, def, x, y, vx, vy, owner, opts = {}) {
    this.id = nextId++;
    this.world = world;
    this.def = def;
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.shotId = opts.shotId ?? this.id;
    this.sprite = def.sprite || def.id;
    this.radius = def.projectileRadius ?? 4;
    this.fuse = def.fuse ?? Infinity;
    this.leftOwner = !!opts.leftOwner;
    this.age = 0;
    this.spin = 0;
    this.alive = true;
    this.drilling = false;
    this.drilled = 0;
    this.trailTimer = 0;
  }

  update(dt) {
    const w = this.world;
    const d = this.def;
    this.age += dt;
    this.spin += this.vx * dt * 0.03;
    if (this.age > 12) {
      this.alive = false;
      return;
    }
    this.fuse -= dt;
    if (this.fuse <= 0) return this.explode();

    if (!this.drilling) {
      this.vx += w.wind * WORLD.windAccel * (d.wind ?? 0) * dt;
      this.vy += WORLD.gravity * (d.gravity ?? 1) * dt;
    }

    // Sub-step at ~2px so fast projectiles never tunnel through thin terrain.
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 2));
    const sx = (this.vx * dt) / steps;
    const sy = (this.vy * dt) / steps;
    for (let i = 0; i < steps; i++) {
      const nx = this.x + sx;
      const ny = this.y + sy;

      const hit = this.touchingPlayer(nx, ny);
      if (hit) {
        if (d.behavior === 'bounce') {
          const len = Math.hypot(this.x - hit.x, this.y - hit.y) || 1;
          this.bounceOff((this.x - hit.x) / len, (this.y - hit.y) / len);
          break;
        }
        this.x = nx;
        this.y = ny;
        return this.explode();
      }

      if (this.drilling) {
        this.x = nx;
        this.y = ny;
        this.drilled += Math.hypot(sx, sy);
        if (!w.sim) w.terrain.carve(nx, ny, d.tunnelRadius, false);
        if (this.drilled >= d.drillDistance) return this.explode();
        continue;
      }

      if (w.terrain.isSolid(nx, ny)) {
        if (d.behavior === 'bounce') {
          const n = surfaceNormal(w.terrain, nx, ny, 6);
          this.bounceOff(n.x, n.y);
          break;
        }
        this.x = nx;
        this.y = ny;
        if (d.behavior === 'drill') {
          this.drilling = true;
          continue;
        }
        return this.explode();
      }

      this.x = nx;
      this.y = ny;
      if (this.y > WORLD.waterLevel) {
        this.alive = false;
        w.splash(this.x, WORLD.waterLevel, this);
        return;
      }
      if (this.x < -400 || this.x > WORLD.width + 400) {
        this.alive = false;
        return;
      }
    }

    if (!w.sim && (d.trail || this.drilling)) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.025;
        w.effects.trail(this.x, this.y, this.sprite);
      }
    }
  }

  touchingPlayer(nx, ny) {
    const rr = PLAYER.radius + this.radius;
    for (const p of this.world.players) {
      if (!p.alive) continue;
      const dx = nx - p.x;
      const dy = ny - p.y;
      const d2 = dx * dx + dy * dy;
      if (p === this.owner && !this.leftOwner) {
        if (d2 > (rr + 6) ** 2) this.leftOwner = true;
        continue;
      }
      if (d2 < rr * rr) return p;
    }
    return null;
  }

  bounceOff(nx, ny) {
    const dot = this.vx * nx + this.vy * ny;
    if (dot < 0) {
      this.vx -= 2 * dot * nx;
      this.vy -= 2 * dot * ny;
    }
    const b = this.def.bounce ?? 0.5;
    this.vx *= b;
    this.vy *= b;
    if (!this.world.sim && Math.abs(dot) > 120) this.world.sound('bounce');
  }

  explode() {
    this.alive = false;
    const w = this.world;
    const d = this.def;
    w.explode(this.x, this.y, d, this.owner, this.shotId);
    if (d.sub && !w.sim) {
      const s = d.sub;
      for (let i = 0; i < s.count; i++) {
        const t = s.count > 1 ? i / (s.count - 1) - 0.5 : 0;
        const vx = t * 2 * s.spread + (w.random() - 0.5) * 40;
        const vy = -220 - w.random() * 160;
        w.spawn(new Projectile(w, s, this.x, this.y - 6, vx, vy, this.owner, { shotId: this.shotId, leftOwner: true }));
      }
    }
  }
}
