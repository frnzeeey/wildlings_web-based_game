import Phaser from 'phaser';
import { RULES, RNG, type MapDef } from '@wildlings/shared';
import { art } from './art.ts';

const W = RULES.world;
const col = (h: string) => Phaser.Display.Color.HexStringToColor(h).color;

/**
 * Sky gradient, the shared parallax layers (bg_<map>_far/mid/near from tools/gen-art.mjs, placed
 * by manifest.backgrounds so Godot matches), drifting clouds, ambient particles, and the animated
 * water/lava surface.
 */
export class Backdrop {
  private map: MapDef;
  private liquidBack: Phaser.GameObjects.Graphics;
  private liquidFront: Phaser.GameObjects.Graphics;
  private clouds: Phaser.GameObjects.Image[] = [];
  private t = 0;
  level: number = W.waterLevel;
  private shownLevel: number = W.waterLevel;

  constructor(scene: Phaser.Scene, map: MapDef, seed: number) {
    this.map = map;
    const p = map.palette;
    const sky = scene.add.graphics().setScrollFactor(0).setDepth(0);
    const top = col(p.sky[0]);
    const bottom = col(p.sky[1]);
    sky.fillGradientStyle(top, top, bottom, bottom, 1);
    sky.fillRect(-3000, -1500, 9000, 2400);
    sky.fillStyle(bottom, 1).fillRect(-3000, 900, 9000, 6000);

    const layers = art.manifest.backgrounds[map.id] ?? [];
    layers.forEach((l, i) => {
      if (!scene.textures.exists(l.key)) return;
      art.image(scene, l.key, l.x, l.y).setScrollFactor(l.factor).setDepth(1 + i * 2);
    });

    const rng = new RNG(seed ^ 0xb6);
    for (let i = 0; i < 8; i++) {
      // Clouds sit between the far and mid layers, drifting slowly.
      const c = art.image(scene, 'cloud', rng.float(-600, W.width + 600), rng.float(40, 360)).setScrollFactor(0.18 + i * 0.02).setDepth(2);
      c.setScale(art.scale * rng.float(0.45, 1.05)).setAlpha(map.id === 'volcano' ? 0.22 : 0.9);
      if (map.id === 'volcano') c.setTint(0x6a4a58);
      this.clouds.push(c);
    }

    this.liquidBack = scene.add.graphics().setDepth(9);
    this.liquidFront = scene.add.graphics().setDepth(50);

    if (p.decor === 'embers') {
      scene.add.particles(0, 0, 'fx_spark', {
        x: { min: 0, max: W.width }, y: W.waterLevel, lifespan: 4000, speedY: { min: -60, max: -20 }, speedX: { min: -15, max: 15 },
        scale: { start: 0.25, end: 0 }, tint: [0xff8a3d, 0xffc23a], blendMode: Phaser.BlendModes.ADD, frequency: 90, rotate: { min: 0, max: 360 },
      }).setDepth(8);
    } else if (map.id === 'snow') {
      scene.add.particles(0, 0, 'fx_drop', {
        x: { min: -200, max: W.width + 200 }, y: -40, lifespan: 9000, speedY: { min: 40, max: 80 }, speedX: { min: -30, max: 30 },
        scale: { min: 0.12, max: 0.25 }, alpha: 0.9, frequency: 70,
      }).setDepth(48);
    } else if (map.id === 'jungle' || map.id === 'grasslands') {
      scene.add.particles(0, 0, 'fx_spark', {
        x: { min: 0, max: W.width }, y: { min: 300, max: 900 }, lifespan: 5000, speedX: { min: -12, max: 12 }, speedY: { min: -10, max: 6 },
        scale: { start: 0.18, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: map.id === 'jungle' ? 0xd8ffb0 : 0xffffff, blendMode: Phaser.BlendModes.ADD, frequency: 260,
      }).setDepth(12);
    }
  }

  update(dt: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    this.t += dt;
    this.shownLevel += (this.level - this.shownLevel) * Math.min(1, dt * 2);
    for (const c of this.clouds) {
      c.x += dt * 7;
      if (c.x > W.width + 800) c.x = -800;
    }
    const v = cam.worldView;
    const x0 = Math.floor(v.x / 16) * 16 - 32;
    const x1 = v.right + 32;
    const lava = this.map.hazard === 'lava';
    const base = col(this.map.palette.liquid);
    const light = col(this.map.palette.liquidLight);
    const deep = Phaser.Display.Color.IntegerToColor(base).darken(lava ? 10 : 22).color;
    const lvl = this.shownLevel;
    const bottom = Math.max(v.bottom, W.height) + 400;
    const wave = (x: number, phase: number, amp: number) =>
      lvl + Math.sin(x * 0.02 + this.t * (lava ? 1.2 : 2) + phase) * amp + Math.sin(x * 0.045 - this.t * 1.3) * amp * 0.5;
    const draw = (g: Phaser.GameObjects.Graphics, phase: number, alpha: number, amp: number, front: boolean) => {
      g.clear();
      const surface: Phaser.Math.Vector2[] = [];
      for (let x = x0; x <= x1; x += 16) surface.push(new Phaser.Math.Vector2(x, wave(x, phase, amp)));
      const body = [...surface, new Phaser.Math.Vector2(x1, bottom), new Phaser.Math.Vector2(x0, bottom)];
      g.fillStyle(base, alpha).fillPoints(body, true);
      // Darker with depth (gradients only apply to rects in Phaser).
      // Opaque within 90px so the bottom of the terrain never shows through.
      g.fillGradientStyle(deep, deep, deep, deep, 0, 0, 0.95, 0.95);
      g.fillRect(x0, lvl + 14, x1 - x0, 76);
      g.fillStyle(deep, 0.95).fillRect(x0, lvl + 90, x1 - x0, Math.max(0, bottom - lvl - 90));
      if (front) {
        // Bright band just under the surface + foam line.
        const band = [...surface, ...surface.slice().reverse().map((p) => new Phaser.Math.Vector2(p.x, p.y + 10))];
        g.fillStyle(light, lava ? 0.55 : 0.35).fillPoints(band, true);
        g.lineStyle(3, lava ? 0xfff0a0 : 0xffffff, lava ? 0.9 : 0.75).strokePoints(surface, false);
      } else g.lineStyle(2, light, 0.6).strokePoints(surface, false);
    };
    draw(this.liquidBack, 1.7, 1, 4, false);
    draw(this.liquidFront, 0, lava ? 0.85 : 0.7, 5, true);
  }
}
