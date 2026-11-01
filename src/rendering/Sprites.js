import { SPECIES } from '../game/config.js';
import { SPRITE_OVERRIDES } from '../assets/sprites.js';
import { starPath } from './Effects.js';

/**
 * Procedural cartoon art. Every draw function works in a local frame so real
 * image sprites can replace any of them (see assets/sprites.js).
 */

const TAU = Math.PI * 2;
const images = {};
for (const [key, url] of Object.entries(SPRITE_OVERRIDES)) {
  const img = new Image();
  img.src = url;
  images[key] = img;
}
const ready = (img) => img && img.complete && img.naturalWidth > 0;

export const speciesById = (id) => SPECIES.find((s) => s.id === id) || SPECIES[0];

function ell(ctx, x, y, rx, ry, fill, stroke, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function tri(ctx, x1, y1, x2, y2, x3, y3, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function rect(ctx, x, y, w, h, fill, stroke = '#2a2a2a') {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.3);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ characters

/**
 * Draws a critter with its feet at (0, 0).
 * o: { facing, aim, crouch, air, walk, walking, t, blink, hurt, color, weapon }
 */
export function drawAnimal(ctx, sp, o = {}) {
  const t = o.t || 0;
  const f = o.facing || 1;
  ctx.save();
  let sx = 1;
  let sy = 1;
  if (o.crouch) {
    sx = 1.14;
    sy = 0.78;
  } else if (o.air) {
    sx = 0.92;
    sy = 1.08;
  } else {
    const b = Math.sin(t * 3.2) * 0.03;
    sx = 1 - b * 0.5;
    sy = 1 + b;
  }
  if (o.walking) ctx.translate(0, -Math.abs(Math.sin(o.walk * 0.3)) * 2.5);
  ctx.scale(f * sx, sy);
  const la = o.aim != null ? Math.atan2(Math.sin(o.aim), Math.cos(o.aim) * f) : -0.3;

  const img = images[sp.id];
  if (ready(img)) {
    const h = 42;
    const w = (h * img.naturalWidth) / img.naturalHeight;
    ctx.drawImage(img, -w / 2, -h, w, h);
    if (o.weapon) drawHeldWeapon(ctx, o.weapon, la, t, sp);
    ctx.restore();
    return;
  }

  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const out = sp.dark;
  drawTail(ctx, sp, t, out);
  const step = o.walking ? Math.sin(o.walk * 0.3) * 3 : 0;
  ell(ctx, -5 + step, -2.8, 4.6, 3, sp.feet || sp.dark, out);
  ell(ctx, 5 - step, -2.8, 4.6, 3, sp.feet || sp.dark, out);
  ell(ctx, 0, -12, 11, 10.5, sp.body, out);
  ell(ctx, 2.5, -10.5, 6.5, 7, sp.belly);

  // team scarf
  ctx.fillStyle = o.color || '#ff4d6d';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-9, -21.5, 18, 5.5, 2.75);
  ctx.fill();
  ctx.stroke();
  const flap = Math.sin(t * 7) * 1.5;
  ctx.beginPath();
  ctx.moveTo(-6, -18);
  ctx.quadraticCurveTo(-12, -17 + flap, -15, -12 + flap);
  ctx.lineTo(-11, -12 + flap * 0.5);
  ctx.quadraticCurveTo(-9, -15, -3, -17);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2;

  drawEars(ctx, sp, out);
  ell(ctx, 3, -27, 10.5, 10, sp.body, out);
  drawFace(ctx, sp, o, la, out);
  if (o.weapon) drawHeldWeapon(ctx, o.weapon, la, t, sp);
  ctx.restore();
}

function drawTail(ctx, sp, t, out) {
  const wag = Math.sin(t * 4) * 0.12;
  const longPath = () => {
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.quadraticCurveTo(-20, -10 + wag * 10, -16, -23 + wag * 8);
  };
  switch (sp.tail) {
    case 'bushy':
      ctx.save();
      ctx.translate(-8, -9);
      ctx.rotate(-0.7 + wag);
      ell(ctx, -8, 0, 9, 5.5, sp.body, out);
      ell(ctx, -14.5, 0, 3.5, 3.8, '#ffffff');
      ctx.restore();
      break;
    case 'puff':
      ell(ctx, -11, -10, 4.2, 4.2, '#ffffff', sp.dark);
      break;
    case 'stub':
      ell(ctx, -10.5, -10, 3.2, 3, sp.body, out);
      break;
    case 'long':
      ctx.save();
      ctx.strokeStyle = out;
      ctx.lineWidth = 6.5;
      longPath();
      ctx.stroke();
      ctx.strokeStyle = sp.body;
      ctx.lineWidth = 3.5;
      longPath();
      ctx.stroke();
      ctx.restore();
      break;
    case 'striped':
      ctx.save();
      ctx.translate(-8, -9);
      ctx.rotate(-0.6 + wag);
      ell(ctx, -8, 0, 9, 5, sp.body, out);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(-8, 0, 9, 5, 0, 0, TAU);
      ctx.clip();
      ctx.fillStyle = sp.dark;
      ctx.fillRect(-7, -6, 2.6, 12);
      ctx.fillRect(-12.5, -6, 2.6, 12);
      ctx.fillRect(-18, -6, 3, 12);
      ctx.restore();
      ctx.restore();
      break;
  }
}

function drawEars(ctx, sp, out) {
  const c = sp.earColor || sp.body;
  const inner = sp.inner || sp.belly;
  if (sp.ears === 'pointy') {
    tri(ctx, -6.5, -30, -4.5, -42, 1.5, -35, c, out);
    tri(ctx, -4.6, -32.5, -4, -38.5, -0.6, -35, inner);
    tri(ctx, 5, -35.5, 11.5, -42, 13, -30.5, c, out);
    tri(ctx, 7, -35, 10.8, -38.5, 11.3, -32.5, inner);
  } else if (sp.ears === 'round') {
    ell(ctx, -4.5, -34.5, 4.8, 4.8, c, out);
    ell(ctx, -4.5, -34.5, 2.4, 2.4, inner);
    ell(ctx, 10.5, -35, 4.8, 4.8, c, out);
    ell(ctx, 10.5, -35, 2.4, 2.4, inner);
  } else if (sp.ears === 'long') {
    ell(ctx, -1, -42, 3.6, 10, c, out, -0.18);
    ell(ctx, -1, -42, 1.8, 7, inner, null, -0.18);
    ell(ctx, 7, -43, 3.6, 10.5, c, out, 0.12);
    ell(ctx, 7, -43, 1.8, 7.5, inner, null, 0.12);
  }
}

function drawFace(ctx, sp, o, la, out) {
  const hx = 3;
  const hy = -27;
  const lx = Math.cos(la) * 0.9;
  const ly = Math.sin(la) * 0.9;

  if (sp.face === 'panda') {
    ell(ctx, hx + 1.5, hy - 0.5, 3.6, 4.4, '#2d2d33', null, 0.4);
    ell(ctx, hx + 8, hy - 0.5, 3.4, 4.2, '#2d2d33', null, -0.4);
  } else if (sp.face === 'mask') {
    ell(ctx, hx + 4.5, hy - 1, 8.8, 3.8, '#3d4048');
  }

  if (sp.face === 'muzzle' || sp.face === 'panda' || sp.face === 'mask') {
    ell(ctx, hx + 7, hy + 4.5, 5.2, 3.8, sp.belly);
    ell(ctx, hx + 11, hy + 2.6, 2, 1.6, '#3b2a2a');
    ctx.strokeStyle = '#3b2a2a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(hx + 9.5, hy + 4.6, 1.8, 0.1, Math.PI - 0.1);
    ctx.stroke();
  } else if (sp.face === 'beak') {
    ell(ctx, hx + 4.5, hy + 0.5, 7.5, 7, '#ffffff');
    ctx.lineWidth = 1.2;
    tri(ctx, hx + 7.5, hy + 1, hx + 16, hy + 3.5, hx + 7.5, hy + 6, '#ffab2e', '#c77a12');
  } else if (sp.face === 'frog') {
    ctx.strokeStyle = out;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx - 1, hy + 3);
    ctx.quadraticCurveTo(hx + 6, hy + 8.5, hx + 12.5, hy + 2.5);
    ctx.stroke();
  }

  const frog = sp.face === 'frog';
  const eyes = frog
    ? [
        [hx - 0.5, hy - 9, 3.6],
        [hx + 8, hy - 9.5, 3.6],
      ]
    : [
        [hx + 2, hy - 1.5, 3.1],
        [hx + 8.2, hy - 1.5, 3.1],
      ];
  ctx.lineWidth = 1.5;
  for (const [ex, ey, r] of eyes) {
    if (frog) {
      ctx.lineWidth = 2;
      ell(ctx, ex, ey, r + 1.8, r + 1.8, sp.body, out);
      ctx.lineWidth = 1.5;
    }
    if (o.hurt) {
      ctx.strokeStyle = '#1d1d24';
      ctx.beginPath();
      ctx.moveTo(ex - 2, ey - 2);
      ctx.lineTo(ex + 2, ey + 2);
      ctx.moveTo(ex + 2, ey - 2);
      ctx.lineTo(ex - 2, ey + 2);
      ctx.stroke();
    } else if (o.blink) {
      ctx.strokeStyle = '#1d1d24';
      ctx.beginPath();
      ctx.moveTo(ex - 2.4, ey);
      ctx.lineTo(ex + 2.4, ey);
      ctx.stroke();
    } else {
      ell(ctx, ex, ey, r, r * 1.08, '#ffffff');
      ell(ctx, ex + lx, ey + ly, r * 0.58, r * 0.62, '#1d1d24');
      ell(ctx, ex + lx + 0.8, ey + ly - 0.9, r * 0.22, r * 0.22, '#ffffff');
    }
  }
  ctx.globalAlpha = 0.35;
  ell(ctx, hx - 1.5, hy + 4.2, 2.6, 1.6, '#ff6f91');
  ctx.globalAlpha = 1;
}

