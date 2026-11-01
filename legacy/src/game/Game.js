import { WORLD, PLAYER, MAPS } from './config.js';
import { Terrain } from './Terrain.js';
import { Player } from './Player.js';
import { Projectile } from './Projectile.js';
import { damageAt, launchParams } from './Weapon.js';
import { TurnManager } from './TurnManager.js';
import { AIController } from './AIController.js';
import { HumanController } from './HumanController.js';
import { circleHits, hasGround } from './Physics.js';
import { RNG } from './utils.js';
import { Camera } from '../rendering/Camera.js';
import { Effects } from '../rendering/Effects.js';
import { Renderer } from '../rendering/Renderer.js';

const STEP = 1 / 60;

/**
 * Owns one match: world state, fixed-timestep simulation and the render loop.
 * It also acts as the "world" interface that projectiles talk to.
 */
export class Game {
  constructor({ canvas, input, audio, hud, settings, match, onGameOver }) {
    this.canvas = canvas;
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    this.settings = settings;
    this.match = match;
    this.onGameOver = onGameOver;

    this.seed = match.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new RNG(this.seed);
    this.map = MAPS.find((m) => m.id === match.mapId) || this.rng.pick(MAPS);
    this.terrain = new Terrain(WORLD.width, WORLD.height, this.map, this.seed, WORLD.waterLevel);
    this.sim = false;
    this.wind = 0;
    this.time = 0;
    this.paused = false;
    this.over = false;
    this.projectiles = [];
    this.shotCounter = 0;
    this.shotHits = new Set();
    this.lastExplosion = null;

    this.camera = new Camera();
    this.effects = new Effects(this);
    this.players = this.createPlayers();
    this.spawnPlayers();
    this.turns = new TurnManager(this);
    this.renderer = new Renderer(this, canvas);
    this.frame = this.frame.bind(this);
  }

  createPlayers() {
    return this.match.players.map(
      (cfg, i) =>
        new Player({
          id: i,
          name: cfg.name,
          species: cfg.species,
          color: cfg.color,
          hp: this.settings.startHP,
          controller: cfg.ai ? new AIController(cfg.ai) : new HumanController(this.input),
        }),
    );
  }

