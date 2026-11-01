import { drawAnimal, speciesById } from '../rendering/Sprites.js';

/**
 * Animates every <canvas data-species data-color> inside `root` with a bobbing critter.
 * Returns a stop() function.
 */
export function animatePreviews(root, { scale = 2.4 } = {}) {
  const canvases = [...root.querySelectorAll('canvas[data-species]')];
  if (!canvases.length) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const c of canvases) {
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
  }
  let raf = 0;
  const start = performance.now();
  const tick = (now) => {
    const t = (now - start) / 1000;
    canvases.forEach((c, i) => {
      const ctx = c.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      const w = c.width / dpr;
      const h = c.height / dpr;
      const s = Number(c.dataset.scale || scale);
      const hop = c.dataset.hop ? Math.max(0, Math.sin(t * 4 + i * 1.3)) * 14 : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.ellipse(w / 2, h - 10, 13 * s * (1 - hop / 40), 3 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(w / 2, h - 10 - hop);
      ctx.scale(s, s);
      const blink = (t + i * 0.7) % 3.5 < 0.12;
      drawAnimal(ctx, speciesById(c.dataset.species), {
        t: t + i,
        facing: c.dataset.facing === '-1' ? -1 : 1,
        aim: -0.35 + Math.sin(t * 1.5 + i) * 0.25,
        color: c.dataset.color,
        blink,
        air: hop > 2,
        weapon: c.dataset.weapon || null,
      });
    });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
