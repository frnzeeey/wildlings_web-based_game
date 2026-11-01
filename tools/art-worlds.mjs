// Wildlings worlds: painted 2.5D parallax backgrounds (far / mid / near per map) and the decor
// sprites that sit on the destructible terrain (tufts, blooms, bushes, trees). Used by
// tools/gen-art.mjs; see docs/ART_DIRECTION.md. Background art is decoration only: it never
// touches the terrain mask, collision or gameplay.
import { mix, light, f, line, rand, lineOf } from './art-kit.mjs';

export const BW = 4600;
export const BH = 1300;

// ---------------------------------------------------------------- biomes
// cap: top layer (grass, sand, ash, snow) light/mid/dark; rock: cliff faces; leaf: foliage;
// hill: rolling hill body top/bottom; water: falls (light/mid/deep).
const BIOMES = {
  grasslands: {
    haze: '#c6e6ff', cap: ['#c2f26a', '#72c83e', '#3d952c'], rock: ['#e8ac74', '#c27a45', '#7a4426'], leaf: ['#9ae66c', '#45ac3f', '#1d6a2c'],
    trunk: '#93603a', hill: ['#7fcf4a', '#3f8f3a'], water: ['#ffffff', '#bdeaff', '#4fb4f0'], plants: ['tree', 'palm'],
    far: 'plateaus', landmark: 'castle', islands: true, sun: '#fff6cf', flowers: ['#ffffff', '#ffd23f', '#ff7aa0'],
  },
  canyon: {
    haze: '#ffe0b8', cap: ['#ffe9a4', '#f2c066', '#c98d40'], rock: ['#f8ac74', '#dc7a40', '#8a3e22'], leaf: ['#b6e070', '#62a046', '#2f5c2a'],
    trunk: '#7a5a3a', hill: ['#f3b26c', '#c46a38'], water: ['#ffffff', '#b8f4ee', '#3cc4cc'], plants: ['cactus', 'cactus'],
    far: 'buttes', landmark: 'arch', sun: '#fff1c8', stripes: true, flowers: ['#ff7aa0', '#ffd23f', '#ffffff'],
  },
  volcano: {
    haze: '#8c4250', cap: ['#b39ca8', '#76626f', '#3e3240'], rock: ['#7a5c6c', '#4e3848', '#211520'], leaf: ['#6a565e', '#3e3038', '#1c1218'],
    trunk: '#2e2226', hill: ['#5a3a4c', '#2a1822'], water: ['#fff2a0', '#ffb43a', '#ff5a1f'], plants: ['dead', 'dead'],
    far: 'volcanoes', sun: '#ffb27a', flowers: ['#ff7a2a', '#ffc23a', '#ffe680'],
  },
  snow: {
    haze: '#dcefff', cap: ['#ffffff', '#f2f7ff', '#bcd0ee'], rock: ['#a9bde0', '#7489bb', '#3d4a78'], leaf: ['#5aa688', '#2d6a5d', '#173c38'],
    trunk: '#6b4a2e', hill: ['#f4f9ff', '#a9c2e6'], water: ['#ffffff', '#dff4ff', '#9fd2ff'], plants: ['pine', 'pine'],
    far: 'peaks', snowy: true, sun: '#ffffff', flowers: ['#ffffff', '#d6ecff', '#a8d4ff'],
  },
  jungle: {
    haze: '#c8efd8', cap: ['#b4f06a', '#4fc246', '#278a34'], rock: ['#b4987a', '#7e5e44', '#3e2a1e'], leaf: ['#86e86a', '#2fa24e', '#125a30'],
    trunk: '#7a5232', hill: ['#46b856', '#1f7a44'], water: ['#ffffff', '#c4f0ff', '#40b8e8'], plants: ['palm', 'tree'],
    far: 'plateaus', landmark: 'temple', sun: '#fffbe0', flowers: ['#ff5a6e', '#ffd23f', '#ff9ad0'],
  },
};

/** Colours for one depth layer: everything drifts toward the horizon haze by `k`. */
function layerPal(b, k, lw = 2.6) {
  const A = (c) => mix(c, b.haze, k);
  const L = (arr) => arr.map(A);
  return {
    cap: L(b.cap), rock: L(b.rock), leaf: L(b.leaf), hill: L(b.hill), water: L(b.water),
    trunk: A(b.trunk), flowers: L(b.flowers), lw,
    line: A(mix(b.rock[2], '#1a0c10', 0.45)), capLine: A(mix(b.cap[2], '#14200c', 0.4)), leafLine: A(mix(b.leaf[2], '#0c1a10', 0.45)),
    stone: L(['#eef0f6', '#c4c8d8', '#7f86a4']), roof: L(['#7fb4ff', '#3f72d0', '#21407e']), flag: A('#ff4d4d'), window: A('#2a3050'),
    wood: L(['#e2a466', '#b47640', '#6a4022']), woodRoof: L(['#ff8a6a', '#d8503a', '#86281c']),
    temple: L(['#cfd6b0', '#97a07a', '#4f5a44']), moss: A('#5aa64a'), snowy: b.snowy,
  };
}

// ---------------------------------------------------------------- gradient builder
function builder() {
  let n = 0;
  const defs = [];
  const stops = (s) => s.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a !== 1 ? ` stop-opacity="${a}"` : ''}/>`).join('');
  return {
    defs,
    lin(s, x1 = 0, y1 = 0, x2 = 0, y2 = 1, user = false) {
      const id = `g${++n}`;
      defs.push(`<linearGradient id="${id}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${stops(s)}</linearGradient>`);
      return `url(#${id})`;
    },
    rad(s, cx = 0.5, cy = 0.5, r = 0.5, user = false) {
      const id = `g${++n}`;
      defs.push(`<radialGradient id="${id}" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${stops(s)}</radialGradient>`);
      return `url(#${id})`;
    },
    clip(svg) {
      const id = `c${++n}`;
      defs.push(`<clipPath id="${id}">${svg}</clipPath>`);
      return `url(#${id})`;
    },
    svg(body) {
      return `<defs>${defs.join('')}</defs>${body}`;
    },
  };
}
const hz = (pal, dir = 'h') => (dir === 'h' ? [0, 0, 1, 0] : [0, 0, 0, 1]);

