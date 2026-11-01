import Phaser from 'phaser';
import {
  RULES, HAZARDS, weaponById, predictPath, circleHits, strikeColumns, characterById,
  type MatchResult, type SimEvent, type WeaponDef,
} from '@wildlings/shared';
import type { CharView, Session } from './view.ts';
import type { ClientSettings } from '../settings.ts';
import { TerrainLayer } from './TerrainLayer.ts';
import { Backdrop } from './Backdrop.ts';
import { Critter } from './Critter.ts';
import { Fx } from './Fx.ts';
import { HumanInput } from './HumanInput.ts';
import { art } from './art.ts';
import { audio, type SfxName } from './audio.ts';

const W = RULES.world;
const R = RULES.character.radius;

export interface BattleHooks {
  banner(title: string, color: string, sub?: string): void;
  toast(msg: string): void;
  frame(session: Session, scene: BattleScene): void;
  gameOver(result: MatchResult): void;
  /** Weapon picked by clicking the HUD (consumed once). */
  takeUiWeapon(): string | null;
}

export interface BattleData {
  session: Session;
  settings: ClientSettings;
  hooks: BattleHooks;
}

const FIRE_SFX: Record<string, SfxName> = {
  rocket: 'fire', heavy: 'heavy', shotgun: 'shotgun', grenade: 'throw', cluster: 'throw', mine: 'throw',
  airstrike: 'airstrike', drill: 'fire', teleport: 'teleport',
};
const ROTATING = new Set(['rocket', 'heavy', 'drill', 'airbomb', 'pellet']);

export class BattleScene extends Phaser.Scene {
  session!: Session;
  settings!: ClientSettings;
  hooks!: BattleHooks;
  input2!: HumanInput;
  private terrain!: TerrainLayer;
  private backdrop!: Backdrop;
  private fx!: Fx;
  private critters = new Map<number, Critter>();
  private projectiles = new Map<number, { img: Phaser.GameObjects.Image; seen: boolean; trail: number }>();
  private props = new Map<string, { img: Phaser.GameObjects.Image; light?: Phaser.GameObjects.Image; seen: boolean }>();
  private aimGfx!: Phaser.GameObjects.Graphics;
  private crosshair!: Phaser.GameObjects.Image;
  private focus = { x: W.width / 2, y: 600 };
  private lastExplosion: { x: number; y: number } | null = null;
  private hitStop = 0;
  private overTimer = -1;
  private lastTick = 0;
  private reported = false;

  constructor() {
    super('battle');
  }

  init(data: BattleData): void {
    this.session = data.session;
    this.settings = data.settings;
    this.hooks = data.hooks;
    this.critters = new Map();
    this.projectiles = new Map();
    this.props = new Map();
    this.hitStop = 0;
    this.overTimer = -1;
    this.reported = false;
    this.lastExplosion = null;
  }

  preload(): void {
    art.preloadMap(this.load, this.textures, this.session.world.map.id);
  }

