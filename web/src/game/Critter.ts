import Phaser from 'phaser';
import { RULES, TEAM_COLORS, type TerrainMask } from '@wildlings/shared';
import type { CharView } from './view.ts';
import { art, type SpeciesRig } from './art.ts';

const R = RULES.character.radius;
const PIVOT = 14; // the pose rotates around the body centre, 14px above the feet

interface Eye {
  white: Phaser.GameObjects.Image;
  pupil: Phaser.GameObjects.Image;
  closed: Phaser.GameObjects.Image;
  hurt: Phaser.GameObjects.Image;
  happy: Phaser.GameObjects.Image;
  brow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  r: number;
  far: boolean;
}

/**
 * A critter assembled from the shared SVG parts and animated procedurally (docs/ART_DIRECTION.md
 * "Motion"). Every species has its own body plan; anchors come from the art manifest.
 * godot/game/critter.gd implements the same rig and timings.
 */
export class Critter {
  readonly root: Phaser.GameObjects.Container;
  readonly color: number;
  private scene: Phaser.Scene;
  private rig: SpeciesRig;
  private pose: Phaser.GameObjects.Container;
  private tail?: Phaser.GameObjects.Image;
  private footB: Phaser.GameObjects.Image;
  private footF: Phaser.GameObjects.Image;
  private body: Phaser.GameObjects.Image;
  private head: Phaser.GameObjects.Image;
  private mouth: Phaser.GameObjects.Image;
  private eyes: Eye[];
  private arm: Phaser.GameObjects.Container;
  private weapon: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Image;
  private ring: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private bar: Phaser.GameObjects.Graphics;
  private tomb: Phaser.GameObjects.Image | null = null;
  private t = Math.random() * 10;
  private walk = 0;
  private walking = 0;
  private lastX = 0;
  private hurt = 0;
  private flash = 0;
  private recoil = 0;
  private blink = 0;
  private nextBlink = 1 + Math.random() * 3;
  private glance = 0;
  private glanceX = 0;
  private sq = 0; // squash (-) / stretch (+)
  private sqVel = 0;
  private spin = 0;
  private wasGround = true;
  private happy = false;
  private shownHp = -1;
  private weaponKey = '';
  private gone = false;

  constructor(scene: Phaser.Scene, c: CharView) {
    this.scene = scene;
    this.color = Phaser.Display.Color.HexStringToColor(TEAM_COLORS[c.team % TEAM_COLORS.length]).color;
    const sp = c.species;
    const info = (this.rig = art.species(sp));
    const add = (key: string, x = 0, y = 0) => art.image(scene, key, x, y + PIVOT);
    // Each species wears a team-coloured garment (hat, scarf, backpack, belt...) in its own layer.
    const team = add(`${sp}_team`).setTint(this.color);
    this.tail = art.has(`${sp}_tail`) ? add(`${sp}_tail`) : undefined;
    this.footB = add(`${sp}_foot`, info.feet[0][0], info.feet[0][1]);
    this.body = add(`${sp}_body`);
    this.head = add(`${sp}_head`);
    this.eyes = info.eyes.map((e) => {
      const k = art.scale * (e.r / 4);
      return {
        white: add('eye_white', e.x, e.y).setScale(k),
        pupil: add('eye_pupil', e.x, e.y).setScale(k),
        closed: add('eye_closed', e.x, e.y).setScale(k).setVisible(false),
        hurt: add('eye_hurt', e.x, e.y).setScale(e.far ? -k : k, k).setVisible(false),
        happy: add('eye_happy', e.x, e.y).setScale(k).setVisible(false),
        brow: add('brow', e.x, e.y - e.r - 2.6).setScale(e.far ? -k : k, k),
        ...e,
      };
    });
    this.mouth = add('mouth_open', info.mouth.x, info.mouth.y).setVisible(false);
    this.footF = add(`${sp}_foot`, info.feet[1][0], info.feet[1][1]);
    this.weapon = art.image(scene, 'held_rocket');
    const hand = art.image(scene, `${sp}_hand`, 4, 2);
    this.arm = scene.add.container(info.arm.x, info.arm.y + PIVOT, [this.weapon, hand]);
    const parts = [
      info.team === 'back' ? team : undefined, this.tail, this.footB, this.body, info.team === 'body' ? team : undefined,
      this.head, info.team === 'head' ? team : undefined,
      ...this.eyes.flatMap((e) => [e.white, e.pupil, e.closed, e.hurt, e.happy, e.brow]), this.mouth, this.footF, this.arm,
    ];
    this.pose = scene.add.container(0, -PIVOT, parts.filter(Boolean) as Phaser.GameObjects.GameObject[]);
    this.label = scene.add.text(0, info.top - 12, c.name, {
      fontFamily: 'Fredoka, sans-serif', fontSize: '13px', color: '#ffffff', stroke: '#16203f', strokeThickness: 5, fontStyle: '600',
    }).setOrigin(0.5, 1).setResolution(2);
    this.bar = scene.add.graphics();
    this.root = scene.add.container(c.x, c.y + R, [this.pose, this.bar, this.label]).setDepth(30);
    this.shadow = art.image(scene, 'shadow').setDepth(29);
    this.ring = scene.add.graphics().setDepth(29);
    this.ring.lineStyle(2.5, this.color, 1).strokeEllipse(0, 0, 36, 10).lineStyle(1, 0xffffff, 0.8).strokeEllipse(0, 0, 31, 8);
    this.lastX = c.x;
  }

