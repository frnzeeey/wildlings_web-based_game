import { WORLD } from '../game/config.js';
import { clamp } from '../game/utils.js';

export class Camera {
  constructor() {
    this.x = WORLD.width / 2;
    this.y = WORLD.height / 2;
    this.tx = this.x;
    this.ty = this.y;
    this.viewW = 800;
    this.viewH = 600;
    this.baseZoom = 1;
    this.userZoom = 1;
    this.shakeAmt = 0;
    this.ox = 0;
    this.oy = 0;
    this.free = false; // true while the player is panning manually
  }

  get zoom() {
    return this.baseZoom * this.userZoom;
  }

  resize(w, h) {
    this.viewW = w;
    this.viewH = h;
    this.baseZoom = clamp(Math.min(w / 1500, h / 820), 0.4, 1.5);
  }

  follow(x, y) {
    this.tx = x;
    this.ty = y;
  }

  snapTo(x, y) {
    this.tx = this.x = x;
    this.ty = this.y = y;
    this.clamp();
  }

  pan(dx, dy) {
    this.free = true;
    this.tx -= dx / this.zoom;
    this.ty -= dy / this.zoom;
  }

  zoomBy(f) {
    this.userZoom = clamp(this.userZoom * f, 0.55, 1.8);
  }

  shake(amount) {
    this.shakeAmt = Math.min(30, this.shakeAmt + amount);
  }

  clamp() {
    const z = this.zoom;
    const hw = this.viewW / 2 / z;
    const hh = this.viewH / 2 / z;
    const lim = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : clamp(v, lo, hi));
    this.tx = lim(this.tx, hw - 150, WORLD.width - hw + 150);
    this.ty = lim(this.ty, -350 + hh, WORLD.height - hh);
    this.x = lim(this.x, hw - 150, WORLD.width - hw + 150);
    this.y = lim(this.y, -350 + hh, WORLD.height - hh);
  }

  update(dt) {
    this.clamp();
    const k = 1 - Math.exp(-dt * 5);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.shakeAmt *= Math.exp(-dt * 7);
    if (this.shakeAmt < 0.1) this.shakeAmt = 0;
    this.ox = (Math.random() * 2 - 1) * this.shakeAmt;
    this.oy = (Math.random() * 2 - 1) * this.shakeAmt;
  }

  screenToWorld(sx, sy) {
    const z = this.zoom;
    return { x: (sx - this.viewW / 2) / z + this.x, y: (sy - this.viewH / 2) / z + this.y };
  }

  apply(ctx, dpr) {
    const z = this.zoom;
    ctx.setTransform(z * dpr, 0, 0, z * dpr, (this.viewW / 2 - this.x * z + this.ox) * dpr, (this.viewH / 2 - this.y * z + this.oy) * dpr);
  }
}
