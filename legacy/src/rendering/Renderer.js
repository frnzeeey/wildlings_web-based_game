import { WORLD, PLAYER } from '../game/config.js';
import { RNG, makeNoise1D, rgba, clamp, hash2 } from '../game/utils.js';
import { launchParams } from '../game/Weapon.js';
import { drawAnimal, drawTombstone, drawProjectile, speciesById } from './Sprites.js';

const TAU = Math.PI * 2;

export class Renderer {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const rng = new RNG(game.seed ^ 0x5bd1e995);
    this.farNoise = makeNoise1D(rng);
    this.nearNoise = makeNoise1D(rng);
    this.clouds = Array.from({ length: 9 }, () => ({ x: rng.float(0, 3000), y: rng.float(30, 240), s: rng.float(0.6, 1.4), speed: rng.float(4, 14) }));
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.game.camera.resize(w, h);
  }

  render() {
    const g = this.game;
    const ctx = this.ctx;
    const cam = g.camera;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawSky(ctx);
    this.drawHills(ctx, 0.25, this.farNoise, g.map.hills[0], 640, 220, false);
    this.drawHills(ctx, 0.5, this.nearNoise, g.map.hills[1], 760, 170, true);

    cam.apply(ctx, this.dpr);
    this.drawWater(ctx, false);
    ctx.drawImage(g.terrain.backCanvas, 0, 0);
    ctx.drawImage(g.terrain.canvas, 0, 0);

    const t = g.time;
    const tm = g.turns;
    const active = tm.active;
    const showAim = active && active.alive && (tm.phase === 'aim' || tm.phase === 'start') && !g.over;

    for (const p of g.players) {
      if (p.drowned) continue;
      ctx.save();
      ctx.translate(p.x, p.y + PLAYER.radius);
      if (!p.alive) drawTombstone(ctx, p.color);
      else {
        const isActive = p === active && showAim;
        drawAnimal(ctx, speciesById(p.species), {
          facing: p.facing,
          aim: p.aim,
          crouch: p.crouching,
          air: !p.onGround,
          walk: p.anim.walk,
          walking: p.anim.walking > 0,
          t: p.anim.t,
          blink: p.anim.blink > 0,
          hurt: p.anim.hurt > 0,
          color: p.color,
          weapon: isActive ? p.weapon.id : null,
        });
      }
      ctx.restore();
    }

    if (showAim && tm.phase === 'aim') this.drawAim(ctx, active);
    for (const pr of g.projectiles) drawProjectile(ctx, pr, t);
    g.effects.draw(ctx);
    this.drawWater(ctx, true);
    this.drawLabels(ctx, showAim ? active : null);
    g.effects.drawTexts(ctx, cam.zoom);
  }

  // ------------------------------------------------------------ background

  drawSky(ctx) {
    const g = this.game;
    const cam = g.camera;
    const grad = ctx.createLinearGradient(0, 0, 0, this.h);
    grad.addColorStop(0, g.map.sky[0]);
    grad.addColorStop(1, g.map.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);

    const sx = this.w * 0.8 - (cam.x - WORLD.width / 2) * 0.03;
    const sy = this.h * 0.17 - (cam.y - 600) * 0.03;
    const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 120);
    glow.addColorStop(0, 'rgba(255,250,210,0.9)');
    glow.addColorStop(1, 'rgba(255,250,210,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 120, sy - 120, 240, 240);
    ctx.fillStyle = '#fff6c8';
    ctx.beginPath();
    ctx.arc(sx, sy, 34, 0, TAU);
    ctx.fill();

    const span = this.w + 400;
    for (const c of this.clouds) {
      const x = ((((c.x + g.time * c.speed - cam.x * 0.12) % span) + span) % span) - 200;
      const y = c.y - (cam.y - 600) * 0.08;
      this.drawCloud(ctx, x, y, c.s);
    }
  }

  drawCloud(ctx, x, y, s) {
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, TAU);
    ctx.arc(x + 26 * s, y - 10 * s, 28 * s, 0, TAU);
    ctx.arc(x + 56 * s, y, 22 * s, 0, TAU);
    ctx.arc(x + 28 * s, y + 8 * s, 22 * s, 0, TAU);
    ctx.fill();
  }

  drawHills(ctx, f, noise, color, baseY, amp, withTrees) {
    const cam = this.game.camera;
    const z = cam.zoom;
    const W = this.w;
    const H = this.h;
    const lx0 = cam.x * f;
    const baseScreen = H / 2 + (baseY - cam.y) * z * (f + 0.15);
    const heightAt = (lx) => baseScreen - noise(lx / 260) * amp * z - noise(lx / 90 + 50) * amp * 0.25 * z;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let sx = 0; sx <= W + 8; sx += 8) ctx.lineTo(sx, heightAt(lx0 + (sx - W / 2) / z));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    if (!withTrees) return;

    const step = 110;
    const left = lx0 - W / 2 / z - step;
    const right = lx0 + W / 2 / z + step;
    for (let k = Math.floor(left / step); k <= right / step; k++) {
      const h = hash2(k, 77);
      if (h % 3 !== 0) continue;
      const lx = k * step + (h % 50);
      const sx = W / 2 + (lx - lx0) * z;
      this.drawTree(ctx, sx, heightAt(lx) + 4 * z, z * (0.8 + (h % 7) / 14), (h >> 8) % 2);
    }
  }

  drawTree(ctx, x, y, s, variant) {
    const m = this.game.map;
    ctx.fillStyle = m.tree;
    ctx.strokeStyle = m.tree;
    switch (m.decor) {
      case 'cactus':
        ctx.lineCap = 'round';
        ctx.lineWidth = 9 * s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 46 * s);
        ctx.moveTo(x, y - 22 * s);
        ctx.lineTo(x - 13 * s, y - 24 * s);
        ctx.lineTo(x - 13 * s, y - 36 * s);
        if (variant) {
          ctx.moveTo(x, y - 28 * s);
          ctx.lineTo(x + 12 * s, y - 30 * s);
          ctx.lineTo(x + 12 * s, y - 40 * s);
        }
        ctx.stroke();
        break;
      case 'pine':
        for (let i = 0; i < 3; i++) {
          const w = (24 - i * 6) * s;
          const ty = y - (14 + i * 16) * s;
          ctx.fillStyle = m.tree;
          ctx.beginPath();
          ctx.moveTo(x - w, ty + 16 * s);
          ctx.lineTo(x, ty - 14 * s);
          ctx.lineTo(x + w, ty + 16 * s);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.moveTo(x - w * 0.35, ty - 3 * s);
          ctx.lineTo(x, ty - 14 * s);
          ctx.lineTo(x + w * 0.35, ty - 3 * s);
          ctx.fill();
        }
        break;
      case 'palm':
        ctx.lineWidth = 5 * s;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#a07a4a';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 8 * s, y - 30 * s, x + 4 * s, y - 56 * s);
        ctx.stroke();
        ctx.fillStyle = m.tree;
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.62;
          ctx.beginPath();
          ctx.ellipse(x + 4 * s + Math.cos(a) * 16 * s, y - 56 * s + Math.sin(a) * 8 * s + 6 * s, 18 * s, 5 * s, a, 0, TAU);
          ctx.fill();
        }
        break;
      default:
        ctx.fillStyle = '#7a5a3a';
        ctx.fillRect(x - 3 * s, y - 22 * s, 6 * s, 24 * s);
        ctx.fillStyle = m.tree;
        ctx.beginPath();
        ctx.arc(x, y - 30 * s, 15 * s, 0, TAU);
        ctx.arc(x - 11 * s, y - 22 * s, 11 * s, 0, TAU);
        ctx.arc(x + 11 * s, y - 22 * s, 11 * s, 0, TAU);
        ctx.fill();
    }
  }

  drawWater(ctx, front) {
    const g = this.game;
    const cam = g.camera;
    const z = cam.zoom;
    const left = cam.x - this.w / 2 / z - 40;
    const right = cam.x + this.w / 2 / z + 40;
    const bottom = cam.y + this.h / 2 / z + 60;
    const wl = WORLD.waterLevel;
    const t = g.time;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    for (let x = left; x <= right + 12; x += 12) {
      const y = front ? wl + 8 + Math.sin(x * 0.022 + t * 2.3 + 2) * 4 : wl + Math.sin(x * 0.016 + t * 1.6) * 5;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(right + 12, bottom);
    ctx.closePath();
    ctx.fillStyle = rgba(g.map.water, front ? 0.72 : 0.9);
    ctx.fill();
    if (front) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let x = left; x <= right + 12; x += 12) {
        const y = wl + 8 + Math.sin(x * 0.022 + t * 2.3 + 2) * 4;
        x === left ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------ overlays

  drawAim(ctx, p) {
    const g = this.game;
    const w = p.weapon;
    const t = g.time;

    if (w.targeted) {
      if (!p.target) return;
      const { x, y } = p.target;
      const ok = w.targeted === 'column' || g.canStandAt(x, y);
      const col = ok ? '#ffffff' : '#ff5a5a';
      if (w.targeted === 'column') {
        ctx.setLineDash([10, 10]);
        ctx.lineDashOffset = -t * 40;
        ctx.strokeStyle = 'rgba(255,140,60,0.8)';
        ctx.lineWidth = 2;
        for (const dx of [-w.spread / 2, 0, w.spread / 2]) {
          ctx.beginPath();
          ctx.moveTo(x + dx, y - 600);
          ctx.lineTo(x + dx, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      } else {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, PLAYER.radius, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      this.crosshair(ctx, x, y, 14 + Math.sin(t * 6) * 2, col);
      return;
    }

    const c = Math.cos(p.aim);
    const s = Math.sin(p.aim);
    const power = w.fixedPower ? 1 : p.power;
    const start = PLAYER.radius + 10;
    const len = 20 + power * 60;
    const segs = 12;
    ctx.lineCap = 'round';
    for (let i = 0; i < segs; i++) {
      const a = i / segs;
      const b = (i + 0.7) / segs;
      ctx.strokeStyle = `hsl(${55 - a * 55 * power}, 100%, ${60 - a * 8}%)`;
      ctx.lineWidth = 3 + a * 5;
      ctx.beginPath();
      ctx.moveTo(p.x + c * (start + a * len), p.y - 4 + s * (start + a * len));
      ctx.lineTo(p.x + c * (start + b * len), p.y - 4 + s * (start + b * len));
      ctx.stroke();
    }
    this.crosshair(ctx, p.x + c * (start + len + 14), p.y - 4 + s * (start + len + 14), 7, '#ffffff');

    if (!g.settings.aimGuide || p.isAI) return;
    // Crouching steadies the aim: a longer guide that also accounts for wind.
    const L = launchParams(p, p.aim, p.power, w);
    const steady = p.crouching;
    const dur = steady ? 0.9 : 0.32;
    let { x, y, vx, vy } = L;
    const dt = 1 / 60;
    ctx.fillStyle = steady ? 'rgba(255,255,140,0.95)' : 'rgba(255,255,255,0.85)';
    for (let i = 0, n = Math.round(dur / dt); i < n; i++) {
      if (steady) vx += g.wind * WORLD.windAccel * (w.wind ?? 0) * dt;
      vy += WORLD.gravity * (w.gravity ?? 1) * dt;
      x += vx * dt;
      y += vy * dt;
      if (g.terrain.isSolid(x, y)) break;
      if (i % 4 === 0) {
        ctx.globalAlpha = 1 - i / n;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  crosshair(ctx, x, y, r, color) {
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    this.crossPath(ctx, x, y, r);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    this.crossPath(ctx, x, y, r);
    ctx.stroke();
  }

  crossPath(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.moveTo(x - r - 4, y);
    ctx.lineTo(x - r * 0.4, y);
    ctx.moveTo(x + r * 0.4, y);
    ctx.lineTo(x + r + 4, y);
    ctx.moveTo(x, y - r - 4);
    ctx.lineTo(x, y - r * 0.4);
    ctx.moveTo(x, y + r * 0.4);
    ctx.lineTo(x, y + r + 4);
  }

  drawLabels(ctx, active) {
    const g = this.game;
    const z = g.camera.zoom;
    const s = clamp(1 / z, 0.85, 1.7);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const p of g.players) {
      if (!p.alive) continue;
      ctx.save();
      ctx.translate(p.x, p.y - 38);
      ctx.scale(s, s);
      ctx.font = '600 12px Fredoka, "Trebuchet MS", sans-serif';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(20,20,30,0.75)';
      ctx.strokeText(p.name, 0, -10);
      ctx.fillStyle = p.color;
      ctx.fillText(p.name, 0, -10);
      const bw = 38;
      const k = p.hp / p.maxHp;
      ctx.fillStyle = 'rgba(20,20,30,0.75)';
      ctx.beginPath();
      ctx.roundRect(-bw / 2 - 2, -2, bw + 4, 8, 4);
      ctx.fill();
      ctx.fillStyle = k > 0.5 ? '#5ee05e' : k > 0.25 ? '#ffd23f' : '#ff4d4d';
      ctx.beginPath();
      ctx.roundRect(-bw / 2, 0, Math.max(0, bw * k), 4, 2);
      ctx.fill();
      if (p === active) {
        const by = -30 + Math.sin(g.time * 6) * 3;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-7, by - 6);
        ctx.lineTo(7, by - 6);
        ctx.lineTo(0, by + 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
