import { PLAYER, WORLD } from './config.js';
import { circleHits, hasGround, surfaceNormal } from './Physics.js';
import { WEAPONS, createInventory } from './Weapon.js';

/** A critter on the battlefield. (x, y) is the centre of its collision circle. */
export class Player {
  constructor({ id, name, species, color, hp, controller }) {
    this.id = id;
    this.name = name;
    this.species = species;
    this.color = color;
    this.controller = controller;
    this.hp = hp;
    this.maxHp = hp;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.alive = true;
    this.drowned = false;
    this.facing = 1;
    this.aim = -Math.PI / 4;
    this.power = 0.6;
    this.target = null;
    this.energy = PLAYER.maxEnergy;
    this.crouching = false;
    this.inventory = createInventory();
    this.weaponIndex = 0;
    this.lastAttacker = null;
    this.stats = { damageDealt: 0, damageTaken: 0, selfDamage: 0, shots: 0, hits: 0, kills: 0, turns: 0 };
    this.anim = { t: Math.random() * 10, walk: 0, walking: 0, hurt: 0, blink: 0, nextBlink: 2 + Math.random() * 3 };
  }

  get isAI() {
    return !!this.controller?.isAI;
  }

  get weapon() {
    return WEAPONS[this.weaponIndex];
  }

  hasAmmo(i) {
    return this.inventory[WEAPONS[i].id] > 0;
  }

  selectWeapon(i) {
    if (i >= 0 && i < WEAPONS.length && this.hasAmmo(i)) this.weaponIndex = i;
  }

  selectWeaponById(id) {
    this.selectWeapon(WEAPONS.findIndex((w) => w.id === id));
  }

  cycleWeapon(dir) {
    const n = WEAPONS.length;
    for (let k = 1; k <= n; k++) {
      const i = (((this.weaponIndex + dir * k) % n) + n) % n;
      if (this.hasAmmo(i)) {
        this.weaponIndex = i;
        return;
      }
    }
  }

  ensureWeapon() {
    if (!this.hasAmmo(this.weaponIndex)) this.cycleWeapon(1);
  }

  /** Walk along the surface, climbing small slopes. Returns pixels moved. */
  walk(dir, dt, terrain) {
    if (!this.onGround || this.energy <= 0) return 0;
    const R = PLAYER.radius;
    let budget = PLAYER.walkSpeed * dt;
    let moved = 0;
    while (budget > 0) {
      const dx = dir * Math.min(1, budget);
      budget -= 1;
      let stepped = false;
      for (let up = 0; up <= PLAYER.maxClimb; up++) {
        if (!circleHits(terrain, this.x + dx, this.y - up, R)) {
          this.x += dx;
          this.y -= up;
          stepped = true;
          break;
        }
      }
      if (!stepped) break;
      moved += Math.abs(dx);
      for (let k = 0; k < 6 && !hasGround(terrain, this.x, this.y, R) && !circleHits(terrain, this.x, this.y + 1, R); k++) this.y += 1;
      if (!hasGround(terrain, this.x, this.y, R)) {
        this.onGround = false;
        this.vx = dir * 60;
        this.vy = 0;
        break;
      }
    }
    this.energy = Math.max(0, this.energy - moved * PLAYER.energyPerPx);
    if (moved > 0) {
      this.anim.walk += moved;
      this.anim.walking = 0.12;
    }
    return moved;
  }

  jump(dir) {
    if (!this.onGround || this.energy < PLAYER.jumpCost) return false;
    this.energy -= PLAYER.jumpCost;
    this.vy = PLAYER.jumpVY;
    this.vx = dir * PLAYER.jumpVX;
    this.onGround = false;
    return true;
  }

  applyImpulse(ix, iy) {
    this.vx += ix;
    this.vy += iy;
    this.onGround = false;
  }

  update(dt, game) {
    const a = this.anim;
    a.t += dt;
    a.hurt = Math.max(0, a.hurt - dt);
    a.walking = Math.max(0, a.walking - dt);
    a.blink = Math.max(0, a.blink - dt);
    a.nextBlink -= dt;
    if (a.nextBlink <= 0) {
      a.blink = 0.13;
      a.nextBlink = 2 + Math.random() * 4;
    }
    if (this.drowned) return;

    const T = game.terrain;
    if (this.onGround && !hasGround(T, this.x, this.y, PLAYER.radius)) this.onGround = false;
    if (!this.onGround) this.fly(dt, game);
    if (this.y > WORLD.waterLevel + 4) game.drown(this);
  }

  fly(dt, game) {
    const T = game.terrain;
    const R = PLAYER.radius;
    this.vy = Math.min(this.vy + WORLD.gravity * dt, 1500);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy)) * dt));
    let sx = (this.vx * dt) / steps;
    const sy = (this.vy * dt) / steps;
    for (let i = 0; i < steps; i++) {
      if (sx) {
        if (!circleHits(T, this.x + sx, this.y, R)) this.x += sx;
        else if (!circleHits(T, this.x + sx, this.y - 2, R)) {
          this.x += sx;
          this.y -= 2;
        } else {
          this.vx *= -0.3;
          sx = 0;
        }
      }
      if (!circleHits(T, this.x, this.y + sy, R)) {
        this.y += sy;
        continue;
      }
      if (sy > 0) {
        if (hasGround(T, this.x, this.y, R)) {
          this.land(game);
          return;
        }
        // Caught on a steep edge: nudge off it so we never hang in mid-air.
        const n = surfaceNormal(T, this.x, this.y + R, R);
        const nudge = n.x >= 0 ? 1 : -1;
        if (!circleHits(T, this.x + nudge, this.y, R)) this.x += nudge;
        this.vy *= 0.5;
      } else {
        this.vy = 0;
      }
      break;
    }
  }

  land(game) {
    const impact = this.vy;
    this.vx = 0;
    this.vy = 0;
    this.onGround = true;
    if (impact > PLAYER.fallSafeSpeed && this.alive) {
      game.damagePlayer(this, Math.round((impact - PLAYER.fallSafeSpeed) * PLAYER.fallDamagePerSpeed), null);
    }
    if (impact > 250) game.effects.dust(this.x, this.y + PLAYER.radius, impact);
  }
}
