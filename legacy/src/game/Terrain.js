import { RNG, makeNoise1D, clamp, hexToRgb, hash2 } from './utils.js';

/**
 * Destructible terrain: a 1-byte-per-pixel solidity mask (authoritative for physics)
 * plus a painted canvas (visuals). Carving updates both.
 */
export class Terrain {
  constructor(width, height, map, seed, waterLevel) {
    this.width = width;
    this.height = height;
    this.map = map;
    this.waterLevel = waterLevel;
    this.rng = new RNG(seed);
    this.solid = new Uint8Array(width * height);
    this.surface = new Float32Array(width);
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.generate();
  }

  isSolid(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || x >= this.width || y < 0) return false;
    if (y >= this.height) return true;
    return this.solid[y * this.width + x] === 1;
  }

  /** First solid y at column x, scanning down from `fromY`; null if none above the water. */
  surfaceAt(x, fromY = 0) {
    for (let y = Math.max(0, Math.floor(fromY)); y < this.waterLevel; y++) if (this.isSolid(x, y)) return y;
    return null;
  }

  generate() {
    const { width: w, height: h, rng } = this;
    const g = this.map.gen;
    const n1 = makeNoise1D(rng);
    const n2 = makeNoise1D(rng);
    const n3 = makeNoise1D(rng);
    const gaps = [];
    for (let i = 1; i < g.islands; i++) gaps.push((i / g.islands) * w + rng.float(-80, 80));

    for (let x = 0; x < w; x++) {
      let y = h * g.base + (n1(x / 430) - 0.5) * g.amp + (n2(x / 150) - 0.5) * g.amp * 0.35 + (n3(x / 40) - 0.5) * g.rough;
      if (g.mesa) {
        const q = Math.round(y / 80) * 80;
        y += (q - y) * 0.75;
      }
      for (const gx of gaps) y += 520 * Math.exp(-(((x - gx) / 75) ** 2));
      const edge = Math.min(x, w - 1 - x);
      if (edge < 180) y += (1 - edge / 180) ** 2 * 380;
      this.surface[x] = clamp(y, 220, h - 10);
    }
    if (g.mesa) this.medianSmooth(6); // terrace rounding leaves 1-2px spikes at level boundaries

    for (let x = 0; x < w; x++) {
      for (let y = Math.floor(this.surface[x]); y < h; y++) this.solid[y * w + x] = 1;
    }

    for (let i = 0; i < g.platforms; i++) {
      const cx = rng.float(w * 0.15, w * 0.85);
      const cy = this.surface[Math.floor(cx)] - rng.float(170, 280);
      if (cy > 200) this.fillBlob(cx, cy, rng.float(60, 115), rng.float(14, 24), 1);
    }
    // Back wall: a darkened copy of the ground before caves are cut, so caves and
    // craters reveal earth behind them instead of sky.
    this.backCanvas = document.createElement('canvas');
    this.backCanvas.width = w;
    this.backCanvas.height = h;
    const back = this.backCanvas.getContext('2d');
    this.paint(back);
    back.globalCompositeOperation = 'source-atop';
    back.fillStyle = 'rgba(25, 12, 35, 0.55)';
    back.fillRect(0, 0, w, h);

    for (let i = 0; i < g.caves; i++) {
      const cx = rng.float(w * 0.12, w * 0.88);
      const cy = this.surface[Math.floor(cx)] + rng.float(90, 220);
      if (cy < this.waterLevel - 60) this.fillBlob(cx, cy, rng.float(50, 120), rng.float(26, 50), 0);
    }

    this.paint(this.ctx);
    this.paintDecor();
  }

  medianSmooth(radius) {
    const src = Float32Array.from(this.surface);
    const win = [];
    for (let x = 0; x < this.width; x++) {
      win.length = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(this.width - 1, x + radius); k++) win.push(src[k]);
      win.sort((a, b) => a - b);
      this.surface[x] = win[win.length >> 1];
    }
  }

  /** Superellipse fill (flat-ish top and bottom) used for platforms and caves. */
  fillBlob(cx, cy, rx, ry, value) {
    const { width: w, height: h } = this;
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(h - 1, cy + ry); y++) {
      const dy = (y - cy) / ry;
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(w - 1, cx + rx); x++) {
        const dx = (x - cx) / rx;
        if (dx ** 4 + dy * dy <= 1) this.solid[y * w + x] = value;
      }
    }
  }

  paint(ctx) {
    const { width: w, height: h } = this;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const G = this.map.ground;
    const light = hexToRgb(G.topLight);
    const top = hexToRgb(G.top);
    const dirt = hexToRgb(G.dirt);
    const dirt2 = hexToRgb(G.dirt2);
    const deep = hexToRgb(G.deep);
    const wave = makeNoise1D(new RNG(this.rng.int(0, 1e9)));

    for (let x = 0; x < w; x++) {
      let depth = 0;
      const wv = wave(x / 50) * 26;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        if (!this.solid[i]) {
          depth = 0;
          continue;
        }
        depth++;
        const hs = hash2(x, y);
        let c;
        if (depth <= 4) c = light;
        else if (depth <= 13 + (hs & 3)) c = top;
        else if (depth > 240) c = deep;
        else c = Math.floor((y + wv) / 26) % 2 === 0 ? dirt : dirt2;
        const v = ((hs >> 4) & 15) - 7;
        const o = i * 4;
        d[o] = c[0] + v;
        d[o + 1] = c[1] + v;
        d[o + 2] = c[2] + v;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Small non-solid surface details (they get blown away with the ground). */
  paintDecor() {
    const ctx = this.ctx;
    const rng = new RNG(this.rng.int(0, 1e9));
    const G = this.map.ground;
    const kind = this.map.decor;
    for (let x = 6; x < this.width - 6; x += rng.int(5, 11)) {
      const y = this.surfaceAt(x);
      if (y == null) continue;
      const r = rng.next();
      ctx.lineCap = 'round';
      if (kind === 'cactus' || kind === 'pine') {
        if (r < 0.12) {
          ctx.fillStyle = kind === 'cactus' ? '#b07a45' : '#8a96aa';
          ctx.beginPath();
          ctx.ellipse(x, y + 1, rng.float(3, 6), rng.float(2, 4), 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (r < 0.2 && kind === 'cactus') {
          ctx.strokeStyle = '#4f8a3c';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x, y + 2);
          ctx.lineTo(x, y - 12);
          ctx.moveTo(x, y - 6);
          ctx.lineTo(x + 4, y - 7);
          ctx.lineTo(x + 4, y - 11);
          ctx.stroke();
        } else if (r < 0.2) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, rng.float(2, 4), 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      ctx.strokeStyle = G.top;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        ctx.moveTo(x + k * 1.5, y + 2);
        ctx.lineTo(x + k * 1.5 + rng.float(-2.5, 2.5), y - rng.float(3, 8));
      }
      ctx.stroke();
      if (r < 0.1) {
        ctx.fillStyle = rng.pick(['#ff6f91', '#ffd23f', '#ffffff', '#b28dff']);
        ctx.beginPath();
        ctx.arc(x + 2, y - 7, 2.3, 0, Math.PI * 2);
        ctx.fill();
      } else if (r < 0.14 && kind === 'palm') {
        ctx.fillStyle = '#ffe1d6';
        ctx.beginPath();
        ctx.arc(x, y + 1, 2.5, Math.PI, 0);
        ctx.fill();
      }
    }
  }

  carve(cx, cy, r, scorch = true) {
    if (r <= 0) return;
    const { width: w, height: h } = this;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) this.solid[row + x] = 0;
      }
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    if (scorch) {
      // source-atop paints only onto remaining ground: a burnt rim around the crater
      ctx.globalCompositeOperation = 'source-atop';
      const lw = Math.min(10, r * 0.22 + 2);
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(45, 28, 18, 0.5)';
      ctx.beginPath();
      ctx.arc(cx, cy, r + lw * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
