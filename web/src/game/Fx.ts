import Phaser from 'phaser';
import { art } from './art.ts';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

const C = (h: string) => Phaser.Display.Color.HexStringToColor(h).color;

/**
 * Cartoon effects built from the shared fx_* sprites: star flash, fire blobs, puffy smoke,
 * terrain-coloured debris, sparks, droplets, shockwave rings, damage numbers and camera shake.
 * Depth order keeps combat readable: smoke (28) < critters (30) < projectiles (35) < fire (41).
 * Mirrored by godot/game/fx.gd.
 */
export class Fx {
  private scene: Phaser.Scene;
  private fire: Emitter;
  private smoke: Emitter;
  private debris: Emitter;
  private sparks: Emitter;
  private drops: Emitter;
  private trail: Emitter;
  private fireTrail: Emitter;
  shakeEnabled = true;

  /** A soft round blob for trails (generated; everything else comes from the SVG set). */
  static makeTextures(scene: Phaser.Scene): void {
    if (scene.textures.exists('gen_soft')) return;
    const g = scene.make.graphics({}, false);
    for (let r = 16; r > 0; r--) g.fillStyle(0xffffff, (1 - r / 16) * 0.22).fillCircle(16, 16, r);
    g.generateTexture('gen_soft', 32, 32);
    g.destroy();
  }

  constructor(scene: Phaser.Scene, groundColor: string, liquidColor: string) {
    this.scene = scene;
    Fx.makeTextures(scene);
    const s = art.scale;
    const base = { emitting: false };
    this.smoke = scene.add.particles(0, 0, 'fx_puff', {
      ...base, lifespan: { min: 900, max: 1700 }, speed: { min: 20, max: 100 }, scale: { start: s * 0.9, end: s * 2.4 },
      alpha: { start: 0.72, end: 0 }, tint: [0x8a8494, 0x6e6878, 0xa49eae], gravityY: -50, rotate: { min: -40, max: 40 },
    }).setDepth(28);
    this.fire = scene.add.particles(0, 0, 'fx_fire', {
      ...base, lifespan: { min: 200, max: 400 }, speed: { min: 70, max: 260 }, scale: { start: s * 1.5, end: s * 0.25 },
      color: [0xfff3a0, 0xffc24a, 0xff7a2a, 0xc8321a], blendMode: Phaser.BlendModes.ADD, rotate: { min: -30, max: 30 }, gravityY: -120,
    }).setDepth(41);
    this.debris = scene.add.particles(0, 0, 'fx_chunk', {
      ...base, lifespan: { min: 650, max: 1150 }, speed: { min: 140, max: 400 }, angle: { min: 200, max: 340 },
      gravityY: 950, rotate: { start: 0, end: 540 }, scale: { min: s * 0.6, max: s * 1.3 }, tint: C(groundColor),
    }).setDepth(36);
    this.sparks = scene.add.particles(0, 0, 'fx_spark', {
      ...base, lifespan: { min: 220, max: 480 }, speed: { min: 180, max: 460 }, scale: { start: s * 1.4, end: 0 },
      tint: [0xffd23f, 0xffffff, 0xff9a3d], blendMode: Phaser.BlendModes.ADD, gravityY: 320, rotate: { min: 0, max: 360 },
    }).setDepth(42);
    this.drops = scene.add.particles(0, 0, 'fx_drop', {
      ...base, lifespan: { min: 550, max: 950 }, speed: { min: 130, max: 390 }, angle: { min: 235, max: 305 },
      gravityY: 950, scale: { start: s * 1.2, end: s * 0.5 }, tint: C(liquidColor),
    }).setDepth(51);
    this.trail = scene.add.particles(0, 0, 'fx_puff', {
      ...base, lifespan: 520, speed: 6, scale: { start: s * 0.35, end: s * 0.9 }, alpha: { start: 0.5, end: 0 }, tint: 0xe2dfe8, rotate: { min: 0, max: 360 },
    }).setDepth(33);
    this.fireTrail = scene.add.particles(0, 0, 'gen_soft', {
      ...base, lifespan: 260, speed: 10, scale: { start: 0.9, end: 0.1 }, color: [0xffe066, 0xff8a3d, 0xd6331a], blendMode: Phaser.BlendModes.ADD,
    }).setDepth(34);
  }