  create(): void {
    const w = this.session.world;
    Fx.makeTextures(this);
    this.backdrop = new Backdrop(this, w.map, w.terrain.width * 31 + w.map.id.length);
    this.backdrop.level = w.waterLevel;
    this.terrain = new TerrainLayer(this, w.terrain, w.map, (w.map.id.charCodeAt(0) * 7919) | 0);
    this.fx = new Fx(this, w.map.palette.dirt, w.map.palette.liquid);
    this.fx.shakeEnabled = this.settings.screenShake;
    this.aimGfx = this.add.graphics().setDepth(55);
    this.crosshair = art.image(this, 'crosshair').setDepth(56).setVisible(false);
    for (const c of w.characters) this.critters.set(c.slot, new Critter(this, c));
    this.input2 = new HumanInput(this);

    const cam = this.cameras.main;
    cam.setBounds(-500, -700, W.width + 1000, W.height + 900);
    cam.setZoom(this.zoomFor());
    const a = w.characters[w.activeSlot] ?? w.characters[0];
    if (a) {
      this.focus = { x: a.x, y: a.y };
      cam.centerOn(a.x, a.y);
    }
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.onResize, this);
      this.terrain.destroy();
      this.fx.destroy();
    });
  }

  private zoomFor(): number {
    const base = Math.min(this.scale.width / 1280, this.scale.height / 760);
    return Phaser.Math.Clamp(base * this.settings.zoom, 0.45, 2.2);
  }

  private onResize(): void {
    this.cameras.main.setZoom(this.zoomFor());
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 100) / 1000;
    const s = this.session;
    let events: SimEvent[] = [];
    if (this.hitStop > 0 && !s.online) this.hitStop -= dt;
    else events = s.update(deltaMs);
    const w = s.world;

    // Local input → commands.
    const mySlot = s.controlledSlot();
    const me = mySlot >= 0 ? w.characters[mySlot] : null;
    for (const cmd of this.input2.update(w, me, this.settings, s.online, this.hooks.takeUiWeapon())) {
      const err = s.send(cmd);
      if (err && cmd.t === 'fire') {
        this.input2.fireRejected();
        this.reject(err);
      }
    }
    for (const err of s.takeRejections?.() ?? []) {
      this.input2.fireRejected();
      this.reject(err);
    }
    if ((s as { terrainReset?: boolean }).terrainReset) {
      (s as { terrainReset?: boolean }).terrainReset = false;
      this.terrainReplaced();
    }
    const z = this.input2.zoomDelta();
    if (z !== 1) {
      this.settings.zoom = Phaser.Math.Clamp(this.settings.zoom * z, 0.5, 2.5);
      this.cameras.main.setZoom(this.zoomFor());
    }

    for (const e of events) this.handle(e);

    // Sync visuals to the world.
    for (const c of w.characters) {
      const isActive = c.slot === w.activeSlot && w.phase !== 'over';
      const view = me && c.slot === me.slot && this.input2.aim ? { ...c, aim: this.input2.aim.angle, weaponId: this.input2.aim.weaponId } : c;
      const showWeapon = isActive && (w.phase === 'aim' || w.phase === 'start') && !c.fired;
      this.critters.get(c.slot)?.update(dt, view, showWeapon, isActive, w.terrain);
    }
    this.syncProjectiles(dt);
    this.syncProps();
    this.terrain.flush();
    this.backdrop.level = w.waterLevel;
    this.backdrop.update(dt, this.cameras.main);
    this.drawAim(me);
    this.updateCamera(dt, me);
    this.turnTicks(me);
    this.hooks.frame(s, this);

    const result = s.result();
    if (result && this.overTimer < 0) this.overTimer = 2.4;
    if (this.overTimer >= 0) {
      this.overTimer -= dt;
      if (this.overTimer <= 0 && !this.reported) {
        this.reported = true;
        this.hooks.gameOver(result!);
      }
    }
  }

  private reject(err: string): void {
    const msg: Record<string, string> = {
      'no-ammo': 'Out of ammo!', cooldown: 'Still cooling down', 'blocked-target': "Can't teleport there!",
      'bad-target': 'Pick a target on the map', 'already-fired': 'Already fired this turn',
    };
    if (msg[err]) this.hooks.toast(msg[err]);
    audio.play('error');
  }

  // ------------------------------------------------------------------ events → feedback

  private handle(e: SimEvent): void {
    const w = this.session.world;
    const ch = (slot: number) => w.characters[slot];
    switch (e.e) {
      case 'turn': {
        const c = ch(e.slot);
        const info = this.session.slots[e.slot];
        const mine = this.session.controlledSlot() === e.slot;
        const sub = mine ? 'Your turn!' : info?.kind === 'bot' ? `Bot · ${info.detail}` : info?.kind === 'remote' ? 'Opponent' : 'Get ready';
        this.hooks.banner(`${c.name}'s turn`, Phaser.Display.Color.IntegerToColor(this.critters.get(e.slot)!.color).rgba, sub);
        audio.play('turn');
        this.input2.panned = false;
        this.lastExplosion = null;
        break;
      }
      case 'fire': {
        const c = ch(e.slot);
        this.critters.get(e.slot)?.onFire();
        if (e.weapon !== 'airstrike' && e.weapon !== 'teleport') this.fx.muzzle(e.x, e.y);
        if (e.weapon === 'airstrike') this.flyPlane(e.x, c?.x ?? e.x);
        audio.play(FIRE_SFX[e.weapon] ?? 'fire');
        this.input2.panned = false;
        break;
      }
      case 'carve':
        this.terrain.carved(e.x, e.y, e.r, e.r > 14);
        if (e.r <= 14 && Math.random() < 0.15) this.fx.dust(e.x, e.y, 2);
        break;
      case 'explode':
        this.fx.explosion(e.x, e.y, e.r);
        this.fx.shake(e.shake);
        audio.play(e.r >= 80 ? 'bigboom' : e.r < 30 ? 'smallboom' : 'boom');
        if (e.r >= 70) this.hitStop = 0.08;
        this.lastExplosion = { x: e.x, y: e.y };
        break;
      case 'damage': {
        const c = ch(e.slot);
        this.critters.get(e.slot)?.onHurt();
        this.fx.floatText(c.x, c.y - 34, `-${e.amount}`, e.by === e.slot ? '#ffd23f' : '#ff4d4d');
        audio.play('hurt');
        break;
      }
      case 'death': {
        const c = ch(e.slot);
        const msg = e.cause === 'water' ? `${c.name} went for a swim!` : e.cause === 'lava' ? `${c.name} got toasted!` : e.cause === 'forfeit' ? `${c.name} left the battle` : e.cause === 'void' ? `${c.name} flew off the map!` : `${c.name} is knocked out!`;
        this.hooks.toast(msg);
        audio.play('ko');
        if (e.cause === 'hp' || e.cause === 'forfeit') this.fx.poof(c.x, c.y, this.critters.get(e.slot)!.color);
        break;
      }
      case 'splash':
        this.fx.splash(e.x, w.waterLevel, e.big);
        audio.play(w.map.hazard === 'lava' ? 'sizzle' : 'splash', e.big ? 1 : 0.6);
        break;
      case 'bounce':
        audio.play('bounce', 0.7);
        break;
      case 'jump':
        audio.play('jump');
        break;
      case 'land':
        if (e.impact > 250) {
          const c = ch(e.slot);
          this.fx.dust(c.x, c.y + R, 5);
          audio.play('land', Math.min(1, e.impact / 600));
        }
        break;
      case 'teleport':
        this.fx.poof(e.fx, e.fy, 0xb28dff);
        this.fx.poof(e.x, e.y, 0xb28dff);
        break;
      case 'mineArmed':
        audio.play('beep', 0.5);
        break;
      case 'mineTrigger':
        audio.play('mine');
        break;
      case 'barrelLit': {
        const b = this.props.get(`b${e.id}`);
        if (b) this.fx.spark(b.img.x, b.img.y - 8, 10);
        break;
      }
      case 'fizzle':
        this.fx.dust(e.x, e.y, 2);
        break;
      case 'weapon':
        if (this.session.controlledSlot() === e.slot) audio.play('click');
        break;
      case 'timeUp':
        this.hooks.toast("Time's up!");
        break;
      case 'water':
        this.hooks.toast(w.map.hazard === 'lava' ? 'Sudden death: the lava is rising!' : 'Sudden death: the water is rising!');
        audio.play('water');
        break;
      case 'gameover': {
        const r = e.result;
        const winner = r.winners.map((s) => w.characters[s]?.name).filter(Boolean).join(' & ');
        const mineWon = r.winners.includes(this.session.controlledSlot()) || this.session.slots.some((s) => s.kind === 'human' && r.winners.includes(s.slot));
        this.hooks.banner(winner ? `${winner} wins!` : "It's a draw!", '#ffbe0b', 'Victory');
        audio.play(mineWon || !this.session.online ? 'win' : 'lose');
        for (const s of r.winners) this.critters.get(s)?.victory();
        break;
      }
    }
  }

  private flyPlane(tx: number, fromX: number): void {
    const dir = tx >= fromX ? 1 : -1;
    const cam = this.cameras.main;
    const y = Math.max(-100, cam.worldView.y + 60);
    const plane = art.image(this, 'plane', tx - dir * 900, y).setDepth(47).setScale(art.scale * 1.4 * dir, art.scale * 1.4);
    this.tweens.add({ targets: plane, x: tx + dir * 900, duration: 1800, onComplete: () => plane.destroy() });
  }

  private turnTicks(me: CharView | null): void {
    const w = this.session.world;
    if (!me || w.phase !== 'aim' || !(w.timeLeft >= 0) || w.timeLeft === Infinity) return;
    const sec = Math.ceil(w.timeLeft);
    if (sec !== this.lastTick) {
      this.lastTick = sec;
      if (sec <= 5 && sec > 0) audio.play('tick');
    }
  }

  // ------------------------------------------------------------------ entity sprites

  private syncProjectiles(dt: number): void {
    const w = this.session.world;
    for (const v of this.projectiles.values()) v.seen = false;
    for (const p of w.projectiles) {
      let v = this.projectiles.get(p.id);
      if (!v) {
        const key = art.has(`proj_${p.kind}`) ? `proj_${p.kind}` : 'proj_rocket';
        v = { img: art.image(this, key).setDepth(35), seen: true, trail: 0 };
        this.projectiles.set(p.id, v);
      }
      v.seen = true;
      v.img.setPosition(p.x, p.y);
      if (ROTATING.has(p.kind)) v.img.setRotation(Math.atan2(p.vy, p.vx));
      else v.img.rotation += p.vx * dt * 0.03;
      const def = weaponById(p.kind) ?? (p.kind === 'airbomb' ? weaponById('airstrike') : undefined);
      v.trail -= dt;
      if (v.trail <= 0 && (def?.trail || p.drilling)) {
        v.trail = 0.022;
        this.fx.trailAt(p.x, p.y, def?.trail === 'fire' ? 'fire' : 'smoke');
      }
    }
    for (const [id, v] of this.projectiles) {
      if (!v.seen) {
        v.img.destroy();
        this.projectiles.delete(id);
      }
    }
  }

  private syncProps(): void {
    const w = this.session.world;
    for (const v of this.props.values()) v.seen = false;
    const t = this.time.now / 1000;
    for (const m of w.mines) {
      const key = `m${m.id}`;
      let v = this.props.get(key);
      if (!v) {
        v = { img: art.image(this, 'mine_idle').setDepth(32), light: art.image(this, 'mine_light').setDepth(33), seen: true };
        this.props.set(key, v);
      }
      v.seen = true;
      v.img.setPosition(m.x, m.y + 3);
      const rate = m.state === 2 ? 14 : 3;
      const on = m.state > 0 && Math.sin(t * rate) > 0;
      v.light!.setPosition(m.x, m.y - 1).setTint(m.state === 0 ? 0x77ff77 : 0xff3b3b).setVisible(m.state === 0 || on);
    }
    for (const b of w.barrels) {
      const key = `b${b.id}`;
      let v = this.props.get(key);
      if (!v) {
        v = { img: art.image(this, 'barrel').setDepth(31), seen: true };
        this.props.set(key, v);
      }
      v.seen = true;
      v.img.setPosition(b.x, b.y);
      if (b.state === 2) v.img.setTint(Math.sin(t * 40) > 0 ? 0xffffff : 0xff9a3d);
    }
    for (const [k, v] of this.props) {
      if (!v.seen) {
        v.img.destroy();
        v.light?.destroy();
        this.props.delete(k);
      }
    }
  }

  // ------------------------------------------------------------------ aiming

  private drawAim(me: CharView | null): void {
    const g = this.aimGfx;
    g.clear();
    this.crosshair.setVisible(false);
    const w = this.session.world;
    const active = w.characters[w.activeSlot];
    if (!active || !active.alive || w.phase !== 'aim' || active.fired) return;
    const local = me && me.slot === active.slot ? this.input2.aim : null;
    const angle = local ? local.angle : active.aim;
    const power = local ? local.power : active.power;
    const weapon = weaponById(local ? local.weaponId : active.weaponId);
    if (!weapon) return;
    const color = this.critters.get(active.slot)?.color ?? 0xffffff;

    if (weapon.targeted) {
      if (!local) return;
      const t = local.target;
      if (weapon.behavior === 'teleport') {
        const ok = t.x > 20 && t.x < W.width - 20 && t.y > 20 && t.y < w.waterLevel - 30 && !circleHits(w.terrain, t.x, t.y, R + 1);
        g.lineStyle(3, ok ? 0x7cff7c : 0xff4d4d, 0.9).strokeCircle(t.x, t.y, R + 2);
        g.lineStyle(2, ok ? 0x7cff7c : 0xff4d4d, 0.5).lineBetween(active.x, active.y, t.x, t.y);
      } else {
        for (const x of strikeColumns(weapon, t.x)) {
          g.lineStyle(2, 0xff4d4d, 0.35).lineBetween(x, t.y - 600, x, t.y + 200);
          g.fillStyle(0xff4d4d, 0.8).fillTriangle(x - 6, t.y - 14, x + 6, t.y - 14, x, t.y - 4);
        }
        this.crosshair.setPosition(t.x, t.y).setVisible(true);
      }
      return;
    }

    // Direction and power: a dotted beam whose length shows power, and a power ring.
    const reach = 40 + power * 110;
    const steps = 9;
    for (let i = 1; i <= steps; i++) {
      const d = 22 + (reach - 22) * (i / steps);
      g.fillStyle(i / steps <= power + 0.01 ? color : 0xffffff, local ? 0.95 : 0.55).fillCircle(active.x + Math.cos(angle) * d, active.y + Math.sin(angle) * d, 2 + (i / steps) * 2.2);
    }
    this.crosshair.setPosition(active.x + Math.cos(angle) * (reach + 14), active.y + Math.sin(angle) * (reach + 14)).setVisible(true).setAlpha(local ? 1 : 0.6);
    g.lineStyle(4, 0x1a2140, 0.5).beginPath().arc(active.x, active.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * power).strokePath();
    g.lineStyle(2.5, color, 0.95).beginPath().arc(active.x, active.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * power).strokePath();

    // Trajectory preview for the local player. Crouching (S) extends it and adds wind.
    if (local && this.settings.aimGuide && weapon.speed) this.drawTrajectory(active, weapon, angle, power, me!.crouching);
  }

  private drawTrajectory(c: CharView, weapon: WeaponDef, angle: number, power: number, steady: boolean): void {
    const w = this.session.world;
    const g = this.aimGfx;
    const pred = predictPath({
      terrain: w.terrain, characters: w.characters, barrels: w.barrels, wind: steady ? w.wind : 0, waterLevel: w.waterLevel,
      owner: c.slot, weapon, x: c.x, y: c.y, angle, power, maxTime: (weapon.aimGuide ?? 0.4) * (steady ? 3 : 1.4),
    });
    const pts = pred.points;
    for (let i = 4; i < pts.length; i += 4) {
      const k = 1 - i / pts.length;
      g.fillStyle(0xffffff, 0.25 + k * 0.6).fillCircle(pts[i].x, pts[i].y, 1.5 + k * 1.8);
    }
    if (steady && pred.impact) {
      const blast = weapon.sub ? weapon.radius : weapon.radius;
      g.lineStyle(2, 0xff4d4d, 0.85).strokeCircle(pred.impact.x, pred.impact.y, blast);
      g.fillStyle(0xff4d4d, 0.12).fillCircle(pred.impact.x, pred.impact.y, blast);
    }
  }

  // ------------------------------------------------------------------ camera

  private updateCamera(dt: number, me: CharView | null): void {
    const cam = this.cameras.main;
    const w = this.session.world;
    if (this.input2.panned) return;
    const active = w.characters[w.activeSlot];
    let fx = active?.x ?? W.width / 2;
    let fy = active?.y ?? 600;
    if (w.projectiles.length) {
      const p = w.projectiles[0];
      fx = p.x;
      fy = Math.max(p.y, -200); // don't chase shots far above the map
    } else if (w.phase === 'action' || w.phase === 'settle' || w.phase === 'over') {
      const moving = w.characters.find((c) => !c.drowned && !c.onGround && c.alive);
      const f = moving ?? this.lastExplosion ?? active;
      if (f) {
        fx = f.x;
        fy = f.y;
      }
    } else if (w.phase === 'aim' && me && active && me.slot === active.slot && this.input2.aim) {
      const t = this.input2.aim.target;
      fx += Phaser.Math.Clamp((t.x - active.x) * 0.25, -300, 300);
      fy += Phaser.Math.Clamp((t.y - active.y) * 0.25, -200, 200);
    }
    const k = 1 - Math.exp(-dt * (w.projectiles.length ? 6 : 3.5));
    this.focus.x += (fx - this.focus.x) * k;
    this.focus.y += (fy - this.focus.y) * k;
    cam.centerOn(this.focus.x, this.focus.y);
  }

  /** Called after a full terrain resync (online reconnect / drift repair). */
  terrainReplaced(): void {
    this.terrain.repaintAll();
  }

  speciesName(slot: number): string {
    return characterById(this.session.world.characters[slot]?.species).name;
  }
}

export const BARREL_RADIUS = HAZARDS.barrel.bodyRadius;