  onHurt(): void {
    this.hurt = 0.6;
    this.flash = 0.12;
  }

  onFire(): void {
    this.recoil = 1;
    this.sq = -0.1;
  }

  victory(): void {
    this.happy = true;
    this.scene.tweens.add({ targets: this.pose, y: -PIVOT - 26, duration: 260, yoyo: true, repeat: 5, ease: 'Quad.easeOut' });
  }

  update(dt: number, c: CharView, showWeapon: boolean, isActive: boolean, terrain: TerrainMask): void {
    if (this.gone) return;
    if (c.drowned) {
      this.root.setVisible(false);
      this.shadow.setVisible(false);
      this.ring.setVisible(false);
      this.gone = true;
      return;
    }
    if (!c.alive) {
      this.die(c);
      return;
    }
    this.t += dt;
    this.hurt = Math.max(0, this.hurt - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.blink = Math.max(0, this.blink - dt);
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.13;
      this.nextBlink = 2 + Math.random() * 4;
    }
    this.glance -= dt;
    if (this.glance <= 0) {
      this.glance = 1.5 + Math.random() * 3;
      this.glanceX = (Math.random() - 0.5) * 1.6;
    }
    const moved = Math.abs(c.x - this.lastX);
    this.lastX = c.x;
    if (c.onGround && moved > 0.05 && moved < 8) {
      this.walk += moved;
      this.walking = 0.12;
    } else this.walking = Math.max(0, this.walking - dt);

    // Squash on landing, stretch on take-off; a damped spring brings it back.
    if (this.wasGround && !c.onGround && c.vy < -100) this.sq = 0.2;
    if (!this.wasGround && c.onGround) this.sq = -0.12 - (Math.abs(this.spin) > 0.3 ? 0.14 : 0.06);
    this.wasGround = c.onGround;
    this.sqVel += (-this.sq * 180 - this.sqVel * 13) * dt;
    this.sq += this.sqVel * dt;

    // Knocked-back critters tumble, then settle upright on the ground.
    const speed = Math.hypot(c.vx, c.vy);
    if (!c.onGround && (this.hurt > 0 || speed > 420)) this.spin += c.vx * dt * 0.022;
    else {
      this.spin = Math.atan2(Math.sin(this.spin), Math.cos(this.spin));
      this.spin += (0 - this.spin) * Math.min(1, dt * 12);
    }

    this.root.setPosition(c.x, c.y + R);
    const f = c.facing >= 0 ? 1 : -1;
    const breathe = Math.sin(this.t * 3.2) * 0.025;
    let sx = 1 - this.sq * 0.6 - breathe * 0.5;
    let sy = 1 + this.sq + breathe;
    if (c.crouching) {
      sx *= 1.12;
      sy *= 0.8;
    }
    const bob = this.walking > 0 ? -Math.abs(Math.sin(this.walk * 0.3)) * 2.5 : 0;
    const shake = this.hurt > 0.35 ? Math.sin(this.t * 70) * 1.4 : 0;
    const lean = this.walking > 0 ? 0.08 * f : 0;
    this.pose.setPosition(shake, -PIVOT + bob).setScale(f * sx, sy).setRotation(lean + this.spin);

    const step = this.walking > 0 ? Math.sin(this.walk * 0.3) * 3 : 0;
    const [fb, ff] = this.rig.feet;
    this.footB.setPosition(fb[0] - step, fb[1] + PIVOT + (c.onGround ? 0 : -2));
    this.footF.setPosition(ff[0] + step, ff[1] + PIVOT + (c.onGround ? 0 : 1));
    this.tail?.setRotation(Math.sin(this.t * 4) * 0.12);

    // Face: look along the aim when acting, glance around otherwise.
    const aiming = isActive && showWeapon;
    const la = Math.atan2(Math.sin(c.aim), Math.cos(c.aim) * f);
    const lx = aiming ? Math.cos(la) * 1.1 : this.glanceX;
    const ly = aiming ? Math.sin(la) * 1.1 : 0.2;
    const hurt = this.hurt > 0;
    for (const e of this.eyes) {
      const closed = !hurt && !this.happy && this.blink > 0;
      const open = !hurt && !closed && !this.happy;
      e.white.setVisible(open);
      e.pupil.setVisible(open).setPosition(e.x + lx, e.y + ly + PIVOT);
      e.closed.setVisible(closed);
      e.hurt.setVisible(hurt);
      e.happy.setVisible(this.happy && !hurt);
      const tilt = aiming ? (e.far ? 0.28 : -0.28) : hurt ? (e.far ? -0.32 : 0.32) : 0;
      e.brow.setRotation(tilt).setY(e.y - e.r - 2.6 + PIVOT + (hurt ? -0.8 : aiming ? 0.4 : Math.sin(this.t * 1.7) * 0.2));
    }
    this.mouth.setVisible(hurt || this.recoil > 0.4 || this.happy);
    this.head.setRotation(aiming ? la * 0.06 : Math.sin(this.t * 1.3) * 0.02);

    this.arm.setVisible(showWeapon);
    if (showWeapon) {
      const key = art.has(`held_${c.weaponId}`) ? `held_${c.weaponId}` : 'held_rocket';
      if (key !== this.weaponKey) {
        this.weaponKey = key;
        this.weapon.setTexture(key);
        art.applyOrigin(this.weapon, key);
      }
      this.arm.setRotation(la);
      this.weapon.setX(-this.recoil * 4);
    }

    for (const o of [this.body, this.head, this.footB, this.footF, this.tail]) {
      if (!o) continue;
      if (this.flash > 0) o.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else o.clearTint();
    }

    // Contact shadow on the ground below, smaller and fainter with height.
    const feetY = c.y + R;
    const ground = terrain.surfaceAt(c.x, feetY - 2, Math.min(terrain.height, feetY + 320));
    if (ground == null) this.shadow.setVisible(false);
    else {
      const k = 1 - Math.min(1, (ground - feetY) / 220) * 0.7;
      this.shadow.setVisible(true).setPosition(c.x, ground).setScale(art.scale * k).setAlpha(k);
    }
    this.ring.setVisible(isActive && c.onGround).setPosition(c.x, feetY).setAlpha(0.65 + Math.sin(this.t * 5) * 0.3);

    this.label.setText(c.name);
    if (this.shownHp !== c.hp) {
      this.shownHp = c.hp;
      this.drawBar(c);
    }
  }