  explosion(x: number, y: number, r: number): void {
    const k = Math.max(0.4, r / 55);
    // 1) flash star, 2) fireball, 3) smoke, 4) debris + sparks, 5) shockwave rings.
    const star = art.image(this.scene, 'fx_star', x, y).setDepth(43).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8).setScale(art.scale * k * 0.8).setRotation(Math.random() * 6);
    this.scene.tweens.add({ targets: star, scale: art.scale * k * 2.6, alpha: 0, duration: 170, ease: 'Quad.easeOut', onComplete: () => star.destroy() });
    // Cartoon blast: pops out, holds briefly, then shrinks away (never hides the result for long).
    const s = art.scale * Math.max(0.5, r / 34);
    const burst = art.image(this.scene, 'fx_burst', x, y).setDepth(40).setScale(s * 0.3).setRotation(Math.random() * 6);
    this.scene.tweens.add({ targets: burst, scale: s, duration: 90, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: burst, scale: s * 0.4, alpha: 0, angle: burst.angle + 25, delay: 150, duration: 170, ease: 'Quad.easeIn', onComplete: () => burst.destroy() });
    this.fire.explode(Math.round(12 * k), x, y);
    this.scene.time.delayedCall(60, () => this.smoke.explode(Math.round(9 * k), x, y - 4));
    this.debris.explode(Math.round(14 * k), x, y);
    this.sparks.explode(Math.round(12 * k), x, y);
    this.ring(x, y, r * 1.05, 0xfff3c4, 280, 5);
    this.ring(x, y, r * 0.7, 0xffffff, 200, 3);
  }

  ring(x: number, y: number, r: number, color: number, duration: number, width = 4): void {
    const g = this.scene.add.graphics().setDepth(42);
    const o = { t: 0 };
    this.scene.tweens.add({
      targets: o, t: 1, duration, ease: 'Cubic.easeOut',
      onUpdate: () => {
        g.clear();
        g.lineStyle(width * (1 - o.t) + 1, color, 1 - o.t);
        g.strokeCircle(x, y, r * (0.3 + o.t * 0.9));
      },
      onComplete: () => g.destroy(),
    });
  }

  dust(x: number, y: number, n = 6): void {
    this.smoke.explode(n, x, y);
  }

  splash(x: number, y: number, big: boolean): void {
    this.drops.explode(big ? 30 : 12, x, y);
    this.ring(x, y, big ? 44 : 24, 0xffffff, 420, 4);
  }

  muzzle(x: number, y: number): void {
    this.fire.explode(5, x, y);
    this.smoke.explode(2, x, y);
  }

  poof(x: number, y: number, color: number): void {
    this.smoke.explode(14, x, y);
    this.sparks.explode(8, x, y);
    this.ring(x, y, 32, color, 360, 4);
  }

  spark(x: number, y: number, n = 6): void {
    this.sparks.explode(n, x, y);
  }

  trailAt(x: number, y: number, kind: 'smoke' | 'fire'): void {
    (kind === 'fire' ? this.fireTrail : this.trail).emitParticleAt(x, y, 1);
  }

  floatText(x: number, y: number, text: string, color: string, size = 22): void {
    const t = this.scene.add.text(x, y, text, {
      fontFamily: "'Lilita One', Fredoka, sans-serif", fontSize: `${size + 4}px`, color, stroke: '#1a2140', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(60).setResolution(2).setScale(0.3);
    this.scene.tweens.add({ targets: t, scale: 1.15, duration: 160, ease: 'Back.easeOut', yoyo: false, onComplete: () => this.scene.tweens.add({ targets: t, scale: 1, duration: 120 }) });
    this.scene.tweens.add({ targets: t, y: y - 54, alpha: 0, delay: 700, duration: 650, ease: 'Quad.easeIn', onComplete: () => t.destroy() });
  }

  shake(amount: number): void {
    if (!this.shakeEnabled || amount <= 0) return;
    this.scene.cameras.main.shake(Math.min(500, 120 + amount * 14), Math.min(0.025, amount / 900));
  }

  destroy(): void {
    for (const e of [this.fire, this.smoke, this.debris, this.sparks, this.drops, this.trail, this.fireTrail]) e.destroy();
  }
}
