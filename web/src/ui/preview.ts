import { art } from '../game/art.ts';

/** A critter drawn in HTML from the shared SVG parts (menus, lobby, results). Same rig as Critter.ts. */
export function critterHtml(species: string, color: string, size = 2, opts: { hop?: boolean; facing?: number; weapon?: string; happy?: boolean } = {}): string {
  const m = art.manifest;
  const rig = art.species(species);
  // [key, x, y, tint?, transform?]
  const parts: [string, number, number, string?, string?][] = [['shadow', 0, 0]];
  const team: [string, number, number, string] = [`${species}_team`, 0, 0, color];
  if (rig.team === 'back') parts.push(team);
  if (rig.tail) parts.push([`${species}_tail`, 0, 0]);
  parts.push([`${species}_foot`, rig.feet[0][0], rig.feet[0][1]], [`${species}_body`, 0, 0]);
  if (rig.team === 'body') parts.push(team);
  parts.push([`${species}_head`, 0, 0]);
  if (rig.team === 'head') parts.push(team);
  for (const e of rig.eyes) {
    const k = e.r / 4;
    if (opts.happy) parts.push(['eye_happy', e.x, e.y, undefined, `scale(${k})`]);
    else parts.push(['eye_white', e.x, e.y, undefined, `scale(${k})`], ['eye_pupil', e.x + 0.6, e.y + 0.2, undefined, `scale(${k})`]);
    parts.push(['brow', e.x, e.y - e.r - 2.6, undefined, `scale(${e.far ? -k : k}, ${k})`]);
  }
  if (opts.happy) parts.push(['mouth_open', rig.mouth.x, rig.mouth.y]);
  parts.push([`${species}_foot`, rig.feet[1][0], rig.feet[1][1]]);
  if (opts.weapon) parts.push([`held_${opts.weapon}`, rig.arm.x, rig.arm.y, undefined, 'rotate(-18deg)'], [`${species}_hand`, rig.arm.x + 3.8, rig.arm.y + 1.4]);
  const html = parts
    .map(([key, ox, oy, tint, transform]) => {
      const b = m.parts[key];
      if (!b) return '';
      const origin = `${(-b.x / b.w) * 100}% ${(-b.y / b.h) * 100}%`;
      const style = `left:${(b.x + ox) * size}px;top:${(b.y + oy) * size}px;width:${b.w * size}px;height:${b.h * size}px;${transform ? `transform:${transform};transform-origin:${origin};` : ''}`;
      if (tint) return `<i class="part tint" style="${style};background:${tint};-webkit-mask-image:url(${art.url(key)});mask-image:url(${art.url(key)})"></i><img class="part" alt="" draggable="false" src="${art.url(key)}" style="${style};mix-blend-mode:multiply">`;
      return `<img class="part" alt="" draggable="false" src="${art.url(key)}" style="${style}">`;
    })
    .join('');
  const flip = (opts.facing ?? 1) < 0 ? 'transform:scaleX(-1);' : '';
  return `<span class="critter ${opts.hop ? 'hop' : ''}" style="width:${46 * size}px;height:${72 * size}px;"><span class="critter-rig" style="${flip}">${html}</span></span>`;
}
