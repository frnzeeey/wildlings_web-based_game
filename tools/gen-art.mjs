// Wildlings art generator (v4, "Sunlit Isles"): every visual asset as SVG. 2.5D-shaded critters
// with individual body plans and gear, chunky weapons, projectiles, props, cartoon FX, terrain
// decor, HUD icons, the logo, the UI kit and painted parallax worlds. Both clients load these
// files (docs/ART_DIRECTION.md). Shading model: tools/art-kit.mjs; worlds: tools/art-worlds.mjs.
// Run: node tools/gen-art.mjs   (writes shared/assets/art/*.svg + manifest.json)
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { INK, mix, dark, light, f, E, P, R, C, line, flat, star, vol, rand } from './art-kit.mjs';
import { buildBackgrounds, buildDecor } from './art-worlds.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'shared/assets/art');
const { characters } = JSON.parse(readFileSync(join(root, 'shared/spec/characters.json'), 'utf8'));
const { weapons } = JSON.parse(readFileSync(join(root, 'shared/spec/weapons.json'), 'utf8'));
const { maps } = JSON.parse(readFileSync(join(root, 'shared/spec/maps.json'), 'utf8'));
const display = opentype.loadSync(join(root, 'shared/assets/fonts/LilitaOne-Regular.ttf'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const manifest = { scale: 3, parts: {}, species: {}, backgrounds: {}, ui: {} };

function part(name, box, body, scale = manifest.scale) {
  const [x, y, w, h] = box;
  writeFileSync(join(out, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}">${body}</svg>\n`);
  manifest.parts[name] = { x, y, w, h, ...(scale !== manifest.scale ? { scale } : {}) };
}

// ---------------------------------------------------------------- critters
// Local frame: feet at (0, 0), facing right, light from the top-left. Each species has its own
// body plan and gear; the rig anchors (eyes, mouth, feet, arm, team garment) go into the manifest.
const CBOX = [-40, -84, 80, 88];
const designs = {};
const EYE_INK = '#2a1418';

/**
 * Per-critter drawing kit. T = volume-shaded part in the critter's own line colour, S = small
 * detail, W = white garment (tinted with the team colour at runtime, so it shades neutrally),
 * tube = an outlined strap or limb, fur = soft fur strokes.
 */
const kit = (c) => {
  const ink = mix(c.dark, '#1e0c08', 0.6);
  const T = (shape, fill, o = {}) => vol(shape, fill, { ink, ...o });
  return {
    ink,
    T,
    S: (shape, fill, o = {}) => T(shape, fill, { sw: 1.3, rim: 0.4, ...o }),
    W: (shape, o = {}) => vol(shape, '#ffffff', { ink, shade: '#7a7092', shadeA: 0.55, bounceA: 0, rimA: 0, ...o }),
    tube: (d, col, w) => line(d, ink, w + 2) + line(d, col, w) + line(d, '#ffffff', f(w * 0.3), 'opacity="0.35" transform="translate(-0.3 -0.4)"'),
    blush: (x, y, rx = 3, ry = 1.7) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#ff5d7a" opacity="0.38"/>`,
    nose: (cx, cy, rx, ry, col = '#2a1418') => T(E(cx, cy, rx, ry), col, { sw: 1.2, rim: 0.3, bounceA: 0, hl: [cx - rx * 0.35, cy - ry * 0.4, rx * 0.3, ry * 0.22], hlA: 1 }),
    fur: (d, w = 0.9) => line(d, ink, w, 'opacity="0.5"'),
  };
};
/** Aviator goggles: brass frames, sky-blue lenses with glints. */
const goggles = (k, lenses, frame = '#c9893a', lens = '#7fd4ff') =>
  lenses.map(([x, y, r]) => k.S(C(x, y, r), frame, { hl: [x - r * 0.4, y - r * 0.5, r * 0.3, r * 0.2] }) +
    k.S(C(x + 0.2, y + 0.2, r * 0.64), lens, { sw: 1, rim: 0, hl: [x - r * 0.15, y - r * 0.2, r * 0.28, r * 0.18], hlA: 1 })).join('');

designs.fox = (c) => { // cocky ace pilot: goggles on the crown, tall ears, white-tipped brush tail, dark socks
  const k = kit(c);
  const { T, S, W, blush, nose, ink, fur } = k;
  const sock = mix(c.dark, '#3a160c', 0.35);
  return {
    tail: T(P('M -7 -9 C -22 -6 -34 -17 -32 -33 C -31 -43 -24 -50 -17 -48 C -21 -42 -22 -31 -14 -22 C -12 -19 -9 -17 -6 -16 Z'), c.body, {
      inner: flat(P('M -33 -35 C -32.6 -44 -25 -50.5 -16.5 -48.2 C -20 -45 -21.6 -41 -21.8 -36.6 C -25.6 -34.6 -29.6 -34.4 -33 -35 Z'), c.belly),
      front: fur('M -27 -29 l 3 -1.6 M -29.5 -23 l 3 -0.6 M -20.5 -17 l 2.4 -1.6'), hl: [-26, -38, 3, 5],
    }),
    body: T(P('M -8 -2 C -10 -12 -9 -22 0 -24 C 9 -22 10 -12 8 -2 C 4 0.5 -4 0.5 -8 -2 Z'), c.body, {
      inner: flat(E(2.8, -10, 5.2, 8.4), c.belly), front: fur('M 1 -14 l 1.4 1.8 l 1.4 -1.8 M 0.6 -9 l 1.2 1.4 l 1.2 -1.4'), ao: [[1, -24, 10, 4]],
    }) + S(E(-11, -8.5, 2.8, 2.6), sock),
    head: T(P('M -7 -46 L -12 -67 L 1 -50 Z'), c.body, { sw: 1.7, rim: 0.6, inner: flat(P('M -6 -48 L -9.5 -62 L -1 -50.5 Z'), c.dark) + flat(P('M -10.4 -61 L -12 -67 L -8 -62 Z'), '#2a1410') }) +
      T(P('M 5 -51 L 14 -69 L 18 -46 Z'), c.body, { sw: 1.7, rim: 0.6, inner: flat(P('M 7.5 -50 L 13.6 -63.5 L 16 -48 Z'), c.dark) + flat(P('M 12.6 -64 L 14 -69 L 15.2 -63 Z'), '#2a1410') }) +
      T(P('M -12 -36 C -13 -46 -5 -52 4 -52 C 12 -52 17 -47 19 -41 C 22 -38 25 -36 25 -34 C 24 -31 19 -29 14 -28 L 12 -25 L 9 -27.5 L 5 -24.5 L 2 -27.5 C -4 -27 -9 -28 -11 -30 L -15.5 -29 L -12.5 -32 L -16.5 -34 Z'), c.body, {
        hl: [-4, -46, 4, 2],
        inner: flat(P('M 25 -34 C 24 -31 19 -29 14 -28 L 12 -25 L 9 -27.5 L 5 -24.5 L 2 -27.5 C -1 -27.5 -3 -28 -4 -29 C 0 -32 6 -31.5 11 -33.5 C 15 -35.5 20 -35 25 -34 Z'), c.belly),
      }) +
      nose(24, -35, 2.4, 1.9) + line('M 12 -30.5 Q 15.5 -28.6 19 -31.8', ink, 1.3) + blush(-4, -33) +
      k.tube('M -10.4 -44.5 C -7 -50.8 -1 -54.2 3 -54.4 C 8.6 -54.6 13.6 -51.6 17 -45.6', '#6b3a22', 1.7) +
      goggles(k, [[-2.4, -54.6, 3.5], [6.6, -55.2, 3.7]]),
    team: W(P('M -9 -24.8 C -3 -21.2 6 -21.2 10.2 -24.8 L 10.8 -20.6 C 6 -17.4 -3 -17.4 -9.4 -20.6 Z'), { sw: 1.4 }) +
      W(P('M -0.6 -20.4 C 2.6 -19.4 6.6 -19.6 9.8 -21 C 8.8 -16.8 6.8 -14.2 4.2 -12.2 C 1.8 -14.4 0.3 -17.4 -0.6 -20.4 Z'), { sw: 1.3, rim: 0.4 }) +
      W(P('M -8 -23 C -12.6 -24.8 -16.6 -22 -18.8 -17.4 C -15.8 -18.8 -13.2 -19.2 -10.6 -19.4 C -12.6 -16.8 -13.6 -14.4 -13.4 -11.4 C -11 -14.6 -9 -17.6 -7.6 -20.6 Z'), { sw: 1.3, rim: 0.4 }) +
      W(C(-8.3, -21.8, 2.1), { sw: 1.1, rim: 0.3 }) +
      [[2.6, -17.6], [6, -18.2], [4.4, -15], [-4, -21.4], [-14, -18.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.7" fill="#cfc6e0"/>`).join(''),
    teamLayer: 'body',
    hand: sock,
    rig: { eyes: [{ x: -1.5, y: -40, r: 5, far: true }, { x: 8.5, y: -40.5, r: 5.6, far: false }], mouth: { x: 15.5, y: -29.5 }, feet: [[4.5, -2], [-4, -2]], arm: { x: 1, y: -16 }, top: -70 },
    foot: T(P('M -5.5 1 C -6 -3.4 -2.5 -5 1 -4.4 C 4.5 -4.4 7.2 -2.6 7.2 1 Z'), sock, { sw: 1.5, rim: 0.5, front: line('M 3 -1.6 l 0 2.2 M 5.2 -1 l 0 1.8', ink, 0.7) }),
  };
};

designs.bear = (c) => { // gentle heavy-lifter in work overalls: big round head, wide muzzle, plaster, boots
  const { T, S, W, tube, blush, nose, ink, fur } = kit(c);
  return {
    tail: S(C(-16, -11, 3.4), c.body),
    body: T(P('M -14 -24 C -20 -21 -21 -12 -18 -8 C -16 -6 -13 -7 -13 -10 C -13 -14 -11 -19 -10 -22 Z'), c.body, { sw: 1.7, rim: 0.6 }) +
      T(P('M -16 -2 C -19 -14 -14 -28 1 -29 C 15 -28 19 -14 16 -2 C 9 1 -8 1 -16 -2 Z'), c.body, { ao: [[2, -29, 13, 4.5]], inner: flat(E(5, -16, 7, 6), c.belly) }),
    head: S(P('M 0.5 -54 C 0.8 -58 3 -59.4 4.2 -57.4 C 5 -59.6 7.6 -59 7 -54.6 Z'), c.body) +
      T(C(-7, -51.5, 5), c.body, { sw: 1.7, rim: 0.6, inner: flat(C(-6.6, -51, 2.6), c.belly) }) + T(C(13.5, -52, 5), c.body, { sw: 1.7, rim: 0.6, inner: flat(C(13.9, -51.5, 2.6), c.belly) }) +
      T(P('M -11 -40 C -12 -50 -4 -55 3 -55 C 11 -55 17 -50 17 -41 C 17 -33 11 -28 3 -28 C -5 -28 -11 -32 -11 -40 Z'), c.body, { hl: [-4, -49, 3.8, 2], front: fur('M -10 -36 l -1.6 0.6 M -9.6 -33 l -1.4 1') }) +
      T(E(13, -33.8, 8, 5.6), c.belly, { sw: 1.5, rim: 0.6 }) +
      nose(17.6, -37, 3, 2.2) + line('M 17.6 -35 L 17.2 -32.5 Q 14.5 -30 12 -31.5 M 17.2 -32.5 Q 19 -30.5 20.4 -32', ink, 1.2) +
      S(R(-6.5, -50, 8, 3.4, 1), '#f3e2c4', { sw: 1.1, rim: 0.3 }) + line('M -3.4 -49.6 L -1.4 -46.6 M -1.4 -49.6 L -3.4 -46.6', '#c8a070', 0.6) + blush(1, -32.5),
    team: W(P('M -16.5 -12 C -10 -10 10 -10 16.5 -12 C 17.5 -8 17 -4 16 -2 C 9 1 -8 1 -16 -2 C -17 -5 -17.5 -9 -16.5 -12 Z'), { hl: [-10, -7, 2, 1.4] }) +
      W(P('M -6 -22.5 L 10.5 -22.5 L 11.5 -10.5 L -7 -10.5 Z'), { sw: 1.5, rim: 0.5 }) +
      tube('M -5.5 -22 L -9 -28', '#ffffff', 2.4) + tube('M 10 -22 L 11.5 -28.3', '#ffffff', 2.4) +
      line('M -1 -19 L 6 -19 L 6 -14 L -1 -14 Z', ink, 0.9) +
      S(C(-4.5, -20.4, 1.5), '#ffd23f', { sw: 1, rim: 0 }) + S(C(9, -20.4, 1.5), '#ffd23f', { sw: 1, rim: 0 }),
    teamLayer: 'body',
    hand: c.body,
    rig: { eyes: [{ x: 0.5, y: -42.5, r: 4.3, far: true }, { x: 8.5, y: -43, r: 4.8, far: false }], mouth: { x: 15, y: -31 }, feet: [[7, -2], [-7, -2]], arm: { x: 6, y: -15 }, top: -62 },
    foot: T(P('M -6.5 1.5 C -7 -4 -3 -5.2 1 -5.2 C 5 -5.2 8.5 -3.4 8.5 1.5 Z'), '#6a4a3a', { sw: 1.5, rim: 0.5, inner: flat(R(-7, -0.4, 16, 2.2, 0.6), c.accent) }),
  };
};

designs.bunny = (c) => { // pocket commando: knotted headband with flying tails, one flopped ear, buck teeth, freckles
  const { T, S, W, blush, nose, ink, fur } = kit(c);
  return {
    tail: T(C(-10, -8.5, 4.8), '#ffffff', { sw: 1.5, rim: 0.6, front: fur('M -12 -10 l -1.4 -0.6 M -11.6 -7 l -1.6 0.2') }),
    body: T(E(0, -11, 9, 10.5), c.body, { inner: flat(E(2.4, -9, 5.6, 7), c.belly), ao: [[2, -21.5, 9, 3.4]] }) + S(E(-6.5, -13, 2.4, 4.2, 25), c.body),
    head: T(P('M -6.5 -46 C -11 -58 -10 -72 -4.5 -75.5 C 1 -73.5 2 -60 0 -47 Z'), c.body, { sw: 1.7, rim: 0.6, inner: flat(P('M -4.5 -49 C -7.5 -58 -7 -68 -4.2 -71 C -1.6 -68 -1.4 -58 -2.4 -49 Z'), c.inner) }) +
      T(P('M 4 -47 C 5 -58 9 -66 13.5 -66 C 18.5 -66 22.5 -62 21.5 -56.5 C 19 -59 15.5 -59.5 12.4 -58 C 11 -54 10.4 -50 10.4 -46 Z'), c.body, { sw: 1.7, rim: 0.6, inner: flat(P('M 6.6 -48 C 7.4 -57 10 -62.5 13.4 -63 C 16.4 -63 18.6 -61.4 19.2 -59.4 C 16.4 -60.6 13.4 -60.4 11 -59 C 9.4 -55 8.8 -51 8.8 -48 Z'), c.inner) }) +
      T(P('M -12 -34 C -13 -45 -5 -50 3 -50 C 11 -50 17 -45 17 -36 C 17 -28 11 -24 3 -24 C -5 -24 -11 -27 -12 -34 Z'), c.body, { hl: [-4, -44, 3.6, 2] }) +
      S(E(11, -29.4, 5.4, 3.8), '#ffffff', { sw: 1.3 }) +
      S(R(9.6, -27.4, 1.8, 2.8, 0.5), '#ffffff', { sw: 0.8, rim: 0 }) + S(R(11.5, -27.4, 1.8, 2.8, 0.5), '#ffffff', { sw: 0.8, rim: 0 }) +
      nose(12.6, -32, 1.9, 1.4, '#ff6f9a') + line('M 12.6 -30.6 L 12.6 -29.2', ink, 0.9) +
      blush(-4, -31) + [[-6, -31.5], [-3.6, -32.8], [-3.2, -30.2]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.55" fill="${dark(c.body, 0.45)}"/>`).join(''),
    team: W(P('M -12 -42 C -16.4 -43.4 -20.6 -40.6 -23.6 -36 C -19.8 -37.2 -17 -37.6 -14.4 -38.6 Z'), { sw: 1.3, rim: 0.4 }) +
      W(P('M -12.2 -40 C -15.8 -38 -18.2 -34 -19.2 -29.4 C -16.2 -32 -14 -34 -11.4 -37 Z'), { sw: 1.3, rim: 0.4 }) +
      W(P('M -12.8 -38.4 C -12.6 -46.6 -5 -51 3 -51 C 11 -51 16.8 -46.4 17.6 -39.4 L 16.2 -41.6 C 14.4 -45 10 -47.2 3 -47.2 C -4 -47.2 -10.4 -44.2 -12 -40.2 Z'), { sw: 1.4, hl: [-4, -48.6, 3, 0.8] }) +
      W(C(-12.6, -40.4, 2.3), { sw: 1.1, rim: 0.3 }),
    teamLayer: 'head',
    hand: c.body,
    rig: { eyes: [{ x: -0.5, y: -39, r: 5.3, far: true }, { x: 8.5, y: -39.5, r: 5.9, far: false }], mouth: { x: 11.5, y: -27.4 }, feet: [[6, -2.6], [-4, -2.6]], arm: { x: 2, y: -13 }, top: -78 },
    foot: T(E(1.5, 0, 7.6, 3.4), '#ffffff', { sw: 1.5, rim: 0.6, inner: flat(E(5.5, 0.6, 2.4, 1.4), c.inner) }),
  };
};

designs.frog = (c) => { // laid-back frog in a rain slicker: wide head, eye domes, huge grin, yellow wellies
  const { T, S, W, blush, ink } = kit(c);
  return {
    body: T(P('M -15 -2 C -18 -13 -12 -22 1 -22 C 14 -22 19 -13 16 -2 C 9 1 -8 1 -15 -2 Z'), c.body, { inner: flat(E(3, -8, 10, 7), c.belly) }),
    head: T(C(-4, -40.5, 7), c.body, { sw: 1.9, rim: 0.7 }) + T(C(9, -41, 7.6), c.body, { sw: 1.9, rim: 0.7 }) +
      T(P('M -15 -30 C -16 -37 -10 -40 -4 -40 L 10 -40 C 16 -40 21 -36 20.5 -30 C 20 -24 12 -21 2 -21 C -8 -21 -14 -24 -15 -30 Z'), c.body, {
        hl: [-9, -35, 3.2, 1.6],
        inner: flat(P('M -12 -27 C -6 -22.5 12 -22.5 19 -28 C 18 -23 11 -21 2 -21 C -7 -21 -11 -23 -12 -27 Z'), c.belly) +
          flat(C(-11, -33, 1.2), dark(c.body, 0.2)) + flat(C(-8.6, -35.4, 0.9), dark(c.body, 0.2)) + flat(C(15, -37.4, 1), dark(c.body, 0.2)),
      }) +
      line('M -6 -28.5 Q 5 -21.5 17 -29.5', ink, 1.6) + line('M -7.2 -29.6 L -5 -27.6 M 18.2 -30.6 L 16 -28.6', ink, 1.2) +
      `<circle cx="16" cy="-35" r="0.8" fill="${ink}"/><circle cx="18.6" cy="-34.6" r="0.8" fill="${ink}"/>` + blush(-9, -29.5, 2.6, 1.5) + blush(17.5, -31.5, 2, 1.2),
    team: W(P('M -12 -18.5 C -15 -25 -6 -27.5 2 -27.5 C 10 -27.5 18 -25 15 -18.5 Z'), { sw: 1.5 }) +
      W(P('M -16 -4.5 C -18 -12 -14 -20.5 1 -21.5 C 15 -20.5 19 -12 17 -4.5 L 18 -1 C 9 1.5 -8 1.5 -17 -1 Z'), { hl: [-10, -15, 1.6, 3] }) +
      W(P('M -14 -16 C -19 -12 -19.5 -6 -17 -3.5 L -13.5 -5 C -14.5 -8 -14 -11.5 -12 -14 Z'), { sw: 1.5, rim: 0.4 }) +
      W(P('M -3 -21 L 1 -13 L 5 -21.2 Z'), { sw: 1.2, rim: 0.3 }) + W(P('M 1 -21.4 L 5 -13 L 9 -20.8 Z'), { sw: 1.2, rim: 0.3 }) +
      line('M 1 -12 L 1 -2', ink, 0.9) + S(R(1.8, -10.4, 3.6, 1.4, 0.6), '#f0ece0', { sw: 0.8, rim: 0 }) + S(R(1.8, -6, 3.6, 1.4, 0.6), '#f0ece0', { sw: 0.8, rim: 0 }),
    teamLayer: 'body',
    hand: c.body,
    rig: { eyes: [{ x: -4, y: -41, r: 5.1, far: true }, { x: 9, y: -41.5, r: 5.7, far: false }], mouth: { x: 6, y: -24.6 }, feet: [[9, -2], [-8, -2]], arm: { x: 8, y: -12 }, top: -52 },
    foot: T(P('M -5 1.5 L -5 -6.5 C -5 -8 -2 -8 -2 -6.5 L -2 -3 C 2 -3.4 7.5 -2.4 7.5 1.5 Z'), c.accent, { sw: 1.5, rim: 0.5, hl: [-4, -5.6, 0.6, 1.2] }),
  };
};

designs.panda = (c) => { // sleepy brawler: big round head, teardrop patches, pompom beanie, round tummy
  const { T, S, W, blush, nose, ink } = kit(c);
  return {
    tail: S(C(-12, -9, 3), c.dark),
    body: T(P('M -13 -2 C -16 -13 -11 -25 1 -25 C 13 -25 17 -13 14 -2 C 8 1 -6 1 -13 -2 Z'), c.body, {
      inner: flat(P('M -16 -27 L 18 -27 L 18 -19 C 6 -16.5 -5 -16.5 -16 -19 Z'), c.dark) + flat(E(3.5, -9, 6.5, 6), '#f3f0fa'), ao: [[2, -25.5, 12, 3.6]],
    }) + S(E(-12, -14, 3.4, 6, 18), c.dark, { sw: 1.5 }),
    head: T(C(-11.5, -47, 5.2), c.dark, { sw: 1.7, rim: 0.6 }) + T(C(15.5, -47.5, 5.2), c.dark, { sw: 1.7, rim: 0.6 }) +
      T(E(2.5, -38, 14.5, 12.5), c.body, {
        hl: [-5, -45, 3.4, 1.8],
        inner: flat(E(-1, -37.4, 5.6, 7.2, 28), c.dark) + flat(E(9, -37.8, 6, 7.6, -24), c.dark),
      }) +
      nose(12.4, -30.6, 2, 1.4, c.dark) + line('M 12.4 -29.4 L 12.2 -28 Q 10.4 -26.4 8.8 -27.6 M 12.2 -28 Q 13.6 -26.6 15 -27.8', ink, 1.1) +
      blush(-6, -30) + blush(16, -31.5, 2, 1.3),
    team: W(P('M -11 -46.5 C -11 -55 -4 -59 3 -59 C 10 -59 16 -55 16 -46.5 Z'), { hl: [-4, -54, 2.6, 1.4], inner: line('M -2 -58 C -3 -54 -3 -50 -2 -46 M 7 -58 C 8 -54 8 -50 7 -46', '#d4cdea', 1) }) +
      W(R(-12.5, -48.5, 30, 5.2, 2.4), { sw: 1.5, rim: 0.4, inner: [-9, -5, -1, 3, 7, 11, 15].map((x) => `<path d="M ${x} -47.6 l 0 3.4" stroke="#cbc4e4" stroke-width="1.1"/>`).join('') }) +
      W(C(3, -61, 4), { sw: 1.5, rim: 0.5, inner: line('M 1 -63 l 1 1 M 4 -62.6 l 1.2 0.6 M 2 -60 l 1.2 0.4', '#cbc4e4', 0.9) }),
    teamLayer: 'head',
    hand: c.dark,
    rig: { eyes: [{ x: -0.5, y: -37.8, r: 4.2, far: true }, { x: 8.5, y: -38.2, r: 4.6, far: false }], mouth: { x: 12, y: -27 }, feet: [[5.5, -2], [-5, -2]], arm: { x: 1, y: -14 }, top: -66 },
    foot: T(E(0.5, 0, 5.6, 3.3), c.dark, { sw: 1.5, rim: 0.5, inner: flat(E(3.4, 0.4, 1.6, 1.1), '#5a5470') }),
  };
};

designs.cat = (c) => { // cool rebel: studded leather jacket, gold earring, big ears, S-curve tail, team scarf
  const { T, S, W, tube, blush, nose, ink } = kit(c);
  const tailD = 'M -6 -8 C -16 -6 -22 -14 -20 -24 C -18 -32 -22 -39 -28 -41';
  const jacket = '#3b3653';
  return {
    tail: tube(tailD, c.body, 4.6) + line('M -21.6 -35.4 C -22.8 -38.4 -25 -40.2 -28 -41', c.dark, 4.6) + line('M -19.6 -21 l 2.4 0.8 M -19.6 -27 l 2.4 -0.4', c.dark, 1.6),
    body: T(E(0, -12, 8, 11), c.body, { inner: flat(E(2.4, -9.6, 4.6, 7.2), c.belly) }) +
      T(P('M -8.6 -4 C -9.8 -12 -8.8 -20 -3 -22.8 L 1.4 -23 L 2.6 -12 L 1.6 -2 C -2 -1.4 -6 -1.8 -8.6 -4 Z'), jacket, { hl: [-5, -16, 1.4, 3.2], hlA: 0.6, ao: [[0, -23, 7, 3]] }) +
      T(P('M 5.8 -21.8 C 9.2 -19 9.8 -11 8.6 -3.8 C 7.6 -3 6.2 -2.6 4.8 -2.4 L 4.4 -12 Z'), jacket, { sw: 1.5, rim: 0.5 }) +
      line('M 2.2 -20 L 3 -3', '#c9c6d6', 0.8, 'stroke-dasharray="0.8 1"') + [[-5.6, -18], [-6.8, -12], [-6.6, -6.4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.75" fill="#e8e4f2"/>`).join('') +
      T(E(-6.5, -13.5, 2.4, 4.4, 20), jacket, { sw: 1.4, rim: 0.4 }),
    head: T(P('M -10 -40 L -13 -61 L 0 -47 Z'), c.body, { sw: 1.7, rim: 0.6, inner: flat(P('M -9 -42 L -11 -56 L -2.4 -46.6 Z'), c.inner) }) +
      T(P('M 6 -47 L 15 -62 L 18.5 -41 Z'), c.body, { sw: 1.7, rim: 0.6, inner: flat(P('M 8.4 -46 L 14.4 -56.6 L 16.8 -43 Z'), c.inner) }) +
      T(P('M -12 -34 C -13 -44 -6 -49 3 -49 C 12 -49 18 -45 19 -37 C 20 -33 19 -30 21.5 -28 L 16 -27.5 C 12 -24 6 -23 2 -23 C -3 -23 -7 -24 -10 -26 L -15.5 -27 L -12.5 -29.5 L -16.5 -31.5 Z'), c.body, {
        hl: [-5, -44, 3.4, 1.8],
        inner: flat(P('M -1 -49 L 0.6 -44 L 2.2 -49 Z M 4 -49 L 5.4 -44.6 L 7 -49 Z M 8.6 -48.4 L 9.4 -44.6 L 11.4 -48 Z'), c.dark) +
          flat(E(11.5, -28.6, 6, 4), c.belly),
      }) +
      nose(14.6, -31.4, 1.7, 1.2, '#ff6f9a') + line('M 14.6 -30.2 L 14.6 -29 Q 13.2 -27.4 11.6 -28.6 M 14.6 -29 Q 16 -27.4 17.6 -28.6', ink, 1) +
      line('M 17.5 -30.6 l 7 -1.6 M 17.8 -29 l 7 0.4 M 17.2 -27.6 l 6 1.8', ink, 0.7) + blush(-4, -30) +
      `<circle cx="17.6" cy="-42.2" r="1.7" fill="none" stroke="${ink}" stroke-width="1.5"/><circle cx="17.6" cy="-42.2" r="1.7" fill="none" stroke="#ffd23f" stroke-width="0.8"/>`,
    team: W(P('M -8 -24 C -2 -21.5 6 -21.5 11 -24 L 10.5 -20.5 C 7.5 -18.5 5 -15 3 -12.5 C 0.6 -15.6 -3 -18.4 -8 -20.5 Z'), { sw: 1.5, inner: [[-3, -20], [3, -18], [6, -21]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.8" fill="#cbc4e4"/>`).join('') }) +
      W(C(-7.5, -22.4, 2), { sw: 1.2, rim: 0.3 }) + W(P('M -8 -21 L -12 -16 L -9 -16.4 L -7 -19.6 Z'), { sw: 1.1, rim: 0.3 }),
    teamLayer: 'body',
    hand: c.body,
    rig: { eyes: [{ x: -0.5, y: -37, r: 5.3, far: true }, { x: 9, y: -37.5, r: 5.9, far: false }], mouth: { x: 14.6, y: -27.4 }, feet: [[4, -2], [-4, -2]], arm: { x: 1, y: -13 }, top: -64 },
    foot: T(E(0.5, 0, 4.6, 2.9), '#2c2840', { sw: 1.5, rim: 0.5, inner: flat(R(-4.2, 0.8, 9.4, 1.6, 0.4), '#e8e4f2') }),
  };
};

designs.penguin = (c) => { // flying ace: leather aviator cap with goggles, knitted team scarf, egg body, big beak
  const k = kit(c);
  const { T, S, W, blush, ink } = k;
  const leather = '#9a6236';
  return {
    body: S(P('M -12 -30 C -18 -24 -20 -14 -17 -9 C -14 -14 -12 -20 -10 -24 Z'), c.dark, { sw: 1.5 }) +
      T(P('M -12 -2 C -15 -14 -14 -32 -8 -42 C -5 -48 0 -50.5 3 -50.5 C 8 -50.5 13 -46 15 -38 C 17 -28 16 -12 13 -2 C 7 1 -6 1 -12 -2 Z'), c.body, {
        hl: [-6, -40, 2.2, 3.6], hlA: 0.4, inner: flat(E(3.5, -13, 9, 12.5), c.belly), lightA: 0.3,
      }),
    head: T(P('M 0 -44.5 C 2.6 -47 7 -46.4 8.6 -43.6 C 10.6 -46.4 15.4 -46 16.4 -41.6 C 17.4 -36.6 14.4 -30.4 9.6 -28.4 C 4.4 -30.2 -1 -34.4 -1.2 -39.6 C -1.2 -41.6 -0.8 -43.4 0 -44.5 Z'), c.belly, { sw: 1.3, rim: 0.6 }) +
      T(P('M 11 -35.6 C 15 -37 20.5 -35 23 -32.6 C 20 -30.6 15.6 -29.8 11 -31.2 Z'), c.feet, { sw: 1.4, rim: 0.4, hl: [14, -34.6, 1.6, 0.6] }) + line('M 12 -32.6 L 21 -32.6', dark(c.feet, 0.35), 0.8) +
      blush(1.5, -32, 2.4, 1.4) + blush(15.5, -29.6, 1.6, 1) +
      T(P('M -10.4 -46.4 C -12.6 -42.4 -12.4 -38 -10.8 -35.2 L -7.8 -36.6 C -8.4 -39.6 -8.2 -42.8 -7.2 -45.8 Z'), leather, { sw: 1.4, rim: 0.4 }) +
      T(P('M -10 -45.6 C -10.6 -53.6 -4.6 -58.6 3 -58.6 C 10.6 -58.6 16 -53.6 16.6 -45.6 C 10 -49.2 -3.6 -49.2 -10 -45.6 Z'), leather, { hl: [-3, -54.6, 3, 1.4], front: line('M 3 -58.4 C 3.6 -54 3.6 -51 3.4 -48.6', dark(leather, 0.35), 0.9) }) +
      k.tube('M -10 -45.8 C -3.6 -49.2 10 -49.2 16.6 -45.8', '#f6ead6', 1.6) +
      goggles(k, [[4.4, -54, 2.9], [10.8, -53.6, 2.7]]),
    team: W(P('M -13.2 -30 C -6 -26.4 8 -26.4 15.6 -30 L 15.9 -25.2 C 8 -21.8 -6 -21.8 -13.6 -25.2 Z'), { sw: 1.4, inner: line('M -10 -28.4 L -10.4 -23.6 M -5 -27.4 L -5.2 -22.6 M 0 -27 L 0 -22.2 M 5 -27 L 5.2 -22.2 M 10 -27.6 L 10.4 -22.8', '#cfc6e0', 0.9) }) +
      W(P('M 9 -25 C 11.6 -21 12.6 -17 12 -13 L 7 -15 C 7.4 -18 7.2 -21.4 6 -24.4 Z'), { sw: 1.3, rim: 0.4, front: line('M 7.2 -14.6 L 7.6 -12.6 M 9.4 -14 L 9.8 -12.2 M 11.4 -13.4 L 11.8 -11.8', '#ffffff', 1) }) +
      W(P('M -12.6 -27.6 C -17 -27 -20 -24 -21.6 -20 C -18.6 -21.4 -16 -22 -13.6 -22.4 Z'), { sw: 1.2, rim: 0.3 }),
    teamLayer: 'body',
    hand: c.dark,
    rig: { eyes: [{ x: 2.6, y: -39.6, r: 4.4, far: true }, { x: 11, y: -40, r: 4.9, far: false }], mouth: { x: 16, y: -30.4 }, feet: [[5, -1.4], [-4, -1.4]], arm: { x: 4, y: -17 }, top: -62 },
    foot: T(P('M -5.5 1 C -6 -2.6 -2 -3 0 -2.2 C 2 -3 6.5 -2.6 6 1 Z'), c.feet, { sw: 1.5, rim: 0.5 }),
  };
};

designs.raccoon = (c) => { // street-smart scrapper: cheek fluff, bandit mask, backwards cap, ringed tail
  const { T, S, W, blush, nose, ink } = kit(c);
  return {
    tail: T(P('M -6 -7 C -17 -5 -29 -12 -30 -23 C -31 -32 -24 -37 -18.5 -33.5 C -21 -27 -18 -17 -8 -13 Z'), c.body, {
      inner: [-11, -16.5, -22, -27].map((x) => `<path d="M ${x} -40 l 3.2 0 l 2.4 34 l -3.2 0 Z" fill="${c.dark}" transform="rotate(-28 ${x} -18)"/>`).join(''),
      hl: [-24, -28, 2, 4],
    }),
    body: T(P('M -10 -2 C -13 -12 -8.5 -24.5 2 -25 C 11 -25 14 -14 11 -2 C 6 0.5 -6 0.5 -10 -2 Z'), c.body, { inner: flat(E(3, -10.5, 6.2, 7.6), c.belly), ao: [[2, -25, 10, 3.6]] }) +
      S(E(-9, -13.5, 2.6, 4.6, 22), c.dark, { sw: 1.5 }),
    head: T(C(-11, -46, 5), c.body, { sw: 1.7, rim: 0.6, inner: flat(C(-10.6, -45.6, 2.6), c.inner) }) + T(C(15.5, -47, 5), c.body, { sw: 1.7, rim: 0.6, inner: flat(C(15.9, -46.6, 2.6), c.inner) }) +
      T(P('M -12 -35 C -13 -45 -5 -50 3 -50 C 11 -50 17 -46 18 -40 C 21 -38 25 -36 25 -33.5 C 23 -30 17 -28 12 -27.5 L 10 -25 L 7 -27 L 3 -24.5 L 1 -27 C -4 -26.5 -9 -28 -11 -30 L -15.5 -29 L -13 -32 L -16.5 -34 Z'), c.body, {
        hl: [-5, -45, 3, 1.6],
        inner: flat(P('M -12 -42 C -4 -45.5 11 -45.5 18 -41 C 19 -35.6 14.6 -32.4 9.6 -34 C 6 -31.6 1 -31.6 -2 -33.6 C -6.6 -32 -11 -34.6 -12 -42 Z'), mix(c.dark, c.body, 0.3)) +
          flat(P('M 25 -33.5 C 23 -30 17 -28 12 -27.5 L 10 -25 L 7 -27 L 3 -24.5 L 1 -27 C 3 -29 7 -30 11 -30.6 C 16 -31.4 21 -32.4 25 -33.5 Z'), c.belly),
      }) +
      nose(24.2, -34.4, 2.2, 1.7) + line('M 13.5 -29.6 Q 16.6 -27.8 19.6 -30.2', ink, 1.2) + S(P('M 15.4 -29 L 16.4 -27 L 17.4 -28.8 Z'), '#ffffff', { sw: 0.7, rim: 0 }),
    team: W(P('M -11 -44 C -11 -52.5 -4 -56 3 -56 C 10 -56 16 -52.5 16.5 -45.5 C 9 -47 -4 -47 -11 -44 Z'), { hl: [-3, -52, 2.6, 1.4], inner: line('M 3 -56 C 3.6 -52 3.6 -49 3.2 -46.4', '#cbc4e4', 1) }) +
      W(P('M -9.5 -46 C -15.5 -46.4 -21.5 -44.4 -23 -42 C -19 -40.6 -13.5 -41.6 -9 -43.4 Z'), { sw: 1.5, rim: 0.4 }) +
      W(C(3, -56.4, 1.4), { sw: 1, rim: 0 }),
    teamLayer: 'head',
    hand: c.dark,
    rig: { eyes: [{ x: 0, y: -39.4, r: 4.8, far: true }, { x: 9, y: -39.8, r: 5.3, far: false }], mouth: { x: 16.6, y: -29 }, feet: [[5.5, -2], [-5, -2]], arm: { x: 3, y: -14 }, top: -60 },
    foot: T(E(0.5, 0, 5.2, 3), c.dark, { sw: 1.5, rim: 0.5 }),
  };
};

for (const c of characters) {
  const d = designs[c.id](c);
  const id = c.id;
  if (d.tail) part(`${id}_tail`, CBOX, d.tail);
  part(`${id}_body`, CBOX, d.body);
  part(`${id}_head`, CBOX, d.head);
  part(`${id}_team`, CBOX, d.team);
  part(`${id}_foot`, [-10, -9, 20, 15], d.foot);
  part(`${id}_hand`, [-6, -6, 12, 12], kit(c).T(C(0, 0, 3.6), d.hand, { sw: 1.5, rim: 0.5, hl: [-1.1, -1.3, 1.1, 0.7] }));
  manifest.species[id] = { ...d.rig, tail: !!d.tail, team: d.teamLayer };
}

// ---------------------------------------------------------------- expression parts (generic)
// Determined cartoon eyes: tall whites with a lid shadow and lash line, a big glossy brown iris
// with two catch-lights, and thick brows that slope down toward the nose.
part('eye_white', [-6, -7, 12, 14],
  `<defs><radialGradient id="ew" cx="0.45" cy="0.62" r="0.62"><stop offset="0.55" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d0e8"/></radialGradient></defs>` +
  `<ellipse cx="0" cy="0" rx="4" ry="5" fill="url(#ew)" stroke="${EYE_INK}" stroke-width="1.1"/>` +
  `<path d="M -3.8 -1.4 Q -3.2 -4.7 0 -4.9 Q 3.2 -4.7 3.8 -1.4 Q 2.8 -3.4 0 -3.6 Q -2.8 -3.4 -3.8 -1.4 Z" fill="#b6aacb" opacity="0.65"/>` +
  `<path d="M -4.1 -0.4 Q -3.7 -5.3 0 -5.3 Q 3.7 -5.3 4.1 -0.4" fill="none" stroke="${EYE_INK}" stroke-width="1.7" stroke-linecap="round"/>`);
part('eye_pupil', [-4, -5, 8, 10],
  `<defs><radialGradient id="ep" cx="0.5" cy="0.78" r="0.8"><stop offset="0" stop-color="#b07a3e"/><stop offset="0.5" stop-color="#4a2614"/><stop offset="1" stop-color="#1a0a06"/></radialGradient></defs>` +
  `<ellipse cx="0" cy="0.3" rx="2.9" ry="3.6" fill="url(#ep)"/><ellipse cx="0" cy="0.5" rx="1.4" ry="1.8" fill="#0e0604"/>` +
  `<ellipse cx="-0.95" cy="-1.4" rx="1.3" ry="1.55" fill="#ffffff"/><circle cx="1.2" cy="1.7" r="0.6" fill="#ffffff" opacity="0.9"/>`);
const lid = (d) => line(d, '#ffffff', 2.9, 'opacity="0.85"') + line(d, EYE_INK, 1.5); // haloed so it reads on dark patches too
part('eye_closed', [-5, -3, 10, 6], lid('M -3.8 -0.8 Q 0 2.8 3.8 -0.8'));
part('eye_hurt', [-5, -4, 10, 8], lid('M -2.8 -2.6 L 2.8 0 L -2.8 2.6'));
part('eye_happy', [-5, -4, 10, 8], lid('M -3.6 1.6 Q 0 -3 3.6 1.6'));
part('brow', [-5, -4.5, 10, 7.5], `<path d="M -3.8 0.5 Q -0.4 -1.9 3.7 -2.7 Q 0.2 -0.6 -3.5 1.9 Z" fill="${EYE_INK}" stroke="${EYE_INK}" stroke-width="0.9" stroke-linejoin="round"/>`);
part('mouth_open', [-5, -5, 10, 10],
  `<path d="M -3.6 -1.4 Q 0 -2.4 3.6 -1.4 Q 3.4 3.4 0 3.6 Q -3.4 3.4 -3.6 -1.4 Z" fill="#5a1426" stroke="${EYE_INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
  `<path d="M -2.6 -1.5 L 2.6 -1.5 L 2.4 -0.4 L -2.4 -0.4 Z" fill="#ffffff"/><path d="M -2 2 Q 0 0.6 2 2 Q 1 3.2 0 3.2 Q -1 3.2 -2 2 Z" fill="#ff7a90"/>`);
part('shadow', [-17, -5, 34, 10],
  `<defs><radialGradient id="sh"><stop offset="0" stop-color="#1e0f1c" stop-opacity="0.5"/><stop offset="0.6" stop-color="#1e0f1c" stop-opacity="0.25"/><stop offset="1" stop-color="#1e0f1c" stop-opacity="0"/></radialGradient></defs><ellipse cx="0" cy="0" rx="16" ry="4.4" fill="url(#sh)"/>`);

// ---------------------------------------------------------------- held weapons (pivot at 0,0, pointing +x)
const METAL = '#9aa3b5';
const GUN = '#4a5266';
const V = (shape, fill, o = {}) => vol(shape, fill, { sw: 1.5, rim: 0.6, ...o });
const skull = (x, y, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="M -2.4 0.6 C -2.6 -2.6 -1.4 -3.4 0 -3.4 C 1.4 -3.4 2.6 -2.6 2.4 0.6 L 1.4 1.2 L 1.4 2.4 L -1.4 2.4 L -1.4 1.2 Z" fill="#f4f0ea"/><circle cx="-0.9" cy="-0.7" r="0.75" fill="#1e1820"/><circle cx="0.9" cy="-0.7" r="0.75" fill="#1e1820"/><path d="M -0.5 1.6 L -0.5 2.4 M 0.5 1.6 L 0.5 2.4" stroke="#1e1820" stroke-width="0.4"/></g>`;
const fuse = (x, y, len) => line(`M ${x} ${y} q ${len * 0.4} ${-len * 0.6} ${len} ${-len * 0.7}`, '#5a4030', 1.2) +
  `<g transform="translate(${f(x + len)} ${f(y - len * 0.7)})">${star(2.6, 0.4, 6)('fill="#ffd23f"')}${star(1.3, 0.45, 6)('fill="#ffffff"')}</g>`;
const held = {
  rocket: V(R(-10.5, -5.6, 6, 11.2, 2.2), GUN) +
    V(R(-6, -4.6, 28, 9.2, 4.2), METAL, { inner: flat(R(2.6, -5, 3, 10, 0), '#e5452f') + flat(R(12, -5, 1.8, 10, 0), '#e5452f'), hl: [6, -2.6, 9, 1.2] }) +
    V(R(5, -8.8, 7, 3.8, 1.2), GUN, { sw: 1.2, rim: 0.3 }) + V(P('M 0 4 L 5 4 L 4.2 10.5 L 0.6 10.5 Z'), GUN, { sw: 1.2, rim: 0.3 }) +
    V(P('M 21 -6.4 L 30 -7.6 L 30 7.6 L 21 6.4 Z'), '#e5452f', { hl: [24, -4.4, 2.4, 0.8] }) + V(E(30, 0, 1.8, 7.2), '#2a1c24', { sw: 1.1, rim: 0 }),
  heavy: V(R(-11.5, -6.8, 6, 13.6, 2.4), GUN) +
    V(R(-6, -6, 27, 12, 5), '#5aa83c', { inner: flat(R(3.5, -6.5, 2.6, 13, 0), '#ffc93c') + flat(R(7.4, -6.5, 1.2, 13, 0), '#2e2a2a'), hl: [5, -3.4, 9, 1.4] }) +
    V(R(2, -11.2, 10, 4.2, 2), '#3d4252', { sw: 1.2, rim: 0.3, front: '' }) + V(C(12.4, -9.1, 1.6), '#7fd4ff', { sw: 0.9, rim: 0 }) +
    V(P('M 1 5 L 6 5 L 5.2 11 L 1.6 11 Z'), GUN, { sw: 1.2, rim: 0.3 }) +
    V(R(20, -7.8, 10, 15.6, 3.2), GUN, { hl: [23, -5, 3, 1] }) + V(E(30, 0, 2, 6.2), '#1e1820', { sw: 1.1, rim: 0 }),
  shotgun: V(P('M -11.5 -1 L -2 -4 L 4 -4 L 4 3 L -2 3 L -11.5 6.4 C -13 4.2 -13 1.2 -11.5 -1 Z'), '#b0703c', { front: line('M -9 1.6 L 1 -1.6 M -8 4 L 0 1.4', '#7a4420', 0.6, 'opacity="0.6"') }) +
    V(R(3, -4.8, 8, 8.6, 2), GUN) + V(R(10, -4.4, 21, 3.8, 1.6), METAL, { hl: [18, -3.4, 7, 0.5] }) + V(R(10, -0.4, 21, 3.8, 1.6), mix(METAL, '#5a6070', 0.3)) +
    V(R(14, 3, 9, 3.6, 1.6), '#7a4a28', { sw: 1.2, rim: 0.3 }),
  drill: V(R(-8, -6, 17, 12, 4), '#ffb02e', { inner: flat(R(-8, -1, 17, 2, 0), '#3a3a48'), hl: [-3, -3.6, 4, 1] }) + V(P('M 0 5 L 6 5 L 5 11 L 0.4 11 Z'), '#3a3a48', { sw: 1.2, rim: 0.3 }) +
    V(R(8.5, -4, 4, 8, 1), '#6a7080', { sw: 1.2, rim: 0.3 }) +
    V(P('M 12 -4.8 L 30 0 L 12 4.8 Z'), '#d8dee8', { hl: [16, -2.4, 3, 0.6], front: line('M 15 -4 L 17 3.6 M 19.4 -2.8 L 21 2.6 M 23.6 -1.6 L 24.8 1.4', '#7a808c', 1) }),
  grenade: V(C(12, 0, 6.8), '#5aa84a', { hl: [9.6, -2.6, 2, 1.2], front: line('M 5.4 0 L 18.6 0 M 12 -6.6 L 12 6.6', dark('#5aa84a', 0.35), 0.9) }) +
    V(R(9.6, -10, 5, 4.2, 1.2), '#b8bccb', { sw: 1.2, rim: 0.3 }) + `<circle cx="16.6" cy="-9" r="2.2" fill="none" stroke="#5a5e70" stroke-width="1"/>`,
  cluster: V(C(12, 1, 7.6), '#2e2f3a', { hl: [9, -2, 2.8, 1.8], hlA: 0.7, front: skull(12, 2.4, 1.15) }) + V(R(9.8, -8.6, 4.4, 3.6, 1), '#6a6e80', { sw: 1.1, rim: 0.3 }) + fuse(12, -8.4, 5),
  mine: V(E(12, 2, 8.6, 4.6), '#4a4f66', { hl: [8, 0.6, 3, 0.8], front: line('M 6 3.6 l 2 0 M 11 4.2 l 2 0 M 16 3.6 l 2 0', '#ffc93c', 1.2) }) + V(C(12, -2.6, 2.3), '#ff4d6d', { sw: 1.1, rim: 0.3, hl: [11.2, -3.4, 0.8, 0.5], hlA: 1 }),
  airstrike: line('M 12.6 -8 L 14.6 -15', '#2a2e3a', 1.4) + `<circle cx="14.6" cy="-15" r="1.2" fill="#ff4d6d"/>` +
    V(R(3.6, -8.4, 11.4, 16, 3), '#5f6b3e', { hl: [6, -6, 2, 1.2], front: line('M 6 -5 L 12.6 -5 M 6 -3.4 L 12.6 -3.4 M 6 -1.8 L 12.6 -1.8', '#3a4224', 0.8) }) +
    V(R(5.4, 0.6, 7.8, 4.2, 1), '#c8f07a', { sw: 1, rim: 0 }) + V(C(9.3, 6, 1.2), '#ff4d6d', { sw: 0.8, rim: 0 }),
  teleport: V(R(-3, -1.9, 22, 3.8, 1.8), '#6a4fc0', { hl: [6, -1, 5, 0.5] }) + `<g transform="translate(23 0)">${V(star(6.6), '#ffd23f', { hl: [-1.4, -2.4, 1.8, 1] })}</g>` +
    `<g transform="translate(29 -7)">${star(1.8, 0.35, 4)('fill="#ffffff"')}</g><g transform="translate(18 -7)">${star(1.2, 0.35, 4)('fill="#ffffff"')}</g>`,
};
for (const [id, body] of Object.entries(held)) part(`held_${id}`, [-14, -17, 48, 32], body);

// ---------------------------------------------------------------- projectiles (centred, pointing +x)
const flame = (x, len, h) => `<path d="M ${x} ${-h} C ${x - len * 0.5} ${-h} ${x - len * 0.85} ${-h * 0.4} ${x - len} 0 C ${x - len * 0.85} ${h * 0.4} ${x - len * 0.5} ${h} ${x} ${h} Z" fill="#ff8a2a"/>` +
  `<path d="M ${x} ${-h * 0.6} C ${x - len * 0.4} ${-h * 0.6} ${x - len * 0.6} ${-h * 0.2} ${x - len * 0.7} 0 C ${x - len * 0.6} ${h * 0.2} ${x - len * 0.4} ${h * 0.6} ${x} ${h * 0.6} Z" fill="#ffe066"/>`;
const proj = {
  rocket: flame(-9, 11, 3) + V(P('M -9 -3.6 L -13.8 -8.8 L -4 -3.6 Z'), '#e5452f', { sw: 1.3, rim: 0.3 }) + V(P('M -9 3.6 L -13.8 8.8 L -4 3.6 Z'), '#e5452f', { sw: 1.3, rim: 0.3 }) +
    V(R(-10, -3.9, 15.5, 7.8, 3.6), '#f6f2ec', { inner: flat(R(-4.4, -4, 2.6, 8, 0), '#e5452f') + flat(R(0.4, -4, 1.4, 8, 0), '#e5452f'), hl: [-2, -2, 5, 0.9] }) +
    V(P('M 5 -3.9 C 9.4 -3.9 12.6 -1.6 13.6 0 C 12.6 1.6 9.4 3.9 5 3.9 Z'), '#e5452f', { hl: [8, -2, 2, 0.6] }),
  heavy: flame(-12, 14, 4.4) + V(P('M -11 -5.2 L -17 -11.2 L -5 -5.2 Z'), '#e5452f', { sw: 1.4, rim: 0.3 }) + V(P('M -11 5.2 L -17 11.2 L -5 5.2 Z'), '#e5452f', { sw: 1.4, rim: 0.3 }) +
    V(R(-12.4, -5.6, 20, 11.2, 4.6), '#4f8a3a', { inner: flat(R(-4, -6, 3, 12, 0), '#ffc93c') + skull(2.4, 0.4, 1.1), hl: [-5, -3, 6, 1] }) +
    V(P('M 7.4 -5.6 C 13 -5.6 16.4 -2.4 17.4 0 C 16.4 2.4 13 5.6 7.4 5.6 Z'), '#e5452f', { hl: [10.6, -2.8, 2.4, 0.8] }),
  grenade: V(C(0, 0, 6.4), '#5aa84a', { hl: [-2.2, -2.4, 2, 1.2], front: line('M -6.2 0 L 6.2 0 M 0 -6.2 L 0 6.2', dark('#5aa84a', 0.35), 0.9) }) + V(R(-1.9, -9.6, 3.8, 3.8, 1), '#b8bccb', { sw: 1.2, rim: 0.3 }),
  cluster: V(C(0, 1, 7), '#2e2f3a', { hl: [-2.6, -2, 2.6, 1.6], hlA: 0.7, front: skull(0, 2.2, 1.05) }) + V(R(-2, -8.2, 4, 3.4, 1), '#6a6e80', { sw: 1.1, rim: 0.3 }) + fuse(0, -8, 4.6),
  bomblet: V(C(0, 0.6, 3.8), '#2e2f3a', { sw: 1.3, rim: 0.4, hl: [-1.2, -0.8, 1.2, 0.7], hlA: 0.7 }) + fuse(0, -3.2, 2.6),
  pellet: `<circle r="4.2" fill="#ffe066" opacity="0.35"/>` + V(C(0, 0, 2.6), '#ffd23f', { sw: 1.2, rim: 0.3, hl: [-0.8, -0.9, 0.9, 0.6], hlA: 1 }),
  airbomb: V(P('M -9.4 -4.2 L -14.6 -8.4 L -14.6 8.4 L -9.4 4.2 Z'), '#6f7a96', { sw: 1.3, rim: 0.3 }) +
    V(E(0, 0, 10, 5.2), '#5a6680', { inner: flat(R(-3, -6, 2.2, 12, 0), '#ffc93c'), hl: [2.6, -2.2, 3, 0.9] }),
  mine: V(E(0, 1.2, 7, 4), '#4a4f66', { hl: [-3, 0, 2.6, 0.8] }) + V(C(0, -2.4, 2), '#ffb03b', { sw: 1, rim: 0 }),
  drill: V(R(-11, -4.4, 10, 8.8, 2.4), '#ffb02e', { hl: [-8, -2.4, 2.4, 0.7] }) + V(P('M -2 -5.2 L 12 0 L -2 5.2 Z'), '#d8dee8', { hl: [2, -2.4, 2, 0.5], front: line('M 1 -3.6 L 3 3.6 M 5 -2.2 L 6.2 2.2', '#7a808c', 1) }),
  teleport: `<circle r="12" fill="#fff4b0" opacity="0.3"/>` + V(star(10), '#ffd23f', { hl: [-2, -3.4, 2.4, 1.4] }),
};
for (const [id, body] of Object.entries(proj)) part(`proj_${id}`, [-22, -14, 44, 28], body);

// ---------------------------------------------------------------- props
part('mine_idle', [-11, -9, 22, 15], V(E(0, 1.2, 7.8, 4.2), '#4a4f66', { hl: [-3, -0.2, 2.6, 0.8] }) + V(R(-1.9, -4.8, 3.8, 3.6, 1), '#8a90a6', { sw: 1.1, rim: 0.3 }) +
  line('M -5.2 2.6 l 2 0 M -1 3 l 2 0 M 3.2 2.6 l 2 0', '#ffc93c', 1.2));
part('mine_light', [-4, -4, 8, 8], `<defs><radialGradient id="ml"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><circle r="3.4" fill="url(#ml)"/>`);
part('barrel', [-13, -16, 26, 31],
  V(R(-10, -12, 20, 24, 4), '#e8452f', {
    sw: 1.8, hl: [-5.6, -4, 1.6, 6],
    inner: flat(R(-10, -7, 20, 2.4, 0), '#9a2418') + flat(R(-10, 4.4, 20, 2.4, 0), '#9a2418') + flat(R(-5, -3.4, 10, 6.6, 1.4), '#ffd23f') +
      `<path d="M 0 -2.4 L 2.6 2.2 L -2.6 2.2 Z" fill="#2a1c24"/><path d="M 0 -1.2 L 0 0.6" stroke="#ffd23f" stroke-width="0.7"/>`,
  }) + V(E(0, -12, 10, 2.6), '#ff6a4a', { sw: 1.5, rim: 0.4 }) + V(C(4, -12.4, 1.4), '#9a2418', { sw: 0.8, rim: 0 }));
part('tombstone', [-13, -31, 26, 32],
  V(P('M -9.5 0 L -9.5 -16 A 9.5 9.5 0 0 1 9.5 -16 L 9.5 0 Z'), '#b9bfcc', { sw: 2, hl: [-4, -19, 2, 4], front: line('M 3 -21 L 5 -16.4 L 3.6 -12', '#7a8094', 0.8) }) +
  line('M 0 -22 L 0 -8 M -4.4 -17.6 L 4.4 -17.6', '#6f7486', 2.4) + line('M 0.5 -21.4 L 0.5 -8.6 M -3.8 -17 L 4.8 -17', '#e8ecf4', 0.6) +
  V(E(0, 0, 11.5, 2.4), '#5cbf45', { sw: 1.4, rim: 0.4 }) + line('M -11 0 q 2 -5 3.5 0 M 6.5 0 q 2 -6 4.5 0', '#3d9a2c', 1.8));
part('crosshair', [-14, -14, 28, 28], `<circle r="8.6" fill="none" stroke="#ffffff" stroke-width="3.4"/><circle r="8.6" fill="none" stroke="${INK}" stroke-width="1.4"/>` +
  line('M -13 0 L -5.4 0 M 5.4 0 L 13 0 M 0 -13 L 0 -5.4 M 0 5.4 L 0 13', '#ffffff', 2.8) + line('M -13 0 L -5.4 0 M 5.4 0 L 13 0 M 0 -13 L 0 -5.4 M 0 5.4 L 0 13', INK, 1) + `<circle r="1.6" fill="#ff4d6d"/>`);
{
  // Cumulus cloud: no outline, lit top, cool blue-grey underside (like the sky it sits in).
  const puffs = [[-42, 8, 20], [-22, -4, 25], [4, -12, 30], [32, -2, 24], [50, 10, 16], [-56, 16, 12], [16, 10, 22], [-12, 12, 20]];
  part('cloud', [-74, -46, 148, 80],
    `<defs><linearGradient id="cl" gradientUnits="userSpaceOnUse" x1="0" y1="-42" x2="0" y2="30"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f4f9ff"/><stop offset="1" stop-color="#b9cdea"/></linearGradient></defs>` +
    puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#cl)"/>`).join('') +
    `<rect x="-62" y="16" width="124" height="14" rx="7" fill="#b9cdea"/>` +
    [[-6, -26, 13], [-28, -16, 9], [26, -12, 8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="0.9"/>`).join(''));
}
part('plane', [-36, -17, 72, 34],
  V(E(0, 0, 26, 7), '#e8eef8', { sw: 1.8, hl: [-6, -3.4, 9, 1.4], inner: flat(R(-26, -1.6, 52, 3.2, 0), '#e5452f') }) +
  V(P('M -6 -2 L 7 -2 L -5 -15 Z'), '#3f72d0', { sw: 1.6 }) + V(P('M -24 -2 L -17 -2 L -28 -13 Z'), '#3f72d0', { sw: 1.5 }) +
  V(E(15, -1.8, 5.6, 2.8), '#7fd4ff', { sw: 1.3, rim: 0.3, hl: [14, -3, 1.6, 0.6], hlA: 1 }) + V(E(26, 0, 1.6, 6.4), '#6a7080', { sw: 1.1, rim: 0 }));

// ---------------------------------------------------------------- FX sprites (light, so engines can tint)
{
  const puffs = [[-6, 2, 8], [4, -2, 9], [-1, -7, 7], [9, 4, 6], [-11, 5, 5]];
  part('fx_puff', [-17, -16, 34, 32],
    `<defs><linearGradient id="pg" gradientUnits="userSpaceOnUse" x1="0" y1="-14" x2="0" y2="12"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#eef1f7"/><stop offset="1" stop-color="#b2b9cb"/></linearGradient></defs>` +
    puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 1}" fill="#9aa2b8"/>`).join('') +
    puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#pg)"/>`).join('') +
    `<circle cx="-3" cy="-9" r="3" fill="#ffffff" opacity="0.9"/><circle cx="2" cy="-5" r="2.2" fill="#ffffff" opacity="0.7"/>`);
}
part('fx_fire', [-13, -15, 26, 28],
  `<defs><radialGradient id="ff" cx="0.5" cy="0.68" r="0.6"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#fff2a0"/><stop offset="1" stop-color="#ffb04a"/></radialGradient></defs>` +
  `<path d="M 0 11 C -9 11 -11 3 -8 -2 C -7 1 -5 2 -3.6 1 C -6 -6 -1 -11 2.4 -13 C 2.4 -8 6.4 -6.6 7.6 -2 C 10 1 10 10 0 11 Z" fill="url(#ff)"/>` +
  `<path d="M 0.4 9 C -4.6 9 -5.6 4 -3.6 1 C -2.4 3 -0.4 2.6 0.4 -1 C 2.4 1 5.4 3 4.6 6 C 4 8 2.4 9 0.4 9 Z" fill="#ffffff" opacity="0.85"/>`);
{
  // A big cartoon blast: jagged orange flame ring, yellow inner burst, white-hot core.
  const spikes = (n, r0, r1, jit, seed) => {
    const r = rand(seed);
    let d = '';
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 0.5) / n) * Math.PI * 2;
      const ro = r1 * (1 - jit * r());
      const ri = r0 * (1 - jit * 0.5 * r());
      const p0 = [Math.cos(a0) * ri, Math.sin(a0) * ri];
      const p1 = [Math.cos(a1) * ro, Math.sin(a1) * ro];
      const c0 = [Math.cos(a0 + 0.12) * ro * 0.9, Math.sin(a0 + 0.12) * ro * 0.9];
      d += `${i ? ' Q' : `M ${f(p0[0])} ${f(p0[1])} Q`} ${f(c0[0])} ${f(c0[1])} ${f(p1[0])} ${f(p1[1])} Q ${f(Math.cos(a1 + 0.2) * ro * 0.78)} ${f(Math.sin(a1 + 0.2) * ro * 0.78)} ${f(Math.cos(((i + 1) / n) * Math.PI * 2) * ri)} ${f(Math.sin(((i + 1) / n) * Math.PI * 2) * ri)}`;
    }
    return d + ' Z';
  };
  part('fx_burst', [-32, -32, 64, 64],
    `<defs><radialGradient id="bo"><stop offset="0.3" stop-color="#ffd23f"/><stop offset="0.7" stop-color="#ff8a1e"/><stop offset="1" stop-color="#e8401c"/></radialGradient>` +
    `<radialGradient id="bi"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#fff6a8"/><stop offset="1" stop-color="#ffd23f"/></radialGradient></defs>` +
    `<path d="${spikes(11, 19, 30, 0.22, 7)}" fill="url(#bo)" stroke="#8a1f12" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="${spikes(9, 11, 19, 0.25, 11)}" fill="url(#bi)"/>` +
    `<circle r="7" fill="#ffffff" opacity="0.9"/>` +
    [[-14, -12, 3], [12, -15, 2.4], [16, 10, 2.6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff6c8" opacity="0.8"/>`).join(''));
}
part('fx_star', [-17, -17, 34, 34], `<defs><radialGradient id="fs"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#fff4c0"/><stop offset="1" stop-color="#fff4c0" stop-opacity="0.2"/></radialGradient></defs>${star(16, 0.4, 6)('fill="url(#fs)"')}`);
part('fx_chunk', [-7, -7, 14, 14], vol(P('M -4.4 -3.2 L 1 -5.4 L 5.4 -1 L 3.2 4.4 L -3.2 4.4 L -5.4 0 Z'), '#efe9e2', { sw: 1.2, rim: 0.5, shade: '#8a7a74', ink: '#5a4a46', bounceA: 0 }));
part('fx_spark', [-8, -3, 16, 6], `<path d="M -7 0 L 0 -1.8 L 7 0 L 0 1.8 Z" fill="#ffffff"/>`);
part('fx_drop', [-4.5, -5.5, 9, 11], `<path d="M 0 -4.4 C 2.2 -1 3.2 1 3.2 2.2 A 3.2 3.2 0 0 1 -3.2 2.2 C -3.2 1 -2.2 -1 0 -4.4 Z" fill="#ffffff"/><circle cx="-1" cy="1.6" r="0.8" fill="#ffffff" opacity="0.6"/>`);

// ---------------------------------------------------------------- HUD weapon icons
for (const w of weapons) {
  const sprite = w.id === 'shotgun' ? held.shotgun : proj[w.sprite === 'airbomb' ? 'airbomb' : w.id] ?? proj.rocket;
  const rot = w.id === 'airstrike' ? 70 : w.id === 'shotgun' ? -20 : -35;
  part(`icon_${w.id}`, [-16, -16, 32, 32], `<g transform="rotate(${rot}) scale(0.88) ${w.id === 'shotgun' ? 'translate(-9 0)' : ''}">${sprite}</g>`);
}

// ---------------------------------------------------------------- logo (glyphs from Lilita One as paths)
function textPath(str, size, x, y, letterRotate = () => 0, track = 0) {
  let cx = x;
  const glyphs = [];
  for (const ch of str) {
    const g = display.charToGlyph(ch);
    const adv = (g.advanceWidth / display.unitsPerEm) * size;
    glyphs.push({ d: g.getPath(0, 0, size).toPathData(2), x: cx, w: adv, rot: letterRotate(glyphs.length) });
    cx += adv + track;
  }
  return { glyphs, width: cx - x - track };
}
{
  const word = 'Wildlings';
  const t = textPath(word, 120, 0, 0, (i) => [-6, 3, -2, 4, -4, 2, -3, 5, -2][i] ?? 0, 2);
  const W = t.width + 60;
  const fills = ['#ff9a2e', '#ffc93c', '#7ddc5a', '#3fd0c0', '#5aa8ff', '#9d7bff', '#ff6fb5', '#ff7a4a', '#ffc93c'];
  let body = `<defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.7"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="ld" x1="0" y1="0" x2="0" y2="1"><stop offset="0.5" stop-color="#3a1446" stop-opacity="0"/><stop offset="1" stop-color="#3a1446" stop-opacity="0.35"/></linearGradient></defs>`;
  t.glyphs.forEach((g, i) => {
    const bob = Math.sin(i * 0.9) * 6;
    const tr = `translate(${f(30 + g.x)} ${f(118 + bob)}) rotate(${g.rot} ${f(g.w / 2)} -40)`;
    body += `<g transform="${tr}">` +
      `<path d="${g.d}" fill="${INK}" stroke="${INK}" stroke-width="22" stroke-linejoin="round" transform="translate(0 9)"/>` +
      `<path d="${g.d}" fill="${fills[i]}" stroke="${INK}" stroke-width="14" stroke-linejoin="round" paint-order="stroke"/>` +
      `<path d="${g.d}" fill="url(#ld)"/><path d="${g.d}" fill="url(#lg)"/>` +
      `</g>`;
  });
  const tag = textPath('CRITTER ARTILLERY', 26, 0, 0, () => 0, 3);
  const rw = tag.width + 70;
  const rx = (W - rw) / 2;
  body += `<g transform="translate(${f(rx)} 150)">` +
    `<path d="M -22 8 L 10 2 L 10 40 L -22 46 L -10 27 Z" fill="${dark('#ff5a6e', 0.35)}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    `<path d="M ${f(rw + 22)} 8 L ${f(rw - 10)} 2 L ${f(rw - 10)} 40 L ${f(rw + 22)} 46 L ${f(rw + 10)} 27 Z" fill="${dark('#ff5a6e', 0.35)}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    vol(R(0, 0, rw, 38, 8), '#ff5a6e', { sw: 5, ink: INK, rim: 2 }) +
    tag.glyphs.map((g) => `<path d="${g.d}" transform="translate(${f(35 + g.x)} 29)" fill="#fffaf0"/>`).join('') + '</g>';
  part('logo', [0, 0, Math.ceil(W), 200], body, 1);
}

// ---------------------------------------------------------------- UI kit (nine-slice: 24px corners)
// Sky-navy panels with a soft top light, candy buttons with a depth band and gloss.
const ui = (name, fill, o = {}) => {
  const w = 96;
  const h = o.h ?? 64;
  const depth = o.depth ?? 6;
  const r = o.r ?? 18;
  let s = `<defs><linearGradient id="u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(fill, o.top ?? 0.24)}"/><stop offset="1" stop-color="${o.bottom ?? fill}"/></linearGradient></defs>`;
  if (depth) s += `<rect x="3" y="${3 + depth}" width="${w - 6}" height="${h - 6 - depth}" rx="${r}" fill="${o.depthColor ?? dark(fill, 0.45)}" stroke="${INK}" stroke-width="4"/>`;
  s += `<rect x="3" y="3" width="${w - 6}" height="${h - 6 - depth}" rx="${r}" fill="url(#u)" stroke="${INK}" stroke-width="4"/>`;
  if (o.gloss !== false) s += `<rect x="12" y="8" width="${w - 24}" height="${Math.max(4, (h - depth) * 0.22)}" rx="${Math.max(2, (h - depth) * 0.11)}" fill="#ffffff" opacity="${o.glossA ?? 0.38}"/>`;
  if (o.inset) s += `<rect x="9" y="9" width="${w - 18}" height="${h - 18 - depth}" rx="${r - 6}" fill="none" stroke="${o.inset}" stroke-width="2" opacity="0.55"/>`;
  part(`ui_${name}`, [0, 0, w, h], s, 2);
  manifest.ui[name] = { slice: 24, depth };
};
ui('btn_primary', '#ff8a2a');
ui('btn_secondary', '#3f9cff');
ui('btn_neutral', '#fff3d6', { depthColor: '#c8a878' });
ui('btn_danger', '#ff5a6e');
ui('btn_disabled', '#b4bccc', { gloss: false });
ui('panel', '#1f4482', { depth: 8, r: 26, h: 96, gloss: false, top: 0.14, bottom: '#173468', inset: '#8fd0ff', depthColor: '#0d1f45' });
ui('card', '#2a5aa0', { depth: 5, r: 18, gloss: false, top: 0.12, inset: '#a6dcff', depthColor: '#123068' });
ui('card_light', '#fff6e2', { depth: 5, r: 18, gloss: false, top: 0, depthColor: '#cdb48c' });
ui('slot', '#fff6e2', { depth: 5, r: 14, depthColor: '#cdb48c' });
ui('slot_active', '#ffc93c', { depth: 5, r: 14, depthColor: '#c78a12' });
ui('field', '#132b58', { depth: 0, r: 14, gloss: false, top: 0 });

// ---------------------------------------------------------------- worlds
buildDecor(maps, part);
buildBackgrounds(maps, part, manifest);

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`gen-art: ${Object.keys(manifest.parts).length} parts -> ${out}`);
