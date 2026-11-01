import { TAU } from '../game/utils.js';

const FIRE = ['#fff6c2', '#ffd23f', '#ff9f1c', '#ff5d2a'];
const rand = (a, b) => a + Math.random() * (b - a);

/** Purely cosmetic particles, rings and floating text (never affects gameplay). */
export class Effects {
  constructor(game) {
    this.game = game;
    this.particles = [];
    this.rings = [];
    this.texts = [];
  }

  add(p) {
    if (this.particles.length > 1800) return;
    p.max = p.life;
    p.rot = p.rot ?? 0;
    p.vr = p.vr ?? 0;
    p.drag = p.drag ?? 0;
    p.grav = p.grav ?? 0;
    p.grow = p.grow ?? 0;
    this.particles.push(p);
  }

  explosion(x, y, r) {
    const s = r / 50;
    this.rings.push({ kind: 'flash', x, y, r: r * 1.15, life: 0.16, max: 0.16 });
    this.rings.push({ kind: 'ring', x, y, r: r * 0.3, to: r * 1.3, life: 0.35, max: 0.35 });
    const n = Math.round(14 + r / 3);
    const g = this.game.map.ground;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = rand(60, 320) * s;
      this.add({ kind: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: rand(0.25, 0.7), size: rand(3, 7) * Math.sqrt(s), color: FIRE[i % 4], grav: 200, drag: 2.5 });
    }
    for (let i = 0; i < n * 0.6; i++) {
      this.add({ kind: 'smoke', x: x + rand(-r, r) * 0.35, y: y + rand(-r, r) * 0.35, vx: rand(-30, 30), vy: rand(-70, -20), life: rand(0.9, 1.8), size: r * rand(0.18, 0.36), grow: r * 0.5, color: '#77777f', grav: -20, drag: 1.2 });
    }
    for (let i = 0; i < n * 0.7; i++) {
      const a = Math.random() * TAU;
      const sp = rand(120, 420) * s;
      this.add({ kind: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, life: rand(0.8, 1.6), size: rand(2, 5), color: [g.top, g.dirt, g.dirt2][i % 3], grav: 900, drag: 0.3, rot: rand(0, TAU), vr: rand(-12, 12), solidKill: true });
    }
  }

  trail(x, y, sprite) {
    if (sprite === 'meteor') {
      this.add({ kind: 'fire', x: x + rand(-3, 3), y: y + rand(-3, 3), vx: rand(-20, 20), vy: rand(-40, 0), life: rand(0.2, 0.45), size: rand(3, 6), color: FIRE[Math.floor(rand(0, 4))], drag: 1 });
    } else if (sprite === 'drill') {
      const g = this.game.map.ground;
      this.add({ kind: 'debris', x, y, vx: rand(-120, 120), vy: rand(-220, -60), life: rand(0.4, 0.8), size: rand(2, 4), color: g.dirt, grav: 800, rot: rand(0, TAU), vr: rand(-10, 10) });
    } else {
      this.add({ kind: 'smoke', x, y, vx: rand(-10, 10), vy: rand(-20, -5), life: rand(0.4, 0.7), size: rand(3, 5), grow: 10, color: '#d8d8de', drag: 1 });
    }
  }

  muzzle(x, y, angle) {
    for (let i = 0; i < 8; i++) {
      const a = angle + rand(-0.4, 0.4);
      const sp = rand(80, 260);
      this.add({ kind: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.08, 0.2), size: rand(2, 4), color: FIRE[i % 3], drag: 4 });
    }
    this.add({ kind: 'smoke', x, y, vx: Math.cos(angle) * 30, vy: Math.sin(angle) * 30 - 15, life: 0.6, size: 6, grow: 14, color: '#cfcfd6', drag: 2 });
  }

  dust(x, y, impact) {
    const n = Math.min(14, 4 + impact / 80);
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      this.add({ kind: 'smoke', x, y, vx: dir * rand(30, 110), vy: rand(-40, -5), life: rand(0.35, 0.7), size: rand(3, 6), grow: 8, color: '#d9c7a8', drag: 3 });
    }
  }

  splash(x, y, s = 1) {
    this.rings.push({ kind: 'ring', x, y, r: 6, to: 40 * s, life: 0.5, max: 0.5, flat: true, color: '#ffffff' });
    for (let i = 0; i < 18 * s; i++) {
      this.add({ kind: 'drop', x: x + rand(-8, 8) * s, y, vx: rand(-90, 90) * s, vy: rand(-380, -140) * s, life: rand(0.5, 0.9), size: rand(2, 4), color: i % 3 ? '#bfe9ff' : '#ffffff', grav: 900 });
    }
  }

  poof(x, y, color) {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      const sp = rand(60, 160);
      this.add({ kind: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 0.8), size: rand(3, 6), color: i % 2 ? color : '#fff6c2', drag: 3, rot: rand(0, TAU), vr: rand(-8, 8) });
    }
    for (let i = 0; i < 6; i++) {
      this.add({ kind: 'smoke', x: x + rand(-8, 8), y: y + rand(-8, 8), vx: rand(-20, 20), vy: rand(-30, 0), life: rand(0.5, 0.9), size: 8, grow: 14, color: '#f2f2f7', drag: 2 });
    }
  }

  floatText(x, y, text, color, size = 22) {
    this.texts.push({ x, y, text, color, size, life: 1.4, max: 1.4 });
  }

  update(dt) {
    const T = this.game.terrain;
    for (const p of this.particles) {
      p.life -= dt;
      p.vx *= 1 - Math.min(1, p.drag * dt);
      p.vy *= 1 - Math.min(1, p.drag * dt);
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.size += p.grow * dt;
      if (p.solidKill && p.vy > 0 && T.isSolid(p.x, p.y)) p.life = 0;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 28 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  draw(ctx) {
    for (const r of this.rings) {
      const k = r.life / r.max;
      if (r.kind === 'flash') {
        const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.r);
        g.addColorStop(0, `rgba(255,255,230,${k})`);
        g.addColorStop(0.5, `rgba(255,210,90,${k * 0.8})`);
        g.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, TAU);
        ctx.fill();
      } else {
        const rad = r.to + (r.r - r.to) * k;
        ctx.strokeStyle = r.color || `rgba(255,240,200,${k})`;
        ctx.globalAlpha = r.color ? k : 1;
        ctx.lineWidth = 4 * k + 1;
        ctx.beginPath();
        if (r.flat) ctx.ellipse(r.x, r.y, rad, rad * 0.3, 0, 0, TAU);
        else ctx.arc(r.x, r.y, rad, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    for (const p of this.particles) {
      if (p.kind !== 'smoke') continue;
      ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.42;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const p of this.particles) {
      const k = Math.max(0, p.life / p.max);
      if (p.kind === 'debris') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else if (p.kind === 'drop') {
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'star') {
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        starPath(ctx, p.size);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (p.kind !== 'fire') continue;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx, zoom) {
    const s = 1 / Math.max(0.6, zoom);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const pop = k > 0.85 ? 1 + (k - 0.85) * 3 : 1;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = `700 ${Math.round(t.size * s * pop)}px Fredoka, "Trebuchet MS", sans-serif`;
      ctx.lineWidth = 4 * s;
      ctx.strokeStyle = '#2a1a1a';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}

export function starPath(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
}