  private drawBar(c: CharView): void {
    const g = this.bar;
    g.clear();
    const w = 36;
    const k = Math.max(0, c.hp / c.maxHp);
    const y = this.rig.top - 8;
    g.fillStyle(0x16203f, 0.9).fillRoundedRect(-w / 2 - 2, y, w + 4, 8, 4);
    g.fillStyle(k > 0.5 ? 0x5ee05e : k > 0.25 ? 0xffd23f : 0xff4d4d, 1).fillRoundedRect(-w / 2, y + 2, Math.max(2, w * k), 4, 2);
    g.fillStyle(this.color, 1).fillCircle(-w / 2 - 8, y + 4, 4).lineStyle(1.5, 0x16203f, 1).strokeCircle(-w / 2 - 8, y + 4, 4);
  }

  private die(c: CharView): void {
    this.gone = true;
    this.shadow.setVisible(false);
    this.ring.setVisible(false);
    this.scene.tweens.add({
      targets: this.pose, angle: 540 * (c.facing || 1), scaleX: 0.2, scaleY: 0.2, alpha: 0, y: -PIVOT - 34, duration: 650, ease: 'Back.easeIn',
    });
    this.bar.setVisible(false);
    this.label.setAlpha(0.5);
    this.tomb = art.image(this.scene, 'tombstone', c.x, c.y + R - 40).setDepth(29).setAlpha(0);
    this.scene.tweens.add({ targets: this.tomb, y: c.y + R, alpha: 1, duration: 500, delay: 450, ease: 'Bounce.easeOut' });
  }

  destroy(): void {
    this.root.destroy();
    this.shadow.destroy();
    this.ring.destroy();
    this.tomb?.destroy();
  }
}
