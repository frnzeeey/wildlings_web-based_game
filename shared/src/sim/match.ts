import { RULES, HAZARDS, mapById, MAPS, weaponById, type BlastDef, type MapDef, type WeaponDef } from '../spec.ts';
import { RNG, clamp, q2 } from '../rng.ts';
import { TerrainMask } from './terrain.ts';
import { generateTerrain } from './terrain-gen.ts';
import { circleHits, hasGround } from './physics.ts';
import { damageAt, launchParams, pelletAngles, strikeColumns } from './weapons.ts';
import { Character, Projectile, Mine, Barrel, type ProjWorld } from './entities.ts';
import {
  FLAG_ALIVE, FLAG_CROUCH, FLAG_DROWNED, FLAG_FIRED, FLAG_GROUND,
  type Command, type CommandResult, type MatchPlayerConfig, type MatchResult, type MatchSettings,
  type Phase, type SimEvent, type Snapshot, type DeathCause,
} from './types.ts';

const C = RULES.character;
const W = RULES.world;
const T = RULES.turn;
export const DT = 1 / W.tickRate;

export const DEFAULT_SETTINGS: MatchSettings = { turnTime: T.defaultTime, wind: 'normal', startHP: C.hp, suddenDeath: true };

export interface MatchOptions {
  mapId: string;
  seed: number;
  players: MatchPlayerConfig[];
  settings?: Partial<MatchSettings>;
}

/**
 * One match: the authoritative game rules. Runs identically in the browser (vs bot) and on the
 * server (online). Mutate only through command(); advance with step(); read events and snapshot().
 */
export class Match implements ProjWorld {
  readonly seed: number;
  readonly map: MapDef;
  readonly settings: MatchSettings;
  readonly terrain: TerrainMask;
  readonly characters: Character[];
  readonly rng: RNG;
  readonly dry = false;
  projectiles: Projectile[] = [];
  mines: Mine[] = [];
  barrels: Barrel[] = [];
  events: SimEvent[] = [];
  tick = 0;
  phase: Phase = 'idle';
  phaseTime = 0;
  calm = 0;
  turnNumber = 0;
  activeSlot = -1;
  timeLeft = 0;
  wind = 0;
  waterLevel: number = W.waterLevel;
  result: MatchResult | null = null;
  private order: number[];
  private idCounter = 0;
  private shotCounter = 0;
  private shotHits = new Set<number>();

  constructor(opts: MatchOptions) {
    this.seed = opts.seed >>> 0;
    this.rng = new RNG(this.seed);
    this.map = mapById(opts.mapId) ?? MAPS[0];
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.terrain = generateTerrain(this.map, this.seed, W.width, W.height, W.waterLevel);
    this.characters = opts.players.map((p, i) => new Character(i, p.name, p.species, p.team, this.settings.startHP));
    // Alternate teams in turn order: A1, B1, A2, B2...
    this.order = this.characters
      .map((c) => c.slot)
      .sort((a, b) => this.teamIndex(a) - this.teamIndex(b) || this.characters[a].team - this.characters[b].team);
    this.spawnCharacters();
    this.spawnProps();
  }

  private teamIndex(slot: number): number {
    const c = this.characters[slot];
    return this.characters.filter((o) => o.team === c.team && o.slot < slot).length;
  }

  get active(): Character | null {
    return this.characters[this.activeSlot] ?? null;
  }

  // ------------------------------------------------------------------ setup

