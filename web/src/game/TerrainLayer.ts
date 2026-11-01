import Phaser from 'phaser';
import { AIR, ROCK, WOOD, RNG, type MapDef, type TerrainMask } from '@wildlings/shared';
import { art } from './art.ts';

const CHUNK = 512;

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

interface Decor {
  x: number;
  y: number;
  kind: number;
  r: number;
  img?: Phaser.GameObjects.Image;
}

/**
 * Paints the terrain mask into a set of chunk textures. A carve repaints only the dirty
 * rectangle and re-uploads only the chunks it touches. Scorch marks persist across repaints.
 */
export class TerrainLayer {
  private mask: TerrainMask;
  private map: MapDef;
  private img: ImageData;
  private scorch: Uint8Array;
  /** Solid-pixel depth at generation time (capped at 255): drives grass and topsoil bands. */
  private origDepth: Uint8Array;
  private chunks: { tex: Phaser.Textures.CanvasTexture; x: number; y: number; dirty: boolean }[] = [];
  private seed: number;
  private pal: Record<string, [number, number, number]>;
  private decor: Decor[] = [];
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, mask: TerrainMask, map: MapDef, seed: number) {
    this.scene = scene;
    this.mask = mask;
    this.map = map;
    this.img = new ImageData(mask.width, mask.height);
    this.scorch = new Uint8Array(mask.width * mask.height);
    this.origDepth = new Uint8Array(mask.width * mask.height);
    for (let x = 0; x < mask.width; x++) {
      let depth = 0;
      for (let y = 0; y < mask.height; y++) {
        const i = y * mask.width + x;
        depth = mask.data[i] !== AIR ? Math.min(255, depth + 1) : 0;
        this.origDepth[i] = depth;
      }
    }
    this.seed = Math.abs(seed);
    const p = map.palette;
    this.pal = {
      top: hex(p.top), light: hex(p.topLight), dirt: hex(p.dirt), dirt2: hex(p.dirt2), deep: hex(p.deep),
      rock: hex(p.rock), rock2: hex(p.rock2), wood: hex(p.wood), wood2: hex(p.wood2),
    };
    const [dr, dg, db] = this.pal.deep;
    this.pal.back = [Math.round(dr * 0.62 + 10), Math.round(dg * 0.56 + 6), Math.round(db * 0.6 + 14)];

    for (let cy = 0; cy < mask.height; cy += CHUNK) {
      for (let cx = 0; cx < mask.width; cx += CHUNK) {
        // Chunks overlap their neighbours by 1px so texture filtering never shows seams.
        const x0 = Math.max(0, cx - 1);
        const y0 = Math.max(0, cy - 1);
        const x1 = Math.min(mask.width, cx + CHUNK + 1);
        const y1 = Math.min(mask.height, cy + CHUNK + 1);
        const key = `terrain_${cx}_${cy}_${Math.random().toString(36).slice(2, 7)}`;
        const tex = scene.textures.createCanvas(key, x1 - x0, y1 - y0)!;
        scene.add.image(x0, y0, key).setOrigin(0, 0).setDepth(10);
        this.chunks.push({ tex, x: x0, y: y0, dirty: true });
      }
    }
    this.paintRect(0, 0, mask.width - 1, mask.height - 1);
    this.placeDecor(seed);
    this.flush();
  }

  /** Blast happened: add a burnt rim and repaint the area. */
  carved(cx: number, cy: number, r: number, scorch: boolean): void {
    const m = this.mask;
    if (scorch && r > 3) {
      const rim = Math.min(10, r * 0.22 + 2);
      const outer = r + rim;
      const x0 = Math.max(0, Math.floor(cx - outer));
      const x1 = Math.min(m.width - 1, Math.ceil(cx + outer));
      const y0 = Math.max(0, Math.floor(cy - outer));
      const y1 = Math.min(m.height - 1, Math.ceil(cy + outer));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > outer) continue;
          const k = Math.round(150 * (1 - Math.max(0, d - r) / rim));
          const i = y * m.width + x;
          if (k > this.scorch[i]) this.scorch[i] = k;
        }
      }
    }
    const pad = r + 16;
    this.paintRect(Math.floor(cx - pad), Math.floor(cy - pad), Math.ceil(cx + pad), Math.ceil(cy + pad));
    // Decor standing on removed ground disappears.
    this.pruneDecor((d) => Math.hypot(d.x - cx, d.y - cy) > r + 4 && m.isSolid(d.x, d.y + 2));
  }

  /** Upload changed chunks. Call once per frame. */
  flush(): void {
    for (const c of this.chunks) {
      if (!c.dirty) continue;
      c.dirty = false;
      c.tex.context.putImageData(this.img, -c.x, -c.y, c.x, c.y, c.tex.width, c.tex.height);
      c.tex.refresh();
    }
  }

  /** Repaint every pixel (used after a full terrain resync). */
  repaintAll(): void {
    this.paintRect(0, 0, this.mask.width - 1, this.mask.height - 1);
    this.pruneDecor((d) => this.mask.isSolid(d.x, d.y + 2));
  }

  destroy(): void {
    for (const c of this.chunks) c.tex.destroy();
    this.pruneDecor(() => false);
  }

  private paintRect(x0: number, y0: number, x1: number, y1: number): void {
    const m = this.mask;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(m.width - 1, x1);
    y1 = Math.min(m.height - 1, y1);
    const d = this.img.data;
    const P = this.pal;
    const W = m.width;
    const orig = this.origDepth;
    const H = m.height;
    const data = m.data;
    const s0 = this.seed % 1000;
    // Air test with world edges: outside left/right/top is air, below the bottom is solid.
    const air = (x: number, y: number) => x < 0 || x >= W || y < 0 ? true : y >= H ? false : data[y * W + x] === AIR;
    let r = 0;
    let g = 0;
    let b = 0;
    const set = (c: readonly number[]) => ((r = c[0]), (g = c[1]), (b = c[2]));
    // Same shading model as godot/game/terrain.gdshader (docs/ART_DIRECTION.md).
    const toward = (t: number, tr: number, tg: number, tb: number) => {
      r += (tr - r) * t;
      g += (tg - g) * t;
      b += (tb - b) * t;
    };
    const shade = (t: number) => toward(t, 52, 26, 34);
    const lit = (t: number) => toward(t, 255, 255, 255);
    // Stacked rock blocks with rounded corners, a bevel lit from the top-left and dark mortar.
    const blocks = (x: number, y: number, wv: number, rowH: number, bwBase: number, bwVar: number, cr: number, ca: readonly number[], cb: readonly number[], hs: number) => {
      const sy = y + wv * 0.6;
      const row = Math.floor(sy / rowH);
      const v = sy - row * rowH;
      const rh = hash2(row, 5);
      const bw = bwBase + (rh % bwVar);
      const bx = x + ((rh >>> 8) % bw);
      const col = Math.floor(bx / bw);
      const u = bx - col * bw;
      const bh = hash2(col, row);
      const du = Math.max(cr - u, u - (bw - 1 - cr), 0);
      const dv = Math.max(cr - v, v - (rowH - 1 - cr), 0);
      const e = cr - Math.sqrt(du * du + dv * dv);
      set(bh & 1 ? ca : cb);
      const tone = ((bh >>> 3) & 7) - 3.5;
      if (tone > 0) lit(tone * 0.045);
      else shade(-tone * 0.05);
      if (e < 1) {
        shade(0.42);
        return;
      }
      if (e < 4) {
        const k = 1 - (e - 1) / 3;
        if ((u - bw * 0.5) / bw + (v - rowH * 0.5) / rowH < 0) lit(k * 0.26);
        else shade(k * 0.3);
      }
      shade((v / rowH) * 0.12);
      if ((hs & 63) === 0) shade(0.2);
      else if (((hs >>> 6) & 63) === 0) lit(0.12);
    };
    for (let x = x0; x <= x1; x++) {
      const surf = m.surface[x];
      const wv = (Math.sin(x * 0.021 + s0) * 0.5 + Math.sin(x * 0.047 + s0 * 1.7) * 0.5 + 1) * 13;
      const topBand = 14 + 3 * Math.sin(x * 0.13 + s0) + 2 * Math.sin(x * 0.37 + s0 * 2);
      // Grass cap: thick, hanging over the cliff in rounded scallops.
      const sc = (((x + s0) % 22) / 22) * 2 - 1;
      const lip = topBand + Math.sqrt(Math.max(0, 1 - sc * sc)) * 7;
      for (let y = y0; y <= y1; y++) {
        const i = y * W + x;
        const mat = data[i];
        const o = i * 4;
        const hs = hash2(x, y);
        if (mat === AIR) {
          if (y > surf + 2) {
            // Backdrop: darker with depth, ambient occlusion next to the terrain edge.
            set(P.back);
            shade(Math.min(1, (y - surf) / 700) * 0.35);
            if (!air(x, y - 3) || !air(x - 3, y) || !air(x + 3, y) || !air(x, y + 3)) shade(0.28);
            const v = (((hs >> 5) & 7) - 3) * 1.2;
            d[o] = r + v;
            d[o + 1] = g + v;
            d[o + 2] = b + v;
            d[o + 3] = 255;
          } else d[o + 3] = 0;
          continue;
        }
        // Bands come from the terrain as generated, so craters expose soil instead of growing grass.
        const depth = orig[i];
        let v = ((hs >> 4) & 15) - 7;
        if (mat === ROCK) {
          // Stone platform: thin grass cap over small masonry blocks.
          if (depth <= 2) set(P.light);
          else if (depth <= 7) {
            set(P.top);
            lit(Math.max(0, 1 - (depth - 2) / 4) * 0.4);
          } else if (depth <= 9) {
            set(P.top);
            shade(0.5);
          } else {
            blocks(x, y, wv, 14, 18, 14, 3, P.rock, P.rock2, hs);
            if (depth < 16) shade((1 - (depth - 10) / 6) * 0.4);
          }
          v *= 0.35;
        } else if (mat === WOOD) {
          // Planks with bevelled edges, dark gaps and nails.
          const px = x % 14;
          set(px === 0 || depth >= 8 ? P.wood2 : P.wood);
          if (px === 0) shade(0.3);
          else if (px === 1 || depth === 1) lit(0.22);
          else if (px === 13) shade(0.2);
          if (px === 7 && depth === 4) shade(0.6);
          v *= 0.5;
        } else if (depth <= 2) set(P.light);
        else if (depth <= lip) {
          // Grass cap: bright crest fading into the base colour, darker toward its scalloped edge.
          set(P.top);
          lit(Math.max(0, 1 - (depth - 2) / 6) * 0.7);
          const t = depth / lip;
          shade(t * t * 0.3);
          if (((hash2(x, 7) >>> 3) & 3) === 0 && depth > 3 && depth < lip - 3) lit(0.12);
        } else if (depth <= lip + 2) {
          // Dark under-edge of the cap.
          set(P.top);
          shade(0.5);
        } else {
          // Cliff of chunky rock blocks with occlusion under the cap, fading into deep soil.
          blocks(x, y, wv, 30, 40, 40, 7, P.dirt, P.dirt2, hs);
          const k = depth - lip - 2;
          if (k < 10) shade((1 - k / 10) * 0.45);
          const t = Math.min(1, Math.max(0, (y - surf - 150) / 180));
          if (t > 0) toward(t * t * (3 - 2 * t), P.deep[0], P.deep[1], P.deep[2]);
        }
        // Lighting: ink rim against air, top-left light, occlusion under overhangs.
        if (air(x, y - 1) || air(x, y + 1) || air(x - 1, y) || air(x + 1, y)) shade(0.45);
        else {
          if (air(x, y - 2) || air(x, y - 3)) lit(0.1);
          if (air(x - 2, y)) lit(0.07);
          if (air(x + 2, y)) shade(0.08);
          for (let k = 2; k <= 7; k++) {
            if (air(x, y + k)) {
              shade((0.3 * (8 - k)) / 6);
              break;
            }
          }
        }
        const sc = this.scorch[i];
        if (sc) shade((sc / 255) * 0.85);
        d[o] = r + v;
        d[o + 1] = g + v;
        d[o + 2] = b + v;
        d[o + 3] = 255;
      }
    }
    for (const c of this.chunks) {
      if (x1 >= c.x && x0 < c.x + c.tex.width && y1 >= c.y && y0 < c.y + c.tex.height) c.dirty = true;
    }
  }

  // ------------------------------------------------------------------ decor (non-solid details)

  /** Same placement as godot/game/decor.gd: tufts, blooms, bushes and trees (deco_<map>_* sprites). */
  private placeDecor(seed: number): void {
    const rng = new RNG(seed ^ 0xdec0);
    const m = this.mask;
    for (let x = 6; x < m.width - 6; x += rng.int(5, 11)) {
      const y = m.surfaceAt(x);
      if (y == null || m.material(x, y) !== 1) continue;
      const r = rng.next();
      let kind = 0; // grass tuft
      if (r < 0.025) kind = 3; // tree
      else if (r < 0.12) kind = 1; // bloom
      else if (r < 0.16) kind = 2; // bush
      this.decor.push({ x, y, kind, r: rng.next() });
    }
    const id = this.map.id;
    for (const d of this.decor) {
      const key = `deco_${id}_${DECOR_KEYS[d.kind]}${d.kind === 3 && d.r >= 0.5 ? '2' : ''}`;
      if (!art.has(key)) continue;
      const k = 0.85 + d.r * 0.3;
      const flip = (d.r * 1000) % 2 < 1 ? -1 : 1;
      d.img = art.image(this.scene, key, d.x, d.y + 1).setDepth(d.kind === 3 ? 11 : 12);
      d.img.setScale(art.partScale(key) * k * flip, art.partScale(key) * k);
    }
  }

  private pruneDecor(keep: (d: Decor) => boolean): void {
    this.decor = this.decor.filter((d) => {
      if (keep(d)) return true;
      d.img?.destroy();
      return false;
    });
  }
}

const DECOR_KEYS = ['tuft', 'bloom', 'bush', 'tree'];
