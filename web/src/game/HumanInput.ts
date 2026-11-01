import Phaser from 'phaser';
import { RULES, WEAPONS, clamp, weaponById, type Command } from '@wildlings/shared';
import type { CharView, WorldView } from './view.ts';
import type { ClientSettings } from '../settings.ts';

const C = RULES.character;

/** Where the local player is aiming right now (shown immediately, before any server echo). */
export interface LocalAim {
  angle: number;
  power: number;
  target: { x: number; y: number };
  weaponId: string;
}

/**
 * Keyboard + mouse → commands for the controlled critter. Holds no game rules: everything it
 * produces is validated again by the Match (locally or on the server).
 */
export class HumanInput {
  private scene: Phaser.Scene;
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private clicked = false;
  /** Edge-triggered keys, queued from keydown events so very quick taps are never lost. */
  private pressed = new Set<string>();
  private wheel = 0;
  private lastWheel = 0;
  private sentMove = { move: 0, up: false, down: false };
  private lastAimSent = 0;
  private lastAim = { angle: NaN, power: NaN };
  private firedTurn = -1;
  private powerOverride: number | null = null;
  drag: { x: number; y: number } | null = null;
  panned = false;
  aim: LocalAim | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const kb = scene.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      w: K.W, a: K.A, s: K.S, d: K.D, left: K.LEFT, right: K.RIGHT, up: K.UP, down: K.DOWN, space: K.SPACE,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    kb.addCapture([K.SPACE, K.UP, K.DOWN, K.LEFT, K.RIGHT]);
    kb.on('keydown', (e: KeyboardEvent) => {
      if (!e.repeat) this.pressed.add(e.code);
    });
    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown() || p.middleButtonDown()) this.drag = { x: p.x, y: p.y };
      else if (p.leftButtonDown()) this.clicked = true;
    });
    scene.input.on('pointerup', () => (this.drag = null));
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag) return;
      const cam = scene.cameras.main;
      cam.scrollX -= (p.x - this.drag.x) / cam.zoom;
      cam.scrollY -= (p.y - this.drag.y) / cam.zoom;
      this.drag = { x: p.x, y: p.y };
      this.panned = true;
    });
    scene.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const now = performance.now();
      if (dy === 0 || now - this.lastWheel < 90) return;
      this.lastWheel = now;
      this.wheel = Math.sign(dy);
    });
  }

  zoomDelta(): number {
    const p = this.pressed;
    let z = 1;
    if (p.has('Equal') || p.has('NumpadAdd')) z = 1.15;
    if (p.has('Minus') || p.has('NumpadSubtract')) z = 1 / 1.15;
    for (const k of ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract']) p.delete(k);
    return z;
  }

  /** Produce this frame's commands for `me` (null = not our turn). */
  update(world: WorldView, me: CharView | null, settings: ClientSettings, online: boolean, uiWeapon: string | null): Command[] {
    const out: Command[] = [];
    const clicked = this.clicked;
    const wheel = this.wheel;
    this.clicked = false;
    this.wheel = 0;
    const k = this.keys;
    const p0 = this.pressed;
    const digit = [1, 2, 3, 4, 5, 6, 7, 8, 9].findIndex((n) => p0.has(`Digit${n}`) || p0.has(`Numpad${n}`));
    const jumpPressed = p0.has('Space');
    const nextPressed = p0.has('KeyE');
    const prevPressed = p0.has('KeyQ');
    for (const code of [...p0]) if (!['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(code)) p0.delete(code);

    const canAct = !!me && me.alive && (world.phase === 'aim' || world.phase === 'start') && world.activeSlot === me.slot;
    if (!canAct || !me) {
      this.aim = null;
      this.powerOverride = null;
      if (this.sentMove.move || this.sentMove.up || this.sentMove.down) this.sentMove = { move: 0, up: false, down: false };
      return out;
    }
    const aiming = world.phase === 'aim';

    // Movement (held keys).
    const move = (k.d.isDown || k.right.isDown ? 1 : 0) - (k.a.isDown || k.left.isDown ? 1 : 0);
    const up = k.w.isDown || k.up.isDown;
    const down = k.s.isDown || k.down.isDown;
    if (aiming && (move !== this.sentMove.move || up !== this.sentMove.up || down !== this.sentMove.down)) {
      this.sentMove = { move, up, down };
      out.push({ t: 'input', move, up, down });
    }
    if (aiming && jumpPressed) out.push({ t: 'jump' });

    // Weapon selection.
    let weaponId = this.aim?.weaponId ?? me.weaponId;
    if (!this.usable(me, weaponId)) weaponId = me.weaponId;
    let cycle = (nextPressed ? 1 : 0) - (prevPressed ? 1 : 0);
    if (settings.wheelMode === 'weapon') cycle += wheel;
    if (cycle) weaponId = this.cycle(me, weaponId, Math.sign(cycle));
    if (digit >= 0 && WEAPONS[digit] && this.usable(me, WEAPONS[digit].id)) weaponId = WEAPONS[digit].id;
    if (uiWeapon && this.usable(me, uiWeapon)) weaponId = uiWeapon;
    if (weaponId !== me.weaponId && weaponId !== this.aim?.weaponId) out.push({ t: 'weapon', id: weaponId });

    // Aim from the mouse: direction from the critter, power from distance (or wheel in power mode).
    const p = this.scene.input.activePointer;
    const wp = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    const angle = Math.atan2(wp.y - me.y, wp.x - me.x);
    let power = clamp(Math.hypot(wp.x - me.x, wp.y - me.y) / C.maxAimDistance, 0.1, 1);
    if (settings.wheelMode === 'power') {
      if (this.powerOverride === null) this.powerOverride = me.power;
      if (wheel) this.powerOverride = clamp(this.powerOverride - wheel * 0.03, 0.05, 1);
      power = this.powerOverride;
    }
    if (weaponById(weaponId)?.fixedPower) power = 1;
    this.aim = { angle, power, target: { x: wp.x, y: wp.y }, weaponId };

    const now = performance.now();
    const minGap = online ? 1000 / RULES.net.aimSendRate : 0;
    const changed = Math.abs(angle - this.lastAim.angle) > 0.002 || Math.abs(power - this.lastAim.power) > 0.002;
    if (changed && now - this.lastAimSent >= minGap) {
      this.lastAimSent = now;
      this.lastAim = { angle, power };
      out.push({ t: 'aim', angle, power });
    }

    if (clicked && aiming && !me.fired && this.firedTurn !== world.turnNumber && this.usable(me, weaponId)) {
      this.firedTurn = world.turnNumber;
      out.push({ t: 'fire', weapon: weaponId, angle, power, tx: wp.x, ty: wp.y });
    }
    return out;
  }

  /** Un-mark a fire attempt that was rejected so the player can try again. */
  fireRejected(): void {
    this.firedTurn = -1;
  }

  usable(me: CharView, id: string): boolean {
    const n = me.inventory[id];
    return n !== undefined && n !== 0 && (me.cooldowns[id] ?? 0) <= 0;
  }

  private cycle(me: CharView, from: string, dir: number): string {
    const i = WEAPONS.findIndex((w) => w.id === from);
    for (let k = 1; k <= WEAPONS.length; k++) {
      const w = WEAPONS[(((i + dir * k) % WEAPONS.length) + WEAPONS.length) % WEAPONS.length];
      if (this.usable(me, w.id)) return w.id;
    }
    return from;
  }
}
