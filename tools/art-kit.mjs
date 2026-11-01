// Shared drawing kit for the Wildlings art generator (docs/ART_DIRECTION.md, "Sunlit Isles").
// Colour helpers, shape builders and the 2.5D volume shader `vol()` used by every sprite.
// Everything renders with plain fills, gradients, clip paths and strokes: no SVG filters, because
// Godot rasterises these files with ThorVG, which ignores them.

export const INK = '#16203f'; // UI and logo ink (deep navy)
export const rgb = (h) => {
  const n = parseInt(h.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
export const dark = (c, t) => mix(c, '#2a1d4a', t);
export const light = (c, t) => mix(c, '#fffdf0', t);
/** Line art is a deep, warm version of the fill (coloured outlines, never pure black). */
export const lineOf = (c) => mix(c, '#24100c', 0.7);
/** Form shadows lean warm-violet so they stay saturated. */
export const shadeOf = (c) => mix(c, '#3a1446', 0.5);
export const f = (n) => +(+n).toFixed(2);

let uid = 0;
export const nextId = () => ++uid;

// ---------------------------------------------------------------- shapes: (attrs) => svg element
export const E = (cx, cy, rx, ry, rot = 0) => (a) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"${rot ? ` transform="rotate(${f(rot)} ${f(cx)} ${f(cy)})"` : ''} ${a}/>`;
export const P = (d) => (a) => `<path d="${d}" ${a}/>`;
export const R = (x, y, w, h, r = Math.min(w, h) * 0.3) => (a) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" ${a}/>`;
export const C = (cx, cy, r) => E(cx, cy, r, r);
export const line = (d, color, w, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
export const flat = (shape, fill, extra = '') => shape(`fill="${fill}" ${extra}`);
export const star = (r, inner = 0.45, n = 5) => {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    pts.push(`${f(Math.cos(a) * rr)},${f(Math.sin(a) * rr)}`);
  }
  return P(`M ${pts.join(' L ')} Z`);
};

/**
 * 2.5D volume shading. Light comes from the top-left:
 *  1. base fill, then `inner` detail patches (belly, stripes...) so they are lit the same way
 *  2. a soft key-light gradient from the top-left and a warm-violet form shadow to the lower right
 *  3. ambient-occlusion blobs (`ao`: [cx, cy, rx, ry, alpha?]) where other parts touch
 *  4. a rim light hugging the upper-left edge and a faint warm bounce light on the lower right
 *     (offset strokes clipped to the shape)
 *  5. a soft specular highlight (`hl`: [cx, cy, rx, ry]) and `front` details
 *  6. coloured line art (`ink`, width `sw`)
 */
export function vol(shape, fill, o = {}) {
  const id = nextId();
  const sw = o.sw ?? 1.8;
  const ink = o.ink ?? lineOf(fill);
  const sh = o.shade ?? shadeOf(fill);
  const lA = o.lightA ?? 0.42;
  const sA = o.shadeA ?? 0.62;
  const d = o.rim ?? 0.9;
  let s = `<defs><clipPath id="k${id}">${shape('')}</clipPath>` +
    `<linearGradient id="l${id}" x1="0.1" y1="0" x2="0.62" y2="0.72"><stop offset="0" stop-color="#fffbea" stop-opacity="${lA}"/><stop offset="1" stop-color="#fffbea" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="s${id}" x1="0.2" y1="0.12" x2="0.86" y2="1"><stop offset="0.42" stop-color="${sh}" stop-opacity="0"/><stop offset="1" stop-color="${sh}" stop-opacity="${sA}"/></linearGradient>`;
  if (o.hl) {
    const a = o.hlA ?? 0.85;
    s += `<radialGradient id="h${id}"><stop offset="0" stop-color="#ffffff" stop-opacity="${a}"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="${f(a * 0.5)}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`;
  }
  if (o.ao) s += `<radialGradient id="a${id}"><stop offset="0" stop-color="${mix(sh, '#1a0820', 0.4)}" stop-opacity="1"/><stop offset="1" stop-color="${mix(sh, '#1a0820', 0.4)}" stop-opacity="0"/></radialGradient>`;
  s += '</defs>';
  s += shape(`fill="${fill}"`);
  s += `<g clip-path="url(#k${id})">${o.inner ?? ''}`;
  s += shape(`fill="url(#l${id})"`) + shape(`fill="url(#s${id})"`);
  if (o.ao) for (const [cx, cy, rx, ry, a = 0.45] of o.ao) s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="url(#a${id})" opacity="${a}"/>`;
  if (d) {
    s += `<g transform="translate(${f(d)} ${f(d * 1.15)})">${shape(`fill="none" stroke="${o.rimC ?? '#ffffff'}" stroke-opacity="${o.rimA ?? 0.5}" stroke-width="${f(d * 2.2)}"`)}</g>`;
    if ((o.bounceA ?? 0.22) > 0) s += `<g transform="translate(${f(-d)} ${f(-d * 1.15)})">${shape(`fill="none" stroke="${o.bounce ?? '#ffd9b0'}" stroke-opacity="${o.bounceA ?? 0.22}" stroke-width="${f(d * 2.2)}"`)}</g>`;
  }
  if (o.hl) {
    const [cx, cy, rx, ry] = o.hl;
    s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx * 1.5)}" ry="${f(ry * 1.5)}" fill="url(#h${id})" transform="rotate(-28 ${f(cx)} ${f(cy)})"/>`;
  }
  s += (o.front ?? '') + '</g>';
  if (sw > 0) s += shape(`fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"`);
  return s;
}

/** Deterministic PRNG (mulberry32) for scenery placement. */
export function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
