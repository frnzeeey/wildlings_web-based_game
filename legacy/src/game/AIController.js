import { PLAYER } from './config.js';
import { WEAPONS, launchParams, damageAt } from './Weapon.js';
import { Projectile } from './Projectile.js';
import { emptyIntents } from './Intents.js';
import { clamp, gaussian, lerp, lerpAngle } from './utils.js';

const LEVELS = {
  easy: { angleNoise: 0.11, powerNoise: 0.08, windSense: 0.35, think: 1.3, weapons: ['rocket', 'grenade', 'shotgun'] },
  normal: { angleNoise: 0.045, powerNoise: 0.04, windSense: 0.85, think: 1.0, weapons: null },
  hard: { angleNoise: 0.012, powerNoise: 0.012, windSense: 1, think: 0.7, weapons: null },
};

/**
 * Bot opponent. It plans by simulating candidate shots with the real Projectile physics
 * against the real terrain, scores the landing spots, then aims (with difficulty-based error).
 */
export class AIController {
  constructor(difficulty = 'normal') {
    this.isAI = true;
    this.difficulty = difficulty;
    this.cfg = LEVELS[difficulty] || LEVELS.normal;
  }

  beginTurn() {
    this.state = 'think';
    this.timer = this.cfg.think + Math.random() * 0.5;
    this.plan = null;
    this.walked = false;
  }

  getIntents(dt, game, me) {
    const it = emptyIntents();
    this.timer -= dt;

    if (this.state === 'think') {
      if (this.timer <= 0 && me.onGround) {
        this.plan = this.makePlan(game, me);
        if (this.plan.walk && !this.walked) {
          this.walked = true;
          this.state = 'walk';
          this.timer = this.plan.walk.time;
          this.lastX = me.x;
          this.stuck = 0;
        } else {
          this.startAim(me);
        }
      }
    } else if (this.state === 'walk') {
      it.move = this.plan.walk.dir;
      if (Math.abs(me.x - this.lastX) < 0.2 && me.onGround) {
        this.stuck += dt;
        if (this.stuck > 0.25) {
          it.jump = true;
          this.stuck = 0;
        }
      } else this.stuck = 0;
      this.lastX = me.x;
      if (this.timer <= 0 || me.energy <= PLAYER.jumpCost) {
        this.state = 'think';
        this.timer = 0.5;
      }
    } else if (this.state === 'aim' || this.state === 'fire') {
      const p = this.plan;
      it.selectWeaponId = p.weaponId;
      it.target = p.target;
      if (this.state === 'aim') {
        const t = clamp(1 - this.timer / this.aimDur, 0, 1);
        const e = t * t * (3 - 2 * t);
        it.aim = lerpAngle(this.aim0, p.angle, e);
        it.power = lerp(this.power0, p.power, e);
        if (this.timer <= 0) {
          this.state = 'fire';
          this.timer = 0.3;
        }
      } else {
        it.aim = p.angle;
        it.power = p.power;
        if (this.timer <= 0) {
          it.fire = true;
          this.state = 'done';
        }
      }
    }
    return it;
  }

  startAim(me) {
    this.state = 'aim';
    this.aimDur = 0.9 + Math.random() * 0.4;
    this.timer = this.aimDur;
    this.aim0 = me.aim;
    this.power0 = me.power;
  }

  makePlan(game, me) {
    const enemies = game.players.filter((p) => p.alive && p !== me);
    const allowed = WEAPONS.filter(
      (w) => me.inventory[w.id] > 0 && w.behavior !== 'teleport' && (!this.cfg.weapons || this.cfg.weapons.includes(w.id)),
    );
    const sim = this.makeSim(game);
    let best = { score: -Infinity, weaponId: 'rocket', angle: me.aim, power: me.power };
    const consider = (c) => {
      if (c.score > best.score) best = c;
    };
    let nearest = null;
    let nearestDist = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - me.x, e.y - me.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = e;
      }
    }

    for (const w of allowed) {
      const scarcity = w.ammo === Infinity ? 1 : w.ammo <= 1 ? 0.8 : 0.9;

      if (w.targeted === 'column') {
        for (const e of enemies) {
          const s = this.score(e.x, e.y, w, me, enemies) * 1.5 * scarcity;
          consider({ score: s, weaponId: w.id, angle: me.aim, power: me.power, target: { x: e.x, y: e.y } });
        }
        continue;
      }

      if (w.pellets) {
        if (!nearest || nearestDist > 420) continue;
        const a = Math.atan2(nearest.y - me.y, nearest.x - me.x);
        for (const da of [-0.06, 0, 0.06]) {
          const r = this.simulate(sim, w, me, a + da, 1);
          if (r && !r.water) consider({ score: this.score(r.x, r.y, w, me, enemies) * w.pellets * 0.7 * scarcity, weaponId: w.id, angle: a + da, power: 1 });
        }
        continue;
      }

      // Coarse sweep over angle x power, then refine around the best candidate.
      let local = null;
      const evalShot = (a, pw) => {
        const r = this.simulate(sim, w, me, a, pw);
        const s = !r ? -1000 : r.water ? -100 : this.score(r.x, r.y, w, me, enemies);
        if (!local || s > local.score) local = { score: s, angle: a, power: pw };
      };
      for (let a = -Math.PI - 0.45; a <= 0.45; a += 0.09) for (let pw = 0.3; pw <= 1.001; pw += 0.1) evalShot(a, pw);
      const base = { ...local };
      for (let da = -0.08; da <= 0.081; da += 0.02) for (let dp = -0.08; dp <= 0.081; dp += 0.02) evalShot(base.angle + da, clamp(base.power + dp, 0.15, 1));
      consider({ ...local, score: local.score * (w.sub ? 1.3 : 1) * scarcity, weaponId: w.id });
    }

    // No useful shot from here: walk toward the nearest enemy first, then re-plan.
    if (best.score <= 0 && me.energy > 40 && nearest) {
      best.walk = { dir: Math.sign(nearest.x - me.x) || 1, time: 0.9 + Math.random() * 0.9 };
    }

    const c = this.cfg;
    best.angle += gaussian() * c.angleNoise;
    best.power = clamp(best.power + gaussian() * c.powerNoise, 0.12, 1);
    if (best.target) best.target = { x: best.target.x + gaussian() * c.angleNoise * 500, y: best.target.y };
    return best;
  }

  makeSim(game) {
    const sim = {
      sim: true,
      terrain: game.terrain,
      players: game.players.filter((p) => p.alive),
      wind: game.wind * this.cfg.windSense,
      result: null,
      random: () => 0.5,
      explode(x, y) {
        sim.result = { x, y };
      },
      splash(x, y) {
        sim.result = { x, y, water: true };
      },
      spawn() {},
      sound() {},
    };
    return sim;
  }

  simulate(sim, weapon, me, angle, power) {
    sim.result = null;
    const L = launchParams(me, angle, power, weapon);
    const pr = new Projectile(sim, weapon, L.x, L.y, L.vx, L.vy, me);
    const dt = 1 / 60;
    for (let t = 0; t < 7 && pr.alive; t += dt) pr.update(dt);
    return sim.result;
  }

  score(x, y, w, me, enemies) {
    let s = 0;
    let minD = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      minD = Math.min(minD, d);
      const dmg = damageAt(d, w);
      if (dmg > 0) s += dmg + (dmg >= e.hp ? 40 : 0);
    }
    const sd = damageAt(Math.hypot(me.x - x, me.y - y), w);
    if (sd > 0) s -= sd * 2.5 + (sd >= me.hp ? 200 : 0);
    if (s === 0) s = -minD * 0.05;
    return s;
  }
}
