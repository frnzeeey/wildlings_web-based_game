import { Match, type MatchOptions } from '../src/sim/match.ts';
import { Bot, type Difficulty } from '../src/ai.ts';
import { RULES } from '../src/spec.ts';

export function makeMatch(over: Partial<MatchOptions> = {}): Match {
  return new Match({
    mapId: 'grasslands',
    seed: 1234,
    players: [
      { name: 'A', species: 'fox', team: 0 },
      { name: 'B', species: 'bear', team: 1 },
    ],
    ...over,
  });
}

/** Step until predicate is true (or throw after maxSeconds of sim time). */
export function runUntil(m: Match, pred: () => boolean, maxSeconds = 30): void {
  const ticks = maxSeconds * RULES.world.tickRate;
  for (let i = 0; i < ticks; i++) {
    if (pred()) return;
    m.step();
  }
  if (!pred()) throw new Error(`condition not met within ${maxSeconds}s (phase ${m.phase})`);
}

export function toAim(m: Match): void {
  m.start();
  runUntil(m, () => m.phase === 'aim');
}

/** Put the two characters on flat ground a fixed distance apart (bypasses the generator). */
export function flatArena(m: Match, gap = 200, groundY = 900): void {
  const { width, height } = m.terrain;
  m.terrain.data.fill(0);
  for (let y = groundY; y < height; y++) m.terrain.data.fill(1, y * width, (y + 1) * width);
  m.barrels.length = 0;
  m.mines.length = 0;
  const r = RULES.character.radius;
  const cx = width / 2;
  m.characters.forEach((c, i) => {
    c.x = cx + (i === 0 ? -gap / 2 : gap / 2) + (i > 1 ? i * 30 : 0);
    c.y = groundY - r - 1;
    c.vx = c.vy = 0;
    c.onGround = true;
  });
}

/** Play a whole match with bots in every slot. Returns the finished match. */
export function botMatch(seed: number, mapId: string, levels: Difficulty[], maxSeconds = 1500): Match {
  const m = makeMatch({
    seed,
    mapId,
    players: levels.map((_, i) => ({ name: `Bot${i}`, species: 'fox', team: i })),
    settings: { turnTime: 30 },
  });
  const bots = levels.map((d, i) => new Bot(d, seed + i));
  m.start();
  const dt = 1 / RULES.world.tickRate;
  for (let i = 0; i < maxSeconds * RULES.world.tickRate && m.phase !== 'over'; i++) {
    const s = m.activeSlot;
    for (const c of bots[s].update(dt, m, s, Infinity)) m.command(s, c);
    m.step();
  }
  return m;
}