export function drawHeldWeapon(ctx, id, la, t, sp) {
  ctx.save();
  ctx.translate(1, -14);
  ctx.rotate(la);
  ctx.lineWidth = 1.5;
  switch (id) {
    case 'rocket':
      rect(ctx, -4, -3.5, 25, 7, '#4f8a3c');
      rect(ctx, 17, -4.5, 5, 9, '#3b6a2c');
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(4, -3.5, 3, 7);
      break;
    case 'mega':
      rect(ctx, -5, -5, 26, 10, '#8a2e2e');
      rect(ctx, 18, -6, 6, 12, '#5e1d1d');
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(4, -5, 3, 10);
      break;
    case 'shotgun':
      rect(ctx, -7, -3, 11, 6, '#8a5a32');
      rect(ctx, 3, -2.2, 22, 4.4, '#6b7280');
      break;
    case 'drill':
      rect(ctx, -3, -3.5, 11, 7, '#e0a92e');
      tri(ctx, 8, -5, 23, 0, 8, 5, '#b8bec9', '#2a2a2a');
      break;
    case 'grenade':
      ell(ctx, 10, 0, 5, 5, '#4f7a36', '#2a2a2a');
      rect(ctx, 8.5, -7.5, 3, 3, '#a0a0a8');
      break;
    case 'cluster':
      ell(ctx, 10, 0, 5, 5, '#d64545', '#2a2a2a');
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(8.5, -4.5, 3, 9);
      break;
    case 'meteor':
      rect(ctx, -2, -1.5, 20, 3, '#7b5a3a');
      ctx.globalCompositeOperation = 'lighter';
      ell(ctx, 20, 0, 6 + Math.sin(t * 8), 6 + Math.sin(t * 8), 'rgba(255,140,60,0.5)');
      ctx.globalCompositeOperation = 'source-over';
      ell(ctx, 20, 0, 3.8, 3.8, '#ff8a3d', '#8a3a12');
      break;
    case 'teleport':
      rect(ctx, -2, -1.5, 18, 3, '#4a3a7a');
      ctx.save();
      ctx.translate(18, 0);
      ctx.rotate(t * 3);
      starPath(ctx, 5 + Math.sin(t * 6));
      ctx.fillStyle = '#ffe066';
      ctx.fill();
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      break;
  }
  ctx.lineWidth = 1.5;
  ell(ctx, 4, 2, 3.4, 3, sp.body, sp.dark);
  ctx.restore();
}

