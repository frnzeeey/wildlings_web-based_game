/** Terrain materials stored per pixel. */
export const AIR = 0;
export const EARTH = 1;
export const ROCK = 2;
export const WOOD = 3;

/** Rock only gives way inside this fraction of a blast radius. */
export const ROCK_RESIST = 0.6;

export interface DirtyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Destructible terrain: one material byte per pixel. Authoritative for physics everywhere;
 * renderers paint from it. `surface` is the generated top line, used only for the backdrop.
 */
export class TerrainMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  surface: Int16Array;
  /** Union of areas changed since the last takeDirty() call. */
  dirty: DirtyRect | null = null;

  constructor(width: number, height: number, data?: Uint8Array, surface?: Int16Array) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8Array(width * height);
    this.surface = surface ?? new Int16Array(width);
  }

  isSolid(x: number, y: number): boolean {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || x >= this.width || y < 0) return false;
    if (y >= this.height) return true;
    return this.data[y * this.width + x] !== AIR;
  }

  material(x: number, y: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return AIR;
    return this.data[y * this.width + x];
  }

  /** First solid y at column x scanning down from fromY, or null if none above `limit`. */
  surfaceAt(x: number, fromY = 0, limit = this.height): number | null {
    for (let y = Math.max(0, Math.floor(fromY)); y < limit; y++) if (this.isSolid(x, y)) return y;
    return null;
  }

  /** Remove a disc of terrain. Rock only breaks inside ROCK_RESIST of the radius. */
  carve(cx: number, cy: number, r: number): void {
    if (r <= 0) return;
    const { width: w, height: h, data } = this;
    const r2 = r * r;
    const rr2 = r2 * ROCK_RESIST * ROCK_RESIST;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return;
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const i = row + x;
        if (data[i] === ROCK && d2 > rr2) continue;
        data[i] = AIR;
      }
    }
    this.markDirty(x0, y0, x1, y1);
  }

  markDirty(x0: number, y0: number, x1: number, y1: number): void {
    const d = this.dirty;
    if (!d) this.dirty = { x0, y0, x1, y1 };
    else {
      d.x0 = Math.min(d.x0, x0);
      d.y0 = Math.min(d.y0, y0);
      d.x1 = Math.max(d.x1, x1);
      d.y1 = Math.max(d.y1, y1);
    }
  }

  takeDirty(): DirtyRect | null {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  clone(): TerrainMask {
    return new TerrainMask(this.width, this.height, this.data.slice(), this.surface.slice());
  }
}

// ------------------------------------------------------------------ wire encoding

/** Run-length encode as [material, varint runLength]* — a typical map is ~15 kB. */
export function encodeRLE(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === v) n++;
    out.push(v);
    let len = n;
    while (len >= 0x80) {
      out.push((len & 0x7f) | 0x80);
      len >>>= 7;
    }
    out.push(len);
    i += n;
  }
  return Uint8Array.from(out);
}

export function decodeRLE(rle: Uint8Array, size: number): Uint8Array {
  const data = new Uint8Array(size);
  let o = 0;
  let i = 0;
  while (i < rle.length && o < size) {
    const v = rle[i++];
    let len = 0;
    let shift = 0;
    let b: number;
    do {
      b = rle[i++];
      len |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    data.fill(v, o, Math.min(size, o + len));
    o += len;
  }
  return data;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    s += B64[n >> 18] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return s;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

export interface TerrainPayload {
  w: number;
  h: number;
  rle: string; // base64 of encodeRLE(data)
  surface: string; // base64 of little-endian int16 surface line
}

export function encodeTerrain(t: TerrainMask): TerrainPayload {
  const surf = new Uint8Array(t.surface.length * 2);
  for (let i = 0; i < t.surface.length; i++) {
    surf[i * 2] = t.surface[i] & 255;
    surf[i * 2 + 1] = (t.surface[i] >> 8) & 255;
  }
  return { w: t.width, h: t.height, rle: toBase64(encodeRLE(t.data)), surface: toBase64(surf) };
}

export function decodeTerrain(p: TerrainPayload): TerrainMask {
  const data = decodeRLE(fromBase64(p.rle), p.w * p.h);
  const sb = fromBase64(p.surface);
  const surface = new Int16Array(p.w);
  for (let i = 0; i < p.w; i++) surface[i] = (sb[i * 2] | (sb[i * 2 + 1] << 8)) << 16 >> 16;
  return new TerrainMask(p.w, p.h, data, surface);
}