  private spawnCharacters(): void {
    const n = this.characters.length;
    const slots = this.characters.map((_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const { margin, jitter } = this.map.spawn;
    const span = W.width - margin * 2;
    this.characters.forEach((p, i) => {
      let x = margin + ((slots[i] + 0.5) / n) * span + this.rng.float(-jitter, jitter);
      for (let tries = 0; tries < 60; tries++) {
        const top = this.terrain.surfaceAt(x, 0, this.waterLevel);
        const l = this.terrain.surfaceAt(x - 12, 0, this.waterLevel);
        const r = this.terrain.surfaceAt(x + 12, 0, this.waterLevel);
        const flat = top != null && l != null && r != null && Math.abs(l - top) < 8 + tries && Math.abs(r - top) < 8 + tries;
        if (flat && top < this.waterLevel - 40) {
          p.x = x;
          p.y = top - C.radius - 1;
          while (circleHits(this.terrain, p.x, p.y, C.radius)) p.y -= 1;
          while (!hasGround(this.terrain, p.x, p.y, C.radius) && !circleHits(this.terrain, p.x, p.y + 1, C.radius)) p.y += 1;
          p.onGround = hasGround(this.terrain, p.x, p.y, C.radius);
          // Wedged on a slope: let normal physics settle it before the match starts.
          for (let k = 0; k < 120 && !p.onGround; k++) p.fly(DT, this.terrain);
          break;
        }
        x += tries % 2 ? tries * 9 : -tries * 9;
      }
      p.facing = p.x < W.width / 2 ? 1 : -1;
      p.aim = p.facing > 0 ? -Math.PI / 4 : (-3 * Math.PI) / 4;
    });
  }

  private spawnProps(): void {
    const place = (minGap: number): { x: number; y: number } | null => {
      for (let tries = 0; tries < 30; tries++) {
        const x = this.rng.float(W.width * 0.12, W.width * 0.88);
        const y = this.terrain.surfaceAt(x, 0, this.waterLevel);
        if (y == null || y > this.waterLevel - 50) continue;
        const near = [...this.characters, ...this.barrels, ...this.mines].some((o) => Math.abs(o.x - x) < minGap);
        if (!near) return { x, y };
      }
      return null;
    };
    for (let i = 0; i < this.map.gen.barrels; i++) {
      const p = place(110);
      if (p) this.barrels.push(new Barrel(this.nextId(), q2(p.x), p.y - HAZARDS.barrel.bodyRadius - 0.5));
    }
    for (let i = 0; i < this.map.gen.fieldMines; i++) {
      const p = place(140);
      if (p) this.mines.push(new Mine(this.nextId(), q2(p.x), p.y - 5.5, HAZARDS.fieldMine, -1));
    }
  }

  start(): void {
    if (this.phase === 'idle') this.nextTurn();
  }

  // ------------------------------------------------------------------ commands

  /** Validate and apply a command from `slot`. Never trusts the caller. */
  command(slot: number, cmd: Command): CommandResult {
    const p = this.characters[slot];
    if (!p) return { ok: false, error: 'bad-slot' };
    if (this.phase === 'over') return { ok: false, error: 'match-over' };
    if (slot !== this.activeSlot) return { ok: false, error: 'not-your-turn' };
    if (!p.alive) return { ok: false, error: 'dead' };
    if (!cmd || typeof cmd !== 'object') return { ok: false, error: 'bad-command' };
    const aiming = this.phase === 'aim';

    switch (cmd.t) {
      case 'input': {
        if (!aiming) return { ok: false, error: 'wrong-phase' };
        const move = Number(cmd.move);
        p.input.move = move > 0 ? 1 : move < 0 ? -1 : 0;
        p.input.up = !!cmd.up;
        p.input.down = !!cmd.down;
        return { ok: true };
      }
      case 'jump':
        if (!aiming) return { ok: false, error: 'wrong-phase' };
        if (!p.onGround) return { ok: false, error: 'airborne' };
        if (p.energy < C.jumpCost) return { ok: false, error: 'no-energy' };
        p.pendingJump = true;
        return { ok: true };
      case 'aim': {
        if (!aiming && this.phase !== 'start') return { ok: false, error: 'wrong-phase' };
        const a = Number(cmd.angle);
        const pw = Number(cmd.power);
        if (!Number.isFinite(a) || !Number.isFinite(pw)) return { ok: false, error: 'bad-aim' };
        p.aim = normAngle(a);
        p.power = clamp(pw, 0, 1);
        p.facing = Math.cos(p.aim) >= 0 ? 1 : -1;
        return { ok: true };
      }
      case 'weapon': {
        if (!aiming && this.phase !== 'start') return { ok: false, error: 'wrong-phase' };
        if (!weaponById(String(cmd.id))) return { ok: false, error: 'unknown-weapon' };
        if (!p.canUse(cmd.id)) return { ok: false, error: 'weapon-unavailable' };
        if (p.weaponId !== cmd.id) {
          p.weaponId = cmd.id;
          this.emit({ e: 'weapon', slot, id: cmd.id });
        }
        return { ok: true };
      }
      case 'fire':
        return this.fire(p, cmd);
      case 'skip':
        if (!aiming) return { ok: false, error: 'wrong-phase' };
        this.endAim();
        return { ok: true };
      default:
        return { ok: false, error: 'bad-command' };
    }
  }

  private fire(p: Character, cmd: Extract<Command, { t: 'fire' }>): CommandResult {
    if (this.phase !== 'aim') return { ok: false, error: 'wrong-phase' };
    if (p.fired) return { ok: false, error: 'already-fired' };
    const w = weaponById(String(cmd.weapon));
    if (!w) return { ok: false, error: 'unknown-weapon' };
    if (p.inventory[w.id] === 0) return { ok: false, error: 'no-ammo' };
    if ((p.cooldowns[w.id] ?? 0) > 0) return { ok: false, error: 'cooldown' };
    const angle = Number(cmd.angle);
    const power = Number(cmd.power);
    if (!Number.isFinite(angle) || !Number.isFinite(power) || power < 0 || power > 1) return { ok: false, error: 'bad-aim' };
    let tx = 0;
    let ty = 0;
    if (w.targeted) {
      tx = Number(cmd.tx);
      ty = Number(cmd.ty);
      if (!Number.isFinite(tx) || !Number.isFinite(ty) || tx < 0 || tx > W.width || ty < -600 || ty > W.height) {
        return { ok: false, error: 'bad-target' };
      }
      if (w.behavior === 'teleport' && !this.canStandAt(tx, ty)) return { ok: false, error: 'blocked-target' };
    }

    p.weaponId = w.id;
    p.aim = normAngle(angle);
    p.power = power;
    p.facing = Math.cos(p.aim) >= 0 ? 1 : -1;
    const shotId = ++this.shotCounter;

    if (w.behavior === 'teleport') {
      const fx = p.x;
      const fy = p.y;
      p.x = q2(tx);
      p.y = q2(ty);
      p.vx = p.vy = 0;
      p.onGround = false;
      this.emit({ e: 'teleport', slot: p.slot, fx, fy, x: p.x, y: p.y });
    } else if (w.behavior === 'strike') {
      const dir = tx >= p.x ? 1 : -1;
      for (const x of strikeColumns(w, tx)) {
        const pr = new Projectile(this, w, x - dir * (w.dropDrift ?? 0) * 0.4, w.dropHeight ?? -140, dir * (w.dropDrift ?? 0), w.dropSpeed ?? 300, p.slot, shotId, true);
        this.spawn(pr);
      }
      this.emit({ e: 'fire', slot: p.slot, weapon: w.id, x: tx, y: 0, angle: p.aim });
    } else {
      const pw = w.fixedPower ? 1 : power;
      for (const a of pelletAngles(w, p.aim)) {
        const L = launchParams(p.x, p.y, a, pw, w);
        this.spawn(new Projectile(this, w, L.x, L.y, L.vx, L.vy, p.slot, shotId));
      }
      const L = launchParams(p.x, p.y, p.aim, pw, w);
      this.emit({ e: 'fire', slot: p.slot, weapon: w.id, x: q2(L.x), y: q2(L.y), angle: p.aim });
    }

    if (w.ammo > 0) p.inventory[w.id]--;
    if (w.cooldown > 0) p.cooldowns[w.id] = w.cooldown + 1; // +1: this turn's own decrement
    p.fired = true;
    p.stats.shots++;
    p.crouching = false;
    p.input = { move: 0, up: false, down: false };
    this.setPhase('action');
    return { ok: true };
  }

  canStandAt(x: number, y: number): boolean {
    return x > 20 && x < W.width - 20 && y > 20 && y < this.waterLevel - 30 && !circleHits(this.terrain, x, y, C.radius + 1);
  }

  /** Remove a player from the match (disconnect timeout, resign). */
  forfeit(slot: number): void {
    const p = this.characters[slot];
    if (!p || !p.alive || this.phase === 'over') return;
    p.alive = false;
    p.hp = 0;
    this.emit({ e: 'death', slot, cause: 'forfeit' });
    if (!this.checkGameOver() && slot === this.activeSlot) this.endAim();
  }

  // ------------------------------------------------------------------ simulation

  step(): void {
    if (this.phase === 'idle') return;
    this.tick++;
    this.updateTurn(DT);

    const p = this.active;
    if (p && this.phase === 'aim' && p.alive) this.applyMovement(p, DT);
    else if (p) p.crouching = false;

    for (const c of this.characters) this.updateCharacter(c, DT);
    for (const pr of this.projectiles) if (pr.alive) pr.update(DT, this);
    this.projectiles = this.projectiles.filter((pr) => pr.alive);
    this.updateMines(DT);
    this.updateBarrels(DT);
  }

  private applyMovement(p: Character, dt: number): void {
    const inp = p.input;
    p.crouching = inp.down && p.onGround && !inp.move;
    if (inp.move && p.onGround && !p.crouching) p.walk(inp.move, dt, this.terrain, inp.up);
    if (p.pendingJump) {
      p.pendingJump = false;
      if (p.jump(inp.move)) this.emit({ e: 'jump', slot: p.slot });
    }
  }

  private updateCharacter(c: Character, dt: number): void {
    if (c.drowned) return;
    if (c.onGround && !hasGround(this.terrain, c.x, c.y, C.radius)) c.onGround = false;
    if (!c.onGround) {
      const impact = c.fly(dt, this.terrain);
      if (impact >= 0) {
        this.emit({ e: 'land', slot: c.slot, impact: Math.round(impact) });
        if (impact > C.fallSafeSpeed && c.alive) {
          this.damage(c, Math.round((impact - C.fallSafeSpeed) * C.fallDamagePerSpeed), -1);
        }
      }
    }
    if (c.y > this.waterLevel + 4) this.drown(c, this.map.hazard === 'lava' ? 'lava' : 'water');
    else if (c.x < -RULES.world.edgeKill || c.x > W.width + RULES.world.edgeKill) this.drown(c, 'void');
  }

  private updateMines(dt: number): void {
    for (const m of this.mines) {
      if (!m.alive) continue;
      if (m.updateBody(dt, this.terrain, this.waterLevel)) {
        m.alive = false;
        this.emit({ e: 'splash', x: q2(m.x), big: false });
        continue;
      }
      if (!m.armed) {
        m.armTimer -= dt;
        if (m.armed) this.emit({ e: 'mineArmed', id: m.id });
        continue;
      }
      if (m.fuse < 0) {
        const reach = m.def.triggerRadius + C.radius;
        const near = this.characters.some((c) => c.alive && !c.drowned && Math.hypot(c.x - m.x, c.y - m.y) < reach);
        if (near) {
          m.fuse = m.def.triggerFuse;
          this.emit({ e: 'mineTrigger', id: m.id });
        }
      } else {
        m.fuse -= dt;
        if (m.fuse <= 0) {
          m.alive = false;
          this.blast(m.x, m.y, m.def, m.owner, -1, 0);
        }
      }
    }
    this.mines = this.mines.filter((m) => m.alive);
  }

  private updateBarrels(dt: number): void {
    for (const b of this.barrels) {
      if (!b.alive) continue;
      if (b.updateBody(dt, this.terrain, this.waterLevel)) {
        b.alive = false;
        this.emit({ e: 'splash', x: q2(b.x), big: false });
        continue;
      }
      if (b.fuse >= 0) {
        b.fuse -= dt;
        if (b.fuse < 0) {
          b.alive = false;
          this.blast(b.x, b.y, HAZARDS.barrel, -1, -1, 0);
        }
      }
    }
    this.barrels = this.barrels.filter((b) => b.alive);
  }

  // ------------------------------------------------------------------ world interface (projectiles)

  nextId(): number {
    return ++this.idCounter;
  }

  random(): number {
    return this.rng.next();
  }

  spawn(pr: Projectile): void {
    this.projectiles.push(pr);
  }

  explode(pr: Projectile, x: number, y: number, def: BlastDef, directSlot: number): void {
    this.blast(x, y, def, pr.owner, directSlot, pr.shotId);
  }

  splash(_pr: Projectile, x: number): void {
    this.emit({ e: 'splash', x: q2(x), big: false });
  }

  tunnel(x: number, y: number, r: number): void {
    this.carve(x, y, r);
  }

  bounced(_pr: Projectile, x: number, y: number, speed: number): void {
    if (speed > 120) this.emit({ e: 'bounce', x: q2(x), y: q2(y) });
  }

  settleMine(pr: Projectile): void {
    pr.alive = false;
    const def = pr.def as WeaponDef;
    const m = new Mine(this.nextId(), q2(pr.x), q2(pr.y), {
      id: def.id, damage: def.damage, directHit: 0, radius: def.radius, terrain: def.terrain, knockback: def.knockback,
      shake: def.shake, armTime: def.armTime ?? 1, triggerRadius: def.triggerRadius ?? 38, triggerFuse: def.triggerFuse ?? 1,
    }, pr.owner);
    this.mines.push(m);
  }

  fizzle(pr: Projectile): void {
    this.emit({ e: 'fizzle', x: q2(pr.x), y: q2(pr.y) });
  }

  private carve(x: number, y: number, r: number): void {
    const cx = q2(x);
    const cy = q2(y);
    const cr = q2(r);
    this.terrain.carve(cx, cy, cr);
    this.emit({ e: 'carve', x: cx, y: cy, r: cr });
  }

  /** Explosion: carve, knock back, damage, and set off nearby barrels and mines. */
  private blast(x: number, y: number, def: BlastDef, owner: number, directSlot: number, shotId: number): void {
    x = q2(x);
    y = q2(y);
    const tr = def.radius * (def.terrain ?? 1);
    if (tr > 0) this.carve(x, y, tr);
    const reach = def.radius + C.radius;
    const attacker = this.characters[owner];
    for (const c of this.characters) {
      if (!c.alive || c.drowned) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < reach && def.knockback) {
        const f = 1 - d / reach;
        const nx = d ? (c.x - x) / d : 0;
        const ny = d ? (c.y - y) / d : -1;
        const k = def.knockback * f;
        c.impulse(nx * k, ny * k - k * RULES.damage.knockbackLift);
      }
      let dmg = damageAt(d, def);
      if (c.slot === directSlot) dmg += def.directHit ?? 0;
      if (dmg > 0) {
        this.damage(c, dmg, owner);
        if (attacker && c.slot !== owner && shotId && !this.shotHits.has(shotId)) {
          this.shotHits.add(shotId);
          attacker.stats.hits++;
        }
      }
    }
    for (const b of this.barrels) {
      if (b.alive && b.fuse < 0 && Math.hypot(b.x - x, b.y - y) < def.radius + b.bodyRadius) {
        b.fuse = HAZARDS.barrel.fuse;
        this.emit({ e: 'barrelLit', id: b.id });
      }
    }
    for (const m of this.mines) {
      if (m.alive && Math.hypot(m.x - x, m.y - y) < def.radius + m.bodyRadius && (m.fuse < 0 || m.fuse > 0.12)) {
        m.armTimer = 0;
        m.fuse = 0.12;
      }
    }
    this.emit({ e: 'explode', x, y, r: def.radius, id: def.id, shake: def.shake ?? def.radius * 0.15 });
  }

  // ------------------------------------------------------------------ health and deaths

  private damage(c: Character, amount: number, by: number): void {
    if (!c.alive || amount <= 0) return;
    const real = Math.min(c.hp, amount);
    c.hp -= real;
    c.stats.damageTaken += real;
    const attacker = this.characters[by];
    if (attacker && attacker !== c) {
      attacker.stats.damageDealt += real;
      c.lastAttacker = by;
    } else if (attacker === c) {
      c.stats.selfDamage += real;
    }
    this.emit({ e: 'damage', slot: c.slot, amount, hp: c.hp, by });
  }

  private drown(c: Character, cause: DeathCause): void {
    if (c.drowned) return;
    c.drowned = true;
    c.vx = c.vy = 0;
    this.emit({ e: 'splash', x: q2(c.x), big: true });
    if (c.alive) {
      c.hp = 0;
      c.alive = false;
      this.creditKill(c);
      this.emit({ e: 'death', slot: c.slot, cause });
    }
  }

  private resolveDeaths(): void {
    for (const c of this.characters) {
      if (c.alive && c.hp <= 0) {
        c.alive = false;
        this.creditKill(c);
        this.emit({ e: 'death', slot: c.slot, cause: 'hp' });
      }
    }
  }

  private creditKill(c: Character): void {
    const k = this.characters[c.lastAttacker];
    if (k && k !== c) k.stats.kills++;
  }

  isSettled(): boolean {
    return (
      this.projectiles.length === 0 &&
      this.characters.every((c) => c.drowned || c.onGround || !c.alive) &&
      this.mines.every((m) => m.fuse < 0 && !m.falling) &&
      this.barrels.every((b) => b.fuse < 0 && !b.falling)
    );
  }

  private checkGameOver(): boolean {
    const teams = new Set(this.characters.filter((c) => c.alive).map((c) => c.team));
    if (teams.size > 1) return false;
    const winnerTeam = teams.size === 1 ? [...teams][0] : null;
    this.result = {
      winnerTeam,
      winners: this.characters.filter((c) => c.team === winnerTeam).map((c) => c.slot),
      turns: this.turnNumber,
      duration: Math.round(this.tick * DT),
      map: this.map.id,
      players: this.characters.map((c) => ({ slot: c.slot, name: c.name, team: c.team, alive: c.alive, stats: { ...c.stats } })),
    };
    this.setPhase('over');
    this.emit({ e: 'gameover', result: this.result });
    return true;
  }

  // ------------------------------------------------------------------ turns

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
    this.calm = 0;
  }