// ---------------------------------------------------------------- scenery elements
/** A grass/sand/snow cap: domed top with scalloped drips hanging over the cliff. */
function cap(B, x, top, w, h, pal) {
  const n = Math.max(2, Math.round(w / 28));
  const sw = w / n;
  let d = `M ${f(x)} ${f(top + h * 0.5)} C ${f(x)} ${f(top - 4)} ${f(x + w * 0.2)} ${f(top - 7)} ${f(x + w * 0.5)} ${f(top - 7)} C ${f(x + w * 0.8)} ${f(top - 7)} ${f(x + w)} ${f(top - 4)} ${f(x + w)} ${f(top + h * 0.5)}`;
  for (let i = 0; i < n; i++) {
    const x0 = x + w - i * sw;
    d += ` Q ${f(x0 - sw / 2)} ${f(top + h + 9 + ((i * 7) % 5))} ${f(x0 - sw)} ${f(top + (i === n - 1 ? h * 0.5 : h))}`;
  }
  d += ' Z';
  const [cl, cm, cd] = pal.cap;
  const clip = B.clip(`<path d="${d}"/>`);
  return `<path d="${d}" fill="${B.lin([[0, cl], [0.4, cm], [1, cd]])}"/>` +
    `<g clip-path="${clip}"><path d="M ${f(x)} ${f(top + h * 0.5)} C ${f(x)} ${f(top - 4)} ${f(x + w * 0.2)} ${f(top - 7)} ${f(x + w * 0.5)} ${f(top - 7)} C ${f(x + w * 0.8)} ${f(top - 7)} ${f(x + w)} ${f(top - 4)} ${f(x + w)} ${f(top + h * 0.5)}" fill="none" stroke="${light(cl, 0.5)}" stroke-width="${f(pal.lw * 2.2)}" opacity="0.85"/></g>` +
    `<path d="${d}" fill="none" stroke="${pal.capLine}" stroke-width="${f(pal.lw)}" stroke-linejoin="round"/>`;
}

/** A flat-topped cliff (mesa) with stacked rock blocks, side lighting and a cap. */
function plateau(B, r, x, top, w, pal, o = {}) {
  const bot = BH + 40;
  const lean = o.lean ?? 0.05;
  const capH = o.capH ?? 24;
  const L = [];
  const Rt = [];
  for (let y = top + 14; y < bot; y += 46 + r() * 30) {
    const dy = y - top;
    L.push([x - dy * lean + (r() - 0.5) * 12, y]);
    Rt.push([x + w + dy * lean + (r() - 0.5) * 12, y]);
  }
  L.push([x - (bot - top) * lean, bot]);
  Rt.push([x + w + (bot - top) * lean, bot]);
  const face = `M ${f(x + 4)} ${f(top + 6)} ${L.map(([a, b]) => `L ${f(a)} ${f(b)}`).join(' ')} ${Rt.slice().reverse().map(([a, b]) => `L ${f(a)} ${f(b)}`).join(' ')} L ${f(x + w - 4)} ${f(top + 6)} Z`;
  const [rl, rm, rd] = pal.rock;
  const crack = mix(rd, '#140810', 0.3);
  let s = `<path d="${face}" fill="${B.lin([[0, rl], [0.36, rm], [1, rd]], ...hz())}"/>`;
  let inner = '';
  const rowH = o.rowH ?? 34;
  let row = 0;
  for (let y = top + capH + 4; y < bot; y += rowH, row++) {
    if (o.stripes) {
      inner += `<rect x="${f(x - 80)}" y="${f(y)}" width="${f(w + 160)}" height="${f(rowH * 0.42)}" fill="${row % 2 ? light(rm, 0.18) : mix(rm, rd, 0.3)}" opacity="0.55"/>`;
      continue;
    }
    inner += line(`M ${f(x - 60)} ${f(y)} L ${f(x + w + 60)} ${f(y + (r() - 0.5) * 6)}`, crack, f(pal.lw * 1.1), 'opacity="0.55"');
    inner += line(`M ${f(x - 60)} ${f(y + pal.lw * 1.2)} L ${f(x + w + 60)} ${f(y + pal.lw * 1.2)}`, light(rl, 0.3), f(pal.lw * 0.8), 'opacity="0.35"');
    let bx = x - 40 + r() * 30;
    while (bx < x + w + 40) {
      bx += 40 + r() * 70;
      inner += line(`M ${f(bx)} ${f(y)} L ${f(bx + (r() - 0.5) * 6)} ${f(y + rowH)}`, crack, f(pal.lw), 'opacity="0.5"');
    }
  }
  inner += `<rect x="${f(x - 90)}" y="${f(top)}" width="${f(w + 180)}" height="${f(bot - top)}" fill="${B.lin([[0, rd, 0], [1, rd, 0.8]])}"/>`;
  inner += `<rect x="${f(x - 90)}" y="${f(top + capH - 8)}" width="${f(w + 180)}" height="46" fill="${B.lin([[0, rd, 0.85], [1, rd, 0]])}"/>`;
  s += `<g clip-path="${B.clip(`<path d="${face}"/>`)}">${inner}</g>`;
  s += `<path d="${face}" fill="none" stroke="${pal.line}" stroke-width="${f(pal.lw * 1.1)}" stroke-linejoin="round"/>`;
  s += cap(B, x - 10, top, w + 20, capH, pal);
  return s;
}

/** A waterfall (or lava/ice fall). Returns the falling sheet and the foam at its foot separately. */
function waterfall(B, x, y0, y1, w, pal, fade) {
  const [c0, c1, c2] = pal.water;
  let body = `<rect x="${f(x - w / 2)}" y="${f(y0)}" width="${f(w)}" height="${f(y1 - y0)}" rx="${f(w * 0.35)}" fill="${B.lin([[0, c0], [0.3, c1, 0.96], [1, c2, fade ? 0 : 0.95]])}"/>`;
  const streak = B.lin([[0, '#ffffff', 0.85], [1, '#ffffff', fade ? 0 : 0.6]], 0, y0, 0, y1, true);
  for (const k of [-0.27, 0.06, 0.3]) {
    body += line(`M ${f(x + k * w)} ${f(y0 + 6)} L ${f(x + k * w)} ${f(y1 - 8)}`, streak, f(w * 0.12), `stroke-dasharray="${f(w * 2.6)} ${f(w * 1.3)}"`);
  }
  let foam = '';
  if (!fade) {
    foam += `<ellipse cx="${f(x)}" cy="${f(y1)}" rx="${f(w * 2.2)}" ry="${f(w * 0.9)}" fill="${c1}" opacity="0.45"/>`;
    for (const [dx, k] of [[-0.75, 0.5], [-0.25, 0.72], [0.3, 0.66], [0.8, 0.46]]) foam += `<circle cx="${f(x + dx * w)}" cy="${f(y1 - w * 0.15)}" r="${f(w * k)}" fill="#ffffff" opacity="0.92"/>`;
  }
  return { body, foam };
}