  spawnPlayers() {
    const n = this.players.length;
    const slots = this.players.map((_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const span = WORLD.width - 500;
    this.players.forEach((p, i) => {
      let x = 250 + ((slots[i] + 0.5) / n) * span + this.rng.float(-70, 70);
      for (let tries = 0; tries < 40; tries++) {
        const top = this.terrain.surfaceAt(x);
        if (top != null && top < WORLD.waterLevel - 40) {
          p.x = x;
          p.y = top - PLAYER.radius - 1;
          while (circleHits(this.terrain, p.x, p.y, PLAYER.radius)) p.y -= 1;
          p.onGround = hasGround(this.terrain, p.x, p.y, PLAYER.radius);
          break;
        }
        x += tries % 2 ? tries * 25 : -tries * 25;
      }
      p.facing = p.x < WORLD.width / 2 ? 1 : -1;
      p.aim = p.facing > 0 ? -Math.PI / 4 : (-3 * Math.PI) / 4;
    });
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    this.running = true;
    this.last = 0;
    this.acc = 0;
    this.hud.attach(this);
    this.turns.nextTurn();
    this.camera.snapTo(this.turns.active.x, this.turns.active.y);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.renderer.destroy();
    this.hud.detach();
  }

  frame(ts) {
    if (!this.running) return;
    const dt = Math.min(0.1, this.last ? (ts - this.last) / 1000 : 0);
    this.last = ts;
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 6) {
        this.update(STEP);
        this.acc -= STEP;
        n++;
      }
      if (n >= 6) this.acc = 0;
    }
    this.handleCameraInput();
    this.input.endFrame();
    this.renderer.render();
    this.hud.update(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  update(dt) {
    this.time += dt;
    if (!this.over) this.turns.update(dt);

    const p = this.turns.active;
    if (p && this.turns.phase === 'aim' && p.alive && !this.over) {
      this.applyIntents(p, p.controller.getIntents(dt, this, p), dt);
    } else if (p) {
      p.crouching = false;
    }

    for (const pl of this.players) pl.update(dt, this);
    for (const pr of this.projectiles) if (pr.alive) pr.update(dt);
    this.projectiles = this.projectiles.filter((pr) => pr.alive);
    this.effects.update(dt);

    if (this.over) this.updateVictory(dt);
    this.updateCamera(dt);
  }

  // ---------------------------------------------------------------- actions

  applyIntents(p, it, dt) {
    if (it.selectWeaponId) p.selectWeaponById(it.selectWeaponId);
    if (it.selectIndex != null) this.uiSelectWeapon(it.selectIndex);
    if (it.weaponDelta) {
      p.cycleWeapon(it.weaponDelta);
      this.audio.play('click');
    }
    if (it.aim != null) {
      p.aim = it.aim;
      p.facing = Math.cos(it.aim) >= 0 ? 1 : -1;
    }
    if (it.power != null) p.power = it.power;
    if (it.target) p.target = it.target;

    p.crouching = !!it.crouch && p.onGround && !it.move;
    if (it.move && p.onGround && !p.crouching) {
      const moved = p.walk(it.move, dt, this.terrain);
      if (!moved && p.energy <= 0 && !p.isAI && !this.warnedEnergy) {
        this.warnedEnergy = true;
        this.hud.toast('Out of energy!');
      }
    }
    if (it.jump && p.onGround) {
      if (p.jump(it.move)) this.audio.play('jump');
      else if (!p.isAI) this.hud.toast('Not enough energy to jump');
    }
    if (it.fire) this.fire(p);
  }

  uiSelectWeapon(index) {
    const p = this.turns.active;
    if (!p || p.isAI || this.turns.phase !== 'aim') return;
    if (!p.hasAmmo(index)) {
      this.audio.play('error');
      return;
    }
    p.selectWeapon(index);
    this.audio.play('click');
  }

  fire(p) {
    const w = p.weapon;
    if (p.inventory[w.id] <= 0) {
      this.hud.toast('Out of ammo!');
      return;
    }
    const shotId = ++this.shotCounter;

    if (w.behavior === 'teleport') {
      const t = p.target;
      if (!t || !this.canStandAt(t.x, t.y)) {
        if (!p.isAI) this.hud.toast("Can't teleport there!");
        this.audio.play('error');
        return;
      }
      this.effects.poof(p.x, p.y, p.color);
      p.x = t.x;
      p.y = t.y;
      p.vx = p.vy = 0;
      p.onGround = false;
      this.effects.poof(p.x, p.y, p.color);
      this.audio.play('teleport');
    } else if (w.targeted === 'column') {
      const tx = p.target ? p.target.x : p.x;
      for (let i = 0; i < w.count; i++) {
        const off = (i / (w.count - 1) - 0.5) * w.spread + this.rng.float(-15, 15);
        this.spawn(new Projectile(this, w, tx + off - this.wind * 120, -120 - i * 110, this.wind * 40, 380, p, { shotId, leftOwner: true }));
      }
      this.audio.play('meteor');
    } else if (w.pellets) {
      for (let i = 0; i < w.pellets; i++) {
        const a = p.aim + (i / (w.pellets - 1) - 0.5) * 2 * w.spread + this.rng.float(-0.015, 0.015);
        const L = launchParams(p, a, 1, w);
        this.spawn(new Projectile(this, w, L.x, L.y, L.vx, L.vy, p, { shotId }));
      }
      const L = launchParams(p, p.aim, 1, w);
      this.effects.muzzle(L.x, L.y, p.aim);
      this.audio.play('shotgun');
    } else {
      const L = launchParams(p, p.aim, p.power, w);
      this.spawn(new Projectile(this, w, L.x, L.y, L.vx, L.vy, p, { shotId }));
      if (w.behavior === 'bounce') this.audio.play('throw');
      else {
        this.effects.muzzle(L.x, L.y, p.aim);
        this.audio.play('fire');
      }
    }

    if (w.ammo !== Infinity) p.inventory[w.id]--;
    p.stats.shots++;
    p.crouching = false;
    this.camera.free = false;
    this.turns.onFired();
  }

  canStandAt(x, y) {
    return x > 20 && x < WORLD.width - 20 && y > 20 && y < WORLD.waterLevel - 30 && !circleHits(this.terrain, x, y, PLAYER.radius + 1);
  }

  // ---------------------------------------------------------------- world interface (used by projectiles)

  spawn(projectile) {
    this.projectiles.push(projectile);
  }

  random() {
    return this.rng.next();
  }

  sound(name) {
    this.audio.play(name);
  }

  explode(x, y, def, owner, shotId) {
    if (def.terrain > 0) this.terrain.carve(x, y, def.radius * def.terrain);
    const reach = def.radius + PLAYER.radius;
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < reach) {
        const f = 1 - d / reach;
        const nx = d ? (p.x - x) / d : 0;
        const ny = d ? (p.y - y) / d : -1;
        const k = def.knockback * f;
        p.applyImpulse(nx * k, ny * k - k * 0.45);
      }
      const dmg = damageAt(d, def);
      if (dmg > 0) {
        this.damagePlayer(p, dmg, owner);
        if (owner && p !== owner && !this.shotHits.has(shotId)) {
          this.shotHits.add(shotId);
          owner.stats.hits++;
        }
      }
    }
    this.effects.explosion(x, y, def.radius);
    if (this.settings.screenShake) this.camera.shake(def.shake ?? def.radius * 0.15);
    this.audio.play(def.radius >= 80 ? 'bigboom' : 'boom');
    this.lastExplosion = { x, y };
  }