  private endAim(): void {
    const p = this.active;
    if (p) {
      p.input = { move: 0, up: false, down: false };
      p.pendingJump = false;
      p.crouching = false;
    }
    this.setPhase('action');
  }

  private nextTurn(): void {
    const prev = this.order.indexOf(this.activeSlot);
    for (let k = 1; k <= this.order.length; k++) {
      const s = this.order[(prev + k + this.order.length) % this.order.length];
      if (this.characters[s].alive) {
        this.activeSlot = s;
        break;
      }
    }
    const p = this.characters[this.activeSlot];
    this.turnNumber++;
    const level = (RULES.wind.levels as Record<string, number>)[this.settings.wind] ?? 1;
    const raw = clamp(this.rng.float(-1, 1) + this.map.wind.bias, -1, 1);
    this.wind = Math.round((raw * level * this.map.wind.scale) / RULES.wind.step) * RULES.wind.step;
    this.wind = Math.round(this.wind * 100) / 100;

    if (this.settings.suddenDeath && this.turnNumber > RULES.suddenDeath.startTurn) {
      const lvl = Math.max(RULES.suddenDeath.minWaterLevel, this.waterLevel - RULES.suddenDeath.waterRisePerTurn);
      if (lvl !== this.waterLevel) {
        this.waterLevel = lvl;
        this.emit({ e: 'water', level: lvl });
      }
    }

    p.energy = C.maxEnergy;
    p.crouching = false;
    p.fired = false;
    p.input = { move: 0, up: false, down: false };
    p.pendingJump = false;
    p.stats.turns++;
    for (const id of Object.keys(p.cooldowns)) if (p.cooldowns[id] > 0) p.cooldowns[id]--;
    p.ensureWeapon();
    this.timeLeft = this.settings.turnTime > 0 ? this.settings.turnTime : Infinity;
    this.setPhase('start');
    this.emit({
      e: 'turn', slot: p.slot, turn: this.turnNumber, wind: this.wind, time: this.settings.turnTime,
      water: this.waterLevel, inv: { ...p.inventory }, cd: { ...p.cooldowns },
    });
  }