function roundTree(B, x, y, s, pal) {
  const [l0, l1, l2] = pal.leaf;
  let out = `<path d="M ${f(x - 5 * s)} ${f(y + 2)} L ${f(x - 3.2 * s)} ${f(y - 42 * s)} L ${f(x + 3.2 * s)} ${f(y - 42 * s)} L ${f(x + 5 * s)} ${f(y + 2)} Z" fill="${B.lin([[0, light(pal.trunk, 0.25)], [0.5, pal.trunk], [1, mix(pal.trunk, '#1a0c08', 0.4)]], ...hz())}" stroke="${mix(pal.trunk, '#1a0c08', 0.55)}" stroke-width="${f(pal.lw * 0.8)}"/>`;
  const blobs = [[0, -62, 24], [-20, -48, 18], [20, -50, 19], [-9, -76, 16], [11, -74, 15]];
  out += blobs.map(([bx, by, br]) => `<circle cx="${f(x + bx * s)}" cy="${f(y + by * s)}" r="${f(br * s + pal.lw)}" fill="${pal.leafLine}"/>`).join('');
  const g = B.lin([[0, l0], [0.45, l1], [1, l2]], 0, y - 92 * s, 0, y - 30 * s, true);
  out += blobs.map(([bx, by, br]) => `<circle cx="${f(x + bx * s)}" cy="${f(y + by * s)}" r="${f(br * s)}" fill="${g}"/>`).join('');
  out += [[-7, -70, 8], [-25, -52, 6], [12, -78, 6]].map(([bx, by, br]) => `<circle cx="${f(x + bx * s)}" cy="${f(y + by * s)}" r="${f(br * s)}" fill="${light(l0, 0.4)}" opacity="0.45"/>`).join('');
  return out;
}

function palm(B, x, y, h, pal, r) {
  const lean = (r() - 0.35) * 0.4 * h;
  const tx = x + lean;
  const ty = y - h;
  const tl = mix(pal.trunk, '#1a0c08', 0.55);
  const d = `M ${f(x)} ${f(y + 2)} Q ${f(x + lean * 0.15)} ${f(y - h * 0.5)} ${f(tx)} ${f(ty)}`;
  let out = line(d, tl, f(h * 0.09)) + line(d, pal.trunk, f(h * 0.065)) + line(d, light(pal.trunk, 0.35), f(h * 0.05), `stroke-dasharray="${f(h * 0.02)} ${f(h * 0.07)}"`);
  const [l0, , l2] = pal.leaf;
  const g = B.lin([[0, l0], [1, l2]]);
  for (const deg of [-168, -135, -100, -62, -22, 8]) {
    const a = (deg * Math.PI) / 180;
    const len = h * (0.5 + Math.abs(Math.sin(a)) * 0.08);
    const ex = tx + Math.cos(a) * len;
    const ey = ty + Math.sin(a) * len * 0.6 + len * 0.42;
    const cx = tx + Math.cos(a) * len * 0.5;
    const cy = ty + Math.sin(a) * len * 0.5 - len * 0.22;
    out += `<path d="M ${f(tx)} ${f(ty)} Q ${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)} Q ${f(cx)} ${f(cy + len * 0.32)} ${f(tx)} ${f(ty)} Z" fill="${g}" stroke="${pal.leafLine}" stroke-width="${f(pal.lw * 0.6)}" stroke-linejoin="round"/>`;
    out += line(`M ${f(tx)} ${f(ty)} Q ${f(cx)} ${f(cy + len * 0.08)} ${f(ex)} ${f(ey)}`, l2, f(pal.lw * 0.45), 'opacity="0.6"');
  }
  out += `<circle cx="${f(tx - h * 0.05)}" cy="${f(ty + h * 0.05)}" r="${f(h * 0.045)}" fill="#6a4020"/><circle cx="${f(tx + h * 0.04)}" cy="${f(ty + h * 0.06)}" r="${f(h * 0.045)}" fill="#7a4a26"/>`;
  return out;
}

function pine(B, x, y, h, pal) {
  const [l0, l1, l2] = pal.leaf;
  let out = `<rect x="${f(x - h * 0.04)}" y="${f(y - h * 0.2)}" width="${f(h * 0.08)}" height="${f(h * 0.22)}" fill="${pal.trunk}"/>`;
  const g = B.lin([[0, l0], [0.5, l1], [1, l2]], ...hz());
  for (let k = 0; k < 3; k++) {
    const w = h * (0.36 - k * 0.08);
    const yy = y - h * 0.16 - k * h * 0.24;
    const top = yy - h * (0.38 - k * 0.02);
    out += `<path d="M ${f(x - w)} ${f(yy)} Q ${f(x - w * 0.3)} ${f(yy - h * 0.08)} ${f(x)} ${f(top)} Q ${f(x + w * 0.3)} ${f(yy - h * 0.08)} ${f(x + w)} ${f(yy)} Q ${f(x)} ${f(yy + h * 0.07)} ${f(x - w)} ${f(yy)} Z" fill="${g}" stroke="${pal.leafLine}" stroke-width="${f(pal.lw * 0.7)}" stroke-linejoin="round"/>`;
    if (pal.snowy) {
      const sy = top + h * 0.17;
      out += `<path d="M ${f(x - w * 0.42)} ${f(sy)} Q ${f(x - w * 0.1)} ${f(top + h * 0.03)} ${f(x)} ${f(top)} Q ${f(x + w * 0.1)} ${f(top + h * 0.03)} ${f(x + w * 0.42)} ${f(sy)} Q ${f(x + w * 0.2)} ${f(sy + h * 0.05)} ${f(x)} ${f(sy - h * 0.01)} Q ${f(x - w * 0.2)} ${f(sy + h * 0.05)} ${f(x - w * 0.42)} ${f(sy)} Z" fill="#ffffff"/>`;
    }
  }
  return out;
}