  splash(x, y) {
    this.effects.splash(x, y, 0.6);
    this.audio.play('splash');
  }

  // ---------------------------------------------------------------- health and deaths

  damagePlayer(p, amount, attacker) {
    if (!p.alive || amount <= 0) return;
    const real = Math.min(p.hp, amount);
    p.hp -= real;
    p.anim.hurt = 0.5;
    p.stats.damageTaken += real;
    if (attacker && attacker !== p) {
      attacker.stats.damageDealt += real;
      p.lastAttacker = attacker;
    } else if (attacker === p) {
      p.stats.selfDamage += real;
    }
    this.effects.floatText(p.x, p.y - 34, `-${amount}`, '#ff3b3b');
    this.audio.play('hurt');
  }

  drown(p) {
    if (p.drowned) return;
    p.drowned = true;
    this.effects.splash(p.x, WORLD.waterLevel, 1.4);
    this.audio.play('splash');
    if (p.alive) {
      p.hp = 0;
      p.alive = false;
      this.creditKill(p);
      this.hud.toast(`${p.name} went for a swim!`);
    }
  }

  resolveDeaths() {
    for (const p of this.players) {
      if (p.alive && p.hp <= 0) {
        p.alive = false;
        this.effects.poof(p.x, p.y, p.color);
        this.creditKill(p);
        this.hud.toast(`${p.name} is knocked out!`);
        this.audio.play('ko');
      }
    }
  }

  creditKill(p) {
    const k = p.lastAttacker;
    if (k && k !== p) k.stats.kills++;
  }

  isSettled() {
    return this.projectiles.length === 0 && this.players.every((p) => p.drowned || p.onGround);
  }

  checkGameOver() {
    const alive = this.players.filter((p) => p.alive);
    if (alive.length > 1) return false;
    this.finish(alive[0] || null);
    return true;
  }

  finish(winner) {
    this.over = true;
    this.winner = winner;
    this.turns.setPhase('over');
    this.finishTimer = 2.4;
    this.audio.play('win');
    this.hud.banner(winner ? `${winner.name} wins!` : "It's a draw!", winner ? winner.color : '#ffffff', 'Victory');
  }

  updateVictory(dt) {
    const w = this.winner;
    if (w && w.onGround && w.alive) {
      w.vy = -230;
      w.onGround = false;
    }
    this.finishTimer -= dt;
    if (this.finishTimer <= 0 && !this.reported) {
      this.reported = true;
      this.onGameOver(this.results());
    }
  }

  results() {
    const players = [...this.players].sort((a, b) => (b === this.winner) - (a === this.winner) || b.stats.damageDealt - a.stats.damageDealt);
    return { winner: this.winner, players, turns: this.turns.turnNumber, duration: this.time, map: this.map.name };
  }

  onTurnStart(p) {
    this.warnedEnergy = false;
    const humans = this.players.filter((q) => !q.isAI).length;
    const sub = p.isAI ? 'Bot turn' : humans > 1 ? 'Your turn - grab the mouse!' : 'Your turn!';
    this.hud.banner(`${p.name}'s turn`, p.color, sub);
    this.audio.play('turn');
    this.camera.free = false;
  }

  // ---------------------------------------------------------------- camera

  handleCameraInput() {
    const d = this.input.consumeDrag();
    if (d.x || d.y) this.camera.pan(d.x, d.y);
    if (this.input.wasPressed('Equal') || this.input.wasPressed('NumpadAdd')) this.camera.zoomBy(1.15);
    if (this.input.wasPressed('Minus') || this.input.wasPressed('NumpadSubtract')) this.camera.zoomBy(1 / 1.15);
  }

  updateCamera(dt) {
    const cam = this.camera;
    const ph = this.turns.phase;
    const p = this.turns.active;
    if (!cam.free && p) {
      let fx = p.x;
      let fy = p.y;
      if (this.projectiles.length) {
        const pr = this.projectiles[0];
        fx = pr.x;
        fy = pr.y;
      } else if (ph === 'action' || ph === 'settle' || ph === 'over') {
        const moving = this.players.find((q) => !q.drowned && !q.onGround);
        const focus = ph === 'over' && this.winner ? this.winner : moving || this.lastExplosion || p;
        fx = focus.x;
        fy = focus.y;
      } else if (ph === 'aim' && !p.isAI && p.target) {
        fx += (p.target.x - p.x) * 0.25;
        fy += (p.target.y - p.y) * 0.25;
      }
      cam.follow(fx, fy);
    }
    cam.update(dt);
  }
}