  private updateTurn(dt: number): void {
    this.phaseTime += dt;
    switch (this.phase) {
      case 'start':
        if (this.phaseTime >= T.startDelay) {
          this.setPhase('aim');
          this.emit({ e: 'aimPhase', slot: this.activeSlot });
        }
        break;
      case 'aim': {
        const p = this.active;
        const teamsLeft = new Set(this.characters.filter((c) => c.alive).map((c) => c.team)).size;
        if (!p || !p.alive || p.hp <= 0 || teamsLeft <= 1) {
          this.endAim();
          break;
        }
        if (this.timeLeft !== Infinity) {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            this.emit({ e: 'timeUp', slot: p.slot });
            this.endAim();
          }
        }
        break;
      }
      case 'action':
        this.calm = this.isSettled() ? this.calm + dt : 0;
        if (this.calm >= T.settleCalm || this.phaseTime > T.actionTimeout) {
          this.resolveDeaths();
          this.setPhase('settle');
        }
        break;
      case 'settle':
        if (this.phaseTime >= T.settleMin && (this.isSettled() || this.phaseTime > T.settleTimeout)) {
          this.resolveDeaths();
          if (!this.checkGameOver()) this.nextTurn();
        }
        break;
    }
  }

  private emit(ev: SimEvent): void {
    this.events.push(ev);
  }

  takeEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ serialisation

  snapshot(): Snapshot {
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    return {
      tick: this.tick,
      ph: this.phase,
      ts: this.activeSlot,
      tn: this.turnNumber,
      tl: this.timeLeft === Infinity ? -1 : r1(this.timeLeft),
      wind: this.wind,
      water: this.waterLevel,
      c: this.characters.map((c) => ({
        s: c.slot, x: r1(c.x), y: r1(c.y), vx: r1(c.vx), vy: r1(c.vy), hp: c.hp,
        f: (c.onGround ? FLAG_GROUND : 0) | (c.alive ? FLAG_ALIVE : 0) | (c.drowned ? FLAG_DROWNED : 0) |
          (c.crouching ? FLAG_CROUCH : 0) | (c.fired ? FLAG_FIRED : 0),
        a: r3(c.aim), p: r3(c.power), d: c.facing, en: r1(c.energy), w: c.weaponId,
      })),
      pr: this.projectiles.map((p) => {
        const s: Snapshot['pr'][number] = { id: p.id, k: p.kind, x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy) };
        if (p.drilling) s.dr = 1;
        return s;
      }),
      mn: this.mines.map((m) => ({ id: m.id, x: r1(m.x), y: r1(m.y), st: m.state })),
      br: this.barrels.map((b) => ({ id: b.id, x: r1(b.x), y: r1(b.y), st: b.state })),
    };
  }
}

export function normAngle(a: number): number {
  const TAU = Math.PI * 2;
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r < -Math.PI) r += TAU;
  return r;
}