export function drawTombstone(ctx, color) {
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(-9, -15);
  ctx.arc(0, -15, 9, Math.PI, 0);
  ctx.lineTo(9, 0);
  ctx.closePath();
  ctx.fillStyle = '#b4bac4';
  ctx.fill();
  ctx.strokeStyle = '#5d636e';
  ctx.stroke();
  ctx.strokeStyle = '#6f7682';
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(0, -8);
  ctx.moveTo(-4, -16);
  ctx.lineTo(4, -16);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(-9, -5, 18, 3);
}

// ------------------------------------------------------------------ projectiles

export function drawProjectileShape(ctx, sprite, angle, spin, t) {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#2a2a2a';
  switch (sprite) {
    case 'rocket': {
      ctx.rotate(angle);
      const fl = 6 + Math.sin(t * 60) * 2;
      tri(ctx, -7, -2.5, -7 - fl, 0, -7, 2.5, '#ffb03b');
      rect(ctx, -8, -3.5, 14, 7, '#e8e8f0');
      tri(ctx, 6, -3.5, 11, 0, 6, 3.5, '#e94848', '#2a2a2a');
      tri(ctx, -8, -3.5, -11, -7, -4, -3.5, '#e94848', '#2a2a2a');
      tri(ctx, -8, 3.5, -11, 7, -4, 3.5, '#e94848', '#2a2a2a');
      break;
    }
    case 'grenade':
      ctx.rotate(spin);
      ell(ctx, 0, 0, 5.5, 5.5, '#4f7a36', '#2a2a2a');
      ell(ctx, -1.5, -1.5, 1.6, 1.6, 'rgba(255,255,255,0.5)');
      rect(ctx, -1.5, -8, 3, 3, '#a0a0a8');
      break;
    case 'cluster':
      ctx.rotate(spin);
      ell(ctx, 0, 0, 5.5, 5.5, '#d64545', '#2a2a2a');
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(-1.5, -5, 3, 10);
      break;
    case 'bomblet':
      ell(ctx, 0, 0, 3.2, 3.2, '#3a3a44', '#111');
      ell(ctx, 0, -3.5, 1.4, 1.4, Math.sin(t * 40) > 0 ? '#ffd23f' : '#ff5d2a');
      break;
    case 'pellet':
      ell(ctx, 0, 0, 2.2, 2.2, '#ffe066', '#8a6a12');
      break;
    case 'mega':
      ctx.rotate(spin * 0.4);
      ell(ctx, 0, 0, 9, 9, '#2c2c34', '#111');
      ell(ctx, -3, -3, 2.6, 2.6, 'rgba(255,255,255,0.35)');
      rect(ctx, -2.5, -11.5, 5, 3.5, '#77777f');
      ell(ctx, 0, -14, 2.2 + Math.sin(t * 30), 2.2 + Math.sin(t * 30), '#ffd23f');
      break;
    case 'drill':
      ctx.rotate(angle);
      rect(ctx, -10, -3.5, 8, 7, '#e0a92e');
      tri(ctx, -2, -4.5, 10, 0, -2, 4.5, '#c8ced8', '#2a2a2a');
      ctx.strokeStyle = '#8a909a';
      ctx.beginPath();
      ctx.moveTo(1, -3);
      ctx.lineTo(3 + Math.sin(t * 50) * 1.5, 3);
      ctx.stroke();
      break;
    case 'meteor':
      ctx.rotate(angle);
      ctx.globalCompositeOperation = 'lighter';
      ell(ctx, -6, 0, 14, 7, 'rgba(255,140,40,0.45)');
      ctx.globalCompositeOperation = 'source-over';
      ell(ctx, 0, 0, 7, 7, '#8a4a2a', '#3a1a0a');
      ell(ctx, 2, -2, 2.2, 2.2, '#ff8a3d');
      ell(ctx, -2, 2.5, 1.6, 1.6, '#5a2a1a');
      break;
    case 'shotgun':
      rect(ctx, -12, -3, 11, 6, '#8a5a32');
      rect(ctx, -2, -2.2, 16, 4.4, '#6b7280');
      break;
    case 'teleport':
      ctx.rotate(t);
      starPath(ctx, 9);
      ctx.fillStyle = '#ffe066';
      ctx.fill();
      ctx.strokeStyle = '#b8860b';
      ctx.stroke();
      break;
    default:
      ell(ctx, 0, 0, 4, 4, '#ffffff', '#2a2a2a');
  }
}

export function drawProjectile(ctx, pr, t) {
  ctx.save();
  ctx.translate(pr.x, pr.y);
  drawProjectileShape(ctx, pr.sprite, Math.atan2(pr.vy, pr.vx), pr.spin, t);
  ctx.restore();
}

/** Weapon bar icon, drawn into a square canvas of `size` CSS px. */
export function drawWeaponIcon(canvas, weapon) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = canvas.clientWidth || 40;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(size / 2, size / 2);
  const s = size / 22;
  ctx.scale(s, s);
  const sprite = weapon.id === 'shotgun' ? 'shotgun' : weapon.sprite || weapon.id;
  drawProjectileShape(ctx, sprite, weapon.id === 'meteor' ? 0.9 : -0.6, 0, 0.3);
}