function cactus(B, x, y, h, pal) {
  const w = h * 0.17;
  const [l0, l1, l2] = pal.leaf;
  const g = B.lin([[0, l0], [0.45, l1], [1, l2]], ...hz());
  const st = `stroke="${pal.leafLine}" stroke-width="${f(pal.lw * 0.7)}"`;
  const arm = (ax, ay, dir, len) =>
    `<path d="M ${f(ax)} ${f(ay)} L ${f(ax + dir * w * 0.9)} ${f(ay)} Q ${f(ax + dir * w * 1.35)} ${f(ay)} ${f(ax + dir * w * 1.35)} ${f(ay - w * 0.5)} L ${f(ax + dir * w * 1.35)} ${f(ay - len)}" fill="none" stroke="${pal.leafLine}" stroke-width="${f(w * 0.72 + pal.lw * 1.4)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M ${f(ax)} ${f(ay)} L ${f(ax + dir * w * 0.9)} ${f(ay)} Q ${f(ax + dir * w * 1.35)} ${f(ay)} ${f(ax + dir * w * 1.35)} ${f(ay - w * 0.5)} L ${f(ax + dir * w * 1.35)} ${f(ay - len)}" fill="none" stroke="${l1}" stroke-width="${f(w * 0.72)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  let out = arm(x, y - h * 0.48, 1, h * 0.3) + arm(x, y - h * 0.34, -1, h * 0.22);
  out += `<rect x="${f(x - w / 2)}" y="${f(y - h)}" width="${f(w)}" height="${f(h + 4)}" rx="${f(w / 2)}" fill="${g}" ${st}/>`;
  out += line(`M ${f(x - w * 0.15)} ${f(y - h + w * 0.4)} L ${f(x - w * 0.15)} ${f(y)} M ${f(x + w * 0.2)} ${f(y - h + w * 0.4)} L ${f(x + w * 0.2)} ${f(y)}`, l2, f(pal.lw * 0.45), 'opacity="0.55"');
  out += line(`M ${f(x - w * 0.3)} ${f(y - h + w * 0.5)} L ${f(x - w * 0.3)} ${f(y - h * 0.4)}`, light(l0, 0.4), f(pal.lw * 0.6), 'opacity="0.7"');
  return out;
}

function deadTree(B, x, y, h, pal) {
  const t = pal.trunk;
  const tl = mix(t, '#000000', 0.35);
  const d = `M ${f(x)} ${f(y + 2)} Q ${f(x + h * 0.04)} ${f(y - h * 0.5)} ${f(x - h * 0.05)} ${f(y - h)} M ${f(x + h * 0.01)} ${f(y - h * 0.5)} Q ${f(x + h * 0.18)} ${f(y - h * 0.6)} ${f(x + h * 0.26)} ${f(y - h * 0.82)} M ${f(x - h * 0.02)} ${f(y - h * 0.68)} Q ${f(x - h * 0.16)} ${f(y - h * 0.74)} ${f(x - h * 0.22)} ${f(y - h * 0.9)} M ${f(x + h * 0.17)} ${f(y - h * 0.66)} L ${f(x + h * 0.3)} ${f(y - h * 0.66)}`;
  return line(d, tl, f(h * 0.075)) + line(d, t, f(h * 0.05)) + line(`M ${f(x - h * 0.012)} ${f(y - h * 0.1)} Q ${f(x + h * 0.02)} ${f(y - h * 0.5)} ${f(x - h * 0.05)} ${f(y - h * 0.9)}`, light(t, 0.3), f(h * 0.014), 'opacity="0.7"');
}

function bush(B, x, y, s, pal) {
  const [l0, l1, l2] = pal.leaf;
  const blobs = [[0, -12, 14], [-14, -7, 10], [14, -8, 11], [-5, -19, 9], [7, -18, 8]];
  let out = blobs.map(([bx, by, br]) => `<circle cx="${f(x + bx * s)}" cy="${f(y + by * s)}" r="${f(br * s + pal.lw * 0.8)}" fill="${pal.leafLine}"/>`).join('');
  const g = B.lin([[0, l0], [0.5, l1], [1, l2]], 0, y - 28 * s, 0, y, true);
  out += blobs.map(([bx, by, br]) => `<circle cx="${f(x + bx * s)}" cy="${f(y + by * s)}" r="${f(br * s)}" fill="${g}"/>`).join('');
  out += `<circle cx="${f(x - 6 * s)}" cy="${f(y - 20 * s)}" r="${f(4 * s)}" fill="${light(l0, 0.45)}" opacity="0.5"/>`;
  if (pal.snowy) out += `<path d="M ${f(x - 16 * s)} ${f(y - 12 * s)} Q ${f(x - 8 * s)} ${f(y - 30 * s)} ${f(x + 2 * s)} ${f(y - 27 * s)} Q ${f(x + 12 * s)} ${f(y - 26 * s)} ${f(x + 18 * s)} ${f(y - 12 * s)} Q ${f(x)} ${f(y - 18 * s)} ${f(x - 16 * s)} ${f(y - 12 * s)} Z" fill="#ffffff"/>`;
  return out;
}

function flowers(x, y, s, cols, r) {
  let out = '';
  for (let i = 0; i < 3; i++) {
    const fx = x + (i - 1) * 6 * s + (r() - 0.5) * 3 * s;
    const fy = y - (3 + r() * 4) * s;
    const c = cols[Math.floor(r() * cols.length)];
    out += line(`M ${f(fx)} ${f(y + 1)} L ${f(fx)} ${f(fy)}`, '#3d8a2c', f(1 * s));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      out += `<circle cx="${f(fx + Math.cos(a) * 1.6 * s)}" cy="${f(fy + Math.sin(a) * 1.6 * s)}" r="${f(1.3 * s)}" fill="${c}"/>`;
    }
    out += `<circle cx="${f(fx)}" cy="${f(fy)}" r="${f(1 * s)}" fill="${c === '#ffd23f' ? '#ff8a2a' : '#ffc93c'}"/>`;
  }
  return out;
}

function plant(kind, B, x, y, s, pal, r) {
  if (kind === 'palm') return palm(B, x, y, 95 * s, pal, r);
  if (kind === 'pine') return pine(B, x, y, 100 * s, pal);
  if (kind === 'cactus') return cactus(B, x, y, 80 * s, pal);
  if (kind === 'dead') return deadTree(B, x, y, 85 * s, pal);
  return roundTree(B, x, y, s, pal);
}

function island(B, r, x, y, s, pal, b, fall) {
  const w = 110 * s;
  const under = `M ${f(x - w)} ${f(y + 8 * s)} C ${f(x - w * 0.85)} ${f(y + 60 * s)} ${f(x - w * 0.4)} ${f(y + 100 * s)} ${f(x - w * 0.12)} ${f(y + 160 * s)} L ${f(x + w * 0.02)} ${f(y + 192 * s)} L ${f(x + w * 0.16)} ${f(y + 150 * s)} C ${f(x + w * 0.5)} ${f(y + 95 * s)} ${f(x + w * 0.85)} ${f(y + 55 * s)} ${f(x + w)} ${f(y + 8 * s)} Z`;
  const [rl, rm, rd] = pal.rock;
  let s0 = `<path d="${under}" fill="${B.lin([[0, rl], [0.4, rm], [1, rd]], ...hz())}"/>`;
  let inner = '';
  for (let k = 1; k < 6; k++) inner += line(`M ${f(x - w)} ${f(y + k * 30 * s)} L ${f(x + w)} ${f(y + k * 30 * s + (r() - 0.5) * 8)}`, mix(rd, '#140810', 0.3), f(pal.lw), 'opacity="0.45"');
  inner += `<rect x="${f(x - w)}" y="${f(y)}" width="${f(w * 2)}" height="${f(200 * s)}" fill="${B.lin([[0, rd, 0], [1, rd, 0.85]])}"/>`;
  s0 += `<g clip-path="${B.clip(`<path d="${under}"/>`)}">${inner}</g><path d="${under}" fill="none" stroke="${pal.line}" stroke-width="${f(pal.lw)}" stroke-linejoin="round"/>`;
  if (fall) s0 += waterfall(B, x + w * 0.6, y + 10 * s, y + 470 * s, 13 * s, pal, true).body;
  s0 += cap(B, x - w - 6, y - 4 * s, 2 * w + 12, 20 * s, pal);
  s0 += plant(b.plants[0], B, x - w * 0.35, y - 4 * s, s * 0.7, pal, r) + bush(B, x + w * 0.15, y - 4 * s, s * 0.9, pal);
  return s0;
}

function castle(B, x, y, s, pal) {
  const [sl, sm, sd] = pal.stone;
  const [rl, rm, rd] = pal.roof;
  const ln = `stroke="${pal.line}" stroke-width="${f(pal.lw)}" stroke-linejoin="round"`;
  const sg = B.lin([[0, sl], [0.45, sm], [1, sd]], ...hz());
  const rg = B.lin([[0, rl], [0.5, rm], [1, rd]], ...hz());
  const tower = (tx, tw, th, rh, flag) => {
    let t = `<rect x="${f(tx - tw / 2)}" y="${f(y - th)}" width="${f(tw)}" height="${f(th + 24)}" fill="${sg}" ${ln}/>`;
    t += `<rect x="${f(tx - tw * 0.13)}" y="${f(y - th * 0.72)}" width="${f(tw * 0.26)}" height="${f(th * 0.17)}" rx="${f(tw * 0.13)}" fill="${pal.window}"/>`;
    t += `<path d="M ${f(tx - tw / 2 - 7 * s)} ${f(y - th)} L ${f(tx)} ${f(y - th - rh)} L ${f(tx + tw / 2 + 7 * s)} ${f(y - th)} Z" fill="${rg}" ${ln}/>`;
    if (flag) t += line(`M ${f(tx)} ${f(y - th - rh)} L ${f(tx)} ${f(y - th - rh - 30 * s)}`, pal.line, f(pal.lw)) + `<path d="M ${f(tx)} ${f(y - th - rh - 30 * s)} L ${f(tx + 24 * s)} ${f(y - th - rh - 24 * s)} L ${f(tx)} ${f(y - th - rh - 17 * s)} Z" fill="${pal.flag}"/>`;
    return t;
  };
  let out = tower(x - 42 * s, 30 * s, 132 * s, 48 * s) + tower(x + 40 * s, 30 * s, 144 * s, 50 * s);
  out += `<rect x="${f(x - 96 * s)}" y="${f(y - 72 * s)}" width="${f(192 * s)}" height="${f(96 * s)}" fill="${sg}" ${ln}/>`;
  for (let k = 0; k < 8; k++) out += `<rect x="${f(x - 96 * s + k * 25 * s)}" y="${f(y - 84 * s)}" width="${f(14 * s)}" height="${f(14 * s)}" fill="${sg}" ${ln}/>`;
  out += `<path d="M ${f(x - 16 * s)} ${f(y + 20)} L ${f(x - 16 * s)} ${f(y - 30 * s)} Q ${f(x)} ${f(y - 48 * s)} ${f(x + 16 * s)} ${f(y - 30 * s)} L ${f(x + 16 * s)} ${f(y + 20)} Z" fill="${pal.window}"/>`;
  out += tower(x - 86 * s, 42 * s, 116 * s, 60 * s, true) + tower(x + 88 * s, 40 * s, 106 * s, 56 * s, true) + tower(x, 62 * s, 172 * s, 92 * s, true);
  return out;
}

function watchtower(B, x, y, s, pal) {
  const [wl, wm, wd] = pal.wood;
  const wg = B.lin([[0, wl], [0.5, wm], [1, wd]], ...hz());
  const ink = mix(wd, '#120806', 0.5);
  const beam = (d, w) => line(d, ink, f(w + pal.lw)) + line(d, wm, f(w));
  let out = beam(`M ${f(x - 36 * s)} ${f(y + 10)} L ${f(x - 25 * s)} ${f(y - 124 * s)}`, 7 * s) + beam(`M ${f(x + 36 * s)} ${f(y + 10)} L ${f(x + 25 * s)} ${f(y - 124 * s)}`, 7 * s);
  out += beam(`M ${f(x - 33 * s)} ${f(y - 16 * s)} L ${f(x + 27 * s)} ${f(y - 100 * s)}`, 4 * s) + beam(`M ${f(x + 33 * s)} ${f(y - 16 * s)} L ${f(x - 27 * s)} ${f(y - 100 * s)}`, 4 * s);
  out += beam(`M ${f(x - 31 * s)} ${f(y - 58 * s)} L ${f(x + 31 * s)} ${f(y - 58 * s)}`, 4 * s);
  out += `<rect x="${f(x - 42 * s)}" y="${f(y - 134 * s)}" width="${f(84 * s)}" height="${f(12 * s)}" rx="${f(3 * s)}" fill="${wg}" stroke="${ink}" stroke-width="${f(pal.lw)}"/>`;
  out += `<rect x="${f(x - 30 * s)}" y="${f(y - 178 * s)}" width="${f(60 * s)}" height="${f(46 * s)}" fill="${wg}" stroke="${ink}" stroke-width="${f(pal.lw)}"/>`;
  for (let k = 1; k < 5; k++) out += line(`M ${f(x - 30 * s + k * 12 * s)} ${f(y - 176 * s)} L ${f(x - 30 * s + k * 12 * s)} ${f(y - 134 * s)}`, wd, f(pal.lw * 0.6), 'opacity="0.6"');
  out += `<rect x="${f(x - 9 * s)}" y="${f(y - 168 * s)}" width="${f(18 * s)}" height="${f(16 * s)}" rx="${f(3 * s)}" fill="${pal.window}"/>`;
  const [rl, rm, rd] = pal.woodRoof;
  out += `<path d="M ${f(x - 46 * s)} ${f(y - 174 * s)} L ${f(x)} ${f(y - 214 * s)} L ${f(x + 46 * s)} ${f(y - 174 * s)} Z" fill="${B.lin([[0, rl], [0.5, rm], [1, rd]], ...hz())}" stroke="${ink}" stroke-width="${f(pal.lw)}" stroke-linejoin="round"/>`;
  out += line(`M ${f(x)} ${f(y - 214 * s)} L ${f(x)} ${f(y - 252 * s)}`, ink, f(pal.lw)) + `<path d="M ${f(x)} ${f(y - 252 * s)} L ${f(x + 28 * s)} ${f(y - 245 * s)} L ${f(x)} ${f(y - 236 * s)} Z" fill="${pal.flag}"/>`;
  return out;
}

function temple(B, x, y, s, pal) {
  const [tl, tm, td] = pal.temple;
  const g = B.lin([[0, tl], [0.5, tm], [1, td]], ...hz());
  const ln = `stroke="${mix(td, '#101408', 0.4)}" stroke-width="${f(pal.lw)}"`;
  let out = '';
  for (let k = 0; k < 5; k++) {
    const w = (220 - k * 38) * s;
    out += `<rect x="${f(x - w / 2)}" y="${f(y - (k + 1) * 34 * s)}" width="${f(w)}" height="${f(36 * s)}" fill="${g}" ${ln}/>`;
  }
  out += `<rect x="${f(x - 18 * s)}" y="${f(y - 170 * s)}" width="${f(36 * s)}" height="${f(170 * s)}" fill="${light(tm, 0.18)}" ${ln}/>`;
  for (let k = 1; k < 10; k++) out += line(`M ${f(x - 18 * s)} ${f(y - k * 17 * s)} L ${f(x + 18 * s)} ${f(y - k * 17 * s)}`, td, f(pal.lw * 0.6), 'opacity="0.5"');
  out += `<rect x="${f(x - 30 * s)}" y="${f(y - 214 * s)}" width="${f(60 * s)}" height="${f(46 * s)}" fill="${g}" ${ln}/><rect x="${f(x - 10 * s)}" y="${f(y - 204 * s)}" width="${f(20 * s)}" height="${f(36 * s)}" rx="${f(10 * s)}" fill="${pal.window}"/>`;
  for (const vx of [-90, -60, 50, 85]) out += line(`M ${f(x + vx * s)} ${f(y - 140 * s + Math.abs(vx) * s * 0.6)} q ${f(6 * s)} ${f(30 * s)} ${f(-2 * s)} ${f(60 * s)}`, pal.moss, f(pal.lw * 1.4));
  return out;
}

function arch(B, x, y, s, pal) {
  const [rl, rm, rd] = pal.rock;
  const d = `M ${f(x - 160 * s)} ${f(y)} L ${f(x - 130 * s)} ${f(y - 250 * s)} C ${f(x - 100 * s)} ${f(y - 330 * s)} ${f(x + 100 * s)} ${f(y - 330 * s)} ${f(x + 130 * s)} ${f(y - 250 * s)} L ${f(x + 160 * s)} ${f(y)} L ${f(x + 80 * s)} ${f(y)} L ${f(x + 70 * s)} ${f(y - 170 * s)} C ${f(x + 50 * s)} ${f(y - 240 * s)} ${f(x - 50 * s)} ${f(y - 240 * s)} ${f(x - 70 * s)} ${f(y - 170 * s)} L ${f(x - 80 * s)} ${f(y)} Z`;
  let inner = '';
  for (let k = 0; k < 12; k++) inner += `<rect x="${f(x - 200 * s)}" y="${f(y - 330 * s + k * 30 * s)}" width="${f(400 * s)}" height="${f(12 * s)}" fill="${k % 2 ? light(rm, 0.2) : rd}" opacity="0.4"/>`;
  return `<path d="${d}" fill="${B.lin([[0, rl], [0.4, rm], [1, rd]], ...hz())}"/><g clip-path="${B.clip(`<path d="${d}"/>`)}">${inner}</g><path d="${d}" fill="none" stroke="${pal.line}" stroke-width="${f(pal.lw)}" stroke-linejoin="round"/>` +
    cap(B, x - 136 * s, y - 304 * s, 272 * s, 18 * s, pal);
}

function peak(B, x, base, w, h, pal) {
  const [rl, rm, rd] = pal.rock;
  const px = x + w * 0.06;
  const py = base - h;
  let out = `<path d="M ${f(x - w / 2)} ${f(base)} L ${f(px)} ${f(py)} L ${f(x + w / 2)} ${f(base)} Z" fill="${B.lin([[0, rl], [0.45, rm], [1, rd]], ...hz())}" stroke="${pal.line}" stroke-width="${f(pal.lw)}" stroke-linejoin="round"/>`;
  out += `<path d="M ${f(px)} ${f(py)} L ${f(x + w / 2)} ${f(base)} L ${f(x + w * 0.12)} ${f(base)} Z" fill="${rd}" opacity="0.3"/>`;
  const k = 0.36;
  const sx0 = px + (x - w / 2 - px) * k;
  const sx1 = px + (x + w / 2 - px) * k;
  const sy = py + h * k;
  out += `<path d="M ${f(px)} ${f(py)} L ${f(sx1)} ${f(sy)} L ${f(sx1 - w * 0.06)} ${f(sy - h * 0.05)} L ${f(px + w * 0.05)} ${f(sy + h * 0.04)} L ${f(px - w * 0.04)} ${f(sy - h * 0.06)} L ${f(sx0 + w * 0.05)} ${f(sy + h * 0.02)} L ${f(sx0)} ${f(sy)} Z" fill="${B.lin([[0, '#ffffff'], [0.6, pal.cap[1]], [1, pal.cap[2]]], ...hz())}" stroke="${pal.line}" stroke-width="${f(pal.lw * 0.8)}" stroke-linejoin="round"/>`;
  return out;
}

function volcanoCone(B, x, base, w, h, pal, plume) {
  const [rl, rm, rd] = pal.rock;
  const d = `M ${f(x - w / 2)} ${f(base)} C ${f(x - w * 0.25)} ${f(base - h * 0.4)} ${f(x - w * 0.12)} ${f(base - h * 0.85)} ${f(x - w * 0.09)} ${f(base - h)} L ${f(x + w * 0.09)} ${f(base - h)} C ${f(x + w * 0.12)} ${f(base - h * 0.85)} ${f(x + w * 0.25)} ${f(base - h * 0.4)} ${f(x + w / 2)} ${f(base)} Z`;
  let out = '';
  if (plume) {
    const g = B.rad([[0, '#4a3240', 0.85], [1, '#4a3240', 0]]);
    for (let k = 0; k < 6; k++) out += `<circle cx="${f(x + k * 34 + Math.sin(k) * 20)}" cy="${f(base - h - 40 - k * 70)}" r="${f(50 + k * 22)}" fill="${g}"/>`;
  }
  out += `<path d="${d}" fill="${B.lin([[0, rl], [0.4, rm], [1, rd]], ...hz())}" stroke="${pal.line}" stroke-width="${f(pal.lw)}" stroke-linejoin="round"/>`;
  out += `<ellipse cx="${f(x)}" cy="${f(base - h)}" rx="${f(w * 0.16)}" ry="${f(h * 0.08)}" fill="${B.rad([[0, '#ffe680', 0.95], [0.5, '#ff8a2a', 0.6], [1, '#ff5a1f', 0]])}"/>`;
  const lava = `M ${f(x - w * 0.02)} ${f(base - h)} C ${f(x + w * 0.04)} ${f(base - h * 0.7)} ${f(x - w * 0.06)} ${f(base - h * 0.45)} ${f(x + w * 0.03)} ${f(base)}`;
  out += line(lava, '#ff5a1f', f(w * 0.05), 'opacity="0.35"') + line(lava, '#ff8a2a', f(w * 0.022)) + line(lava, '#ffe066', f(w * 0.008));
  return out;
}

/** A rolling hill layer with a lit cap band along the ridge. */
function hills(B, pts, pal) {
  const [h0, h1] = pal.hill;
  const top = curve(pts);
  const body = `${top} L ${f(pts.at(-1)[0])} ${BH} L ${f(pts[0][0])} ${BH} Z`;
  const clip = B.clip(`<path d="${body}"/>`);
  return `<path d="${body}" fill="${B.lin([[0, h0], [0.55, mix(h0, h1, 0.7)], [1, h1]])}"/>` +
    `<g clip-path="${clip}"><path d="${top}" fill="none" stroke="${pal.cap[1]}" stroke-width="${f(pal.lw * 11)}"/>` +
    `<path d="${top}" fill="none" stroke="${pal.cap[2]}" stroke-width="${f(pal.lw * 1.2)}" transform="translate(0 ${f(pal.lw * 5.6)})" opacity="0.7"/>` +
    `<path d="${top}" fill="none" stroke="${light(pal.cap[0], 0.4)}" stroke-width="${f(pal.lw * 2.4)}" opacity="0.9"/></g>` +
    `<path d="${top}" fill="none" stroke="${pal.capLine}" stroke-width="${f(pal.lw)}"/>`;
}

function ridge(r, base, amp, step, rough = 0.35) {
  const pts = [];
  let y = base;
  for (let x = -40; x <= BW + 120; x += step) {
    y += (r() - 0.5) * amp * rough;
    y += (base - y) * 0.12;
    pts.push([x, y + Math.sin(x / (380 + amp)) * amp * 0.6]);
  }
  return pts;
}
function curve(pts) {
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += ` Q ${f(pts[i - 1][0])} ${f(pts[i - 1][1])} ${f((pts[i - 1][0] + pts[i][0]) / 2)} ${f((pts[i - 1][1] + pts[i][1]) / 2)}`;
  return d;
}
function hillTop(pts, x) {
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) return (pts[i - 1][1] + pts[i][1]) / 2;
  return pts.at(-1)[1];
}

function sun(B, x, y, color) {
  return `<circle cx="${x}" cy="${y}" r="420" fill="${B.rad([[0, color, 0.75], [0.12, color, 0.6], [0.13, '#ffffff', 0.3], [1, '#ffffff', 0]])}"/>`;
}
function cloudBank(B, r, y, color) {
  const g = B.lin([[0, '#ffffff', 0.85], [1, color, 0.55]], 0, y - 60, 0, y + 40, true);
  let out = '';
  for (let x = -100; x < BW + 100; x += 140 + r() * 160) out += `<ellipse cx="${f(x)}" cy="${f(y + (r() - 0.5) * 30)}" rx="${f(110 + r() * 120)}" ry="${f(36 + r() * 30)}" fill="${g}"/>`;
  return out;
}

// ---------------------------------------------------------------- backgrounds
export function buildBackgrounds(maps, part, manifest) {
  for (const map of maps) {
    const b = BIOMES[map.id] ?? BIOMES.grasslands;
    const r = rand(map.id.length * 7919 + map.id.charCodeAt(0) + 31);
    const layers = [];

    // FAR: landmarks and distant cliffs, heavily hazed.
    {
      const B = builder();
      const pal = layerPal(b, 0.36);
      let s = sun(B, 3200, 220, b.sun);
      if (map.id === 'volcano') s = sun(B, 3000, 420, b.sun);
      s += cloudBank(B, r, 560, b.haze);
      if (b.far === 'plateaus' || b.far === 'buttes') {
        for (let i = 0; i < 7; i++) {
          const x = i * 680 + r() * 220 - 160;
          if (x > 1450 && x < 2350) continue; // landmark slot
          s += plateau(B, r, x, 440 + r() * 150, 240 + r() * 300, pal, { lean: 0.03, rowH: 42, stripes: b.stripes });
        }
      } else if (b.far === 'peaks') {
        for (let i = 0; i < 16; i++) s += peak(B, -150 + i * 310 + r() * 120, 760, 420 + r() * 260, 300 + r() * 260, pal);
      } else if (b.far === 'volcanoes') {
        s += volcanoCone(B, 1350, 760, 700, 300, pal, false) + volcanoCone(B, 3300, 760, 820, 340, pal, true) + volcanoCone(B, 2050, 760, 1100, 500, pal, true);
      }
      if (b.landmark === 'castle') {
        s += plateau(B, r, 1640, 330, 470, pal, { lean: 0.02, rowH: 40 });
        const fl = waterfall(B, 1770, 352, 820, 26, pal, true);
        const fr = waterfall(B, 2010, 352, 820, 20, pal, true);
        s += fl.body + fr.body + castle(B, 1875, 328, 1.05, pal);
      } else if (b.landmark === 'temple') {
        s += plateau(B, r, 1620, 390, 520, pal, { lean: 0.02, rowH: 40 });
        s += waterfall(B, 1700, 410, 860, 30, pal, true).body + waterfall(B, 2060, 410, 860, 24, pal, true).body + temple(B, 1880, 392, 1.0, pal);
      } else if (b.landmark === 'arch') {
        s += arch(B, 1900, 700, 1.4, pal);
      }
      if (b.islands) {
        for (const [x, y, k, fall] of [[620, 250, 0.9, true], [1180, 150, 0.45, false], [2750, 200, 0.7, true], [3350, 330, 0.5, false], [4050, 210, 0.8, true]]) s += island(B, r, x, y, k, pal, b, fall);
      }
      const pts = ridge(r, map.id === 'snow' ? 700 : 660, 90, 80);
      s += hills(B, pts, pal);
      for (let i = 0; i < 18; i++) {
        const x = r() * BW;
        s += plant(b.plants[i % 2], B, x, hillTop(pts, x) + 6, 0.45 + r() * 0.2, pal, r);
      }
      part(`bg_${map.id}_far`, [0, 0, BW, BH], B.svg(s), 0.5);
      layers.push({ key: `bg_${map.id}_far`, factor: 0.15, x: -1000, y: -170 });
    }

    // MID: cliffs with plants, a waterfall and a landmark, lightly hazed.
    {
      const B = builder();
      const pal = layerPal(b, 0.14);
      const pts = ridge(r, 760, map.id === 'snow' ? 130 : 100, 60, 0.35);
      let s = '';
      let foam = '';
      const cliffs = [[200, 560, 420], [1220, 520, 380], [2380, 590, 520], [3520, 540, 400]];
      cliffs.forEach(([x0, top0, w0], i) => {
        const x = x0 + r() * 120;
        const top = top0 + r() * 40;
        const w = w0 + r() * 80;
        s += plateau(B, r, x, top, w, pal, { stripes: b.stripes });
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) s += plant(b.plants[k % 2], B, x + w * (0.18 + 0.3 * k + r() * 0.1), top - 2, 0.62 + r() * 0.2, pal, r);
        s += bush(B, x + w * (0.5 + r() * 0.3), top - 2, 1 + r() * 0.5, pal);
        if (i === 1 && b.landmark === 'castle') s += watchtower(B, x + w * 0.62, top - 2, 0.9, pal);
        if (i === 2 && map.id !== 'canyon') {
          const fx = x + w * 0.42;
          const wf = waterfall(B, fx, top + 14, hillTop(pts, fx) + 10, 34, pal, false);
          s += wf.body;
          foam += wf.foam;
        }
      });
      s += hills(B, pts, pal) + foam;
      for (let i = 0; i < 22; i++) {
        const x = r() * BW;
        s += plant(b.plants[i % 2], B, x, hillTop(pts, x) + 8, 0.62 + r() * 0.25, pal, r);
      }
      for (let i = 0; i < 26; i++) {
        const x = r() * BW;
        s += bush(B, x, hillTop(pts, x) + 8, 1 + r() * 0.6, pal);
      }
      part(`bg_${map.id}_mid`, [0, 0, BW, BH], B.svg(s), 0.5);
      layers.push({ key: `bg_${map.id}_mid`, factor: 0.32, x: -1000, y: -210 });
    }

    // NEAR: lush rolling hills right behind the battlefield.
    {
      const B = builder();
      const pal = layerPal(b, 0.08, 3);
      const pts = ridge(r, 880, 120, 50, 0.45);
      let s = hills(B, pts, pal);
      for (let i = 0; i < 16; i++) {
        const x = r() * BW;
        s += plant(b.plants[i % 2], B, x, hillTop(pts, x) + 10, 0.85 + r() * 0.35, pal, r);
      }
      for (let i = 0; i < 34; i++) {
        const x = r() * BW;
        s += bush(B, x, hillTop(pts, x) + 10, 1.3 + r() * 0.8, pal);
      }
      for (let i = 0; i < 40; i++) {
        const x = r() * BW;
        s += flowers(x, hillTop(pts, x) + 10, 2.4, pal.flowers, r);
      }
      part(`bg_${map.id}_near`, [0, 0, BW, BH], B.svg(s), 0.5);
      layers.push({ key: `bg_${map.id}_near`, factor: 0.55, x: -1000, y: -240 });
    }
    manifest.backgrounds[map.id] = layers;
  }
}

// ---------------------------------------------------------------- decor sprites (on the terrain)
/**
 * Per map: deco_<map>_tuft, _bloom, _bush, _tree, _tree2. Origin is the ground contact point.
 * Drawn by web TerrainLayer and godot decor.gd; they are not solid and vanish when their ground
 * is blown away.
 */
export function buildDecor(maps, part) {
  for (const map of maps) {
    const b = BIOMES[map.id] ?? BIOMES.grasslands;
    const p = map.palette;
    const pal = layerPal(b, 0, 1.3);
    // Ground details use the map's own terrain colours so they blend with the painted cap.
    pal.cap = [p.topLight, p.top, mix(p.top, '#1a2a10', 0.35)];
    pal.capLine = lineOf(p.top);
    const r = rand(map.id.charCodeAt(0) * 131 + 7);

    {
      const B = builder();
      const [c0, c1, c2] = map.id === 'snow' ? ['#ffffff', '#e2eefc', '#a9c2e6'] : pal.cap;
      const g = B.lin([[0, light(c0, 0.2)], [0.5, c1], [1, c2]]);
      let s = '';
      for (const [x0, lean, h] of [[-6, -3, 8], [-3, -1, 11], [0, 1.5, 9.5], [3, 3.5, 12], [5.5, 5, 7]]) {
        s += `<path d="M ${x0} 1 Q ${f(x0 + lean * 0.4)} ${f(-h * 0.55)} ${f(x0 + lean)} ${-h} Q ${f(x0 + lean * 0.3 + 1.2)} ${f(-h * 0.45)} ${f(x0 + 2.4)} 1 Z" fill="${g}" stroke="${map.id === 'snow' ? '#7f96c0' : pal.capLine}" stroke-width="0.8" stroke-linejoin="round"/>`;
      }
      part(`deco_${map.id}_tuft`, [-9, -14, 18, 16], B.svg(s));
    }
    {
      const B = builder();
      let s;
      if (map.id === 'volcano') {
        s = [[-4, 0, 3.4], [3, 0, 2.6]].map(([x, y, k]) => `<path d="M ${x - k} ${y + 1} L ${x - k * 0.5} ${y - k * 1.6} L ${x + k * 0.3} ${y - k * 2.4} L ${x + k} ${y + 1} Z" fill="${B.lin([[0, '#fff2a0'], [0.4, '#ff9a2e'], [1, '#c8321a']])}" stroke="#4a1a10" stroke-width="0.8" stroke-linejoin="round"/>`).join('');
      } else if (map.id === 'snow') {
        s = `<ellipse cx="0" cy="-1" rx="7" ry="3.6" fill="${B.lin([[0, '#ffffff'], [1, '#bcd0ee']])}" stroke="#7f96c0" stroke-width="0.8"/>` + line('M 3 -8 L 3 -2 M 0.4 -6.5 L 5.6 -3.5 M 5.6 -6.5 L 0.4 -3.5', '#a8d4ff', 1);
      } else s = flowers(0, 1, 1.6, pal.flowers, r);
      part(`deco_${map.id}_bloom`, [-10, -14, 20, 16], B.svg(s));
    }
    {
      const B = builder();
      let s;
      if (map.id === 'volcano') {
        const rockPal = { ...pal, leaf: ['#7a6470', '#4e3a48', '#24161f'], leafLine: '#1c1016' };
        s = bush(B, 0, 1, 0.75, rockPal) + `<path d="M -6 -6 L -3 -9 L 0 -7 L 4 -11" fill="none" stroke="#ff8a2a" stroke-width="1.2" stroke-linecap="round"/>`;
      } else if (map.id === 'canyon') {
        s = deadTree(B, 0, 1, 22, { ...pal, trunk: '#8a6a44' }) + bush(B, 0, 1, 0.5, { ...pal, leaf: ['#d6d07a', '#9a9a4a', '#5a5a2a'] });
      } else s = bush(B, 0, 1, 0.8, pal);
      part(`deco_${map.id}_bush`, [-22, -32, 44, 34], B.svg(s));
    }
    for (const [i, key] of [[0, 'tree'], [1, 'tree2']]) {
      const B = builder();
      const kind = b.plants[i];
      const s = kind === 'tree' ? roundTree(B, 0, 1, 0.6, pal) : kind === 'palm' ? palm(B, 0, 1, 58, pal, () => 0.5 + i * 0.3) : kind === 'pine' ? pine(B, 0, 1, i ? 46 : 62, pal) : kind === 'cactus' ? (i ? cactus(B, 0, 1, 30, pal) : cactus(B, 0, 1, 48, pal)) : deadTree(B, 0, 1, i ? 40 : 54, pal);
      part(`deco_${map.id}_${key}`, [-40, -72, 80, 76], B.svg(s));
    }
  }
}
