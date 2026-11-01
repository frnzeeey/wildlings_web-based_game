import { describe, it, expect } from 'vitest';
import { Bot } from '../src/ai.ts';
import { MAPS, RULES } from '../src/spec.ts';
import { makeMatch, runUntil, toAim, botMatch, flatArena } from './helpers.ts';

const dt = 1 / RULES.world.tickRate;

/** Let a bot take one turn; returns the damage it dealt to the enemy. */
function botTurn(level: 'easy' | 'normal' | 'hard', seed: number, mapId: string, wind: 'off' | 'normal' | 'high') {
  const m = makeMatch({ seed, mapId, settings: { wind, turnTime: 30 } });
  toAim(m);
  const s = m.activeSlot;
  const bot = new Bot(level, seed);
  const enemy = m.characters[1 - s];
  const hp = enemy.hp;
  let fired = false;
  runUntil(m, () => {
    for (const c of bot.update(dt, m, s, Infinity)) {
      const r = m.command(s, c);
      if (c.t === 'fire') fired = r.ok;
    }
    return m.phase !== 'aim';
  }, 31);
  runUntil(m, () => m.phase === 'start' || m.phase === 'over', 30);
  return { fired, damage: hp - Math.max(0, enemy.hp) + (enemy.alive ? 0 : 50) };
}

describe('bots', () => {
  it.each(['easy', 'normal', 'hard'] as const)('%s bot fires a valid shot within its turn', (level) => {
    for (const map of MAPS) {
      const r = botTurn(level, 3, map.id, 'normal');
      expect(r.fired).toBe(true);
    }
  });

  it('harder bots deal more damage on average across maps and wind', () => {
    const avg = (level: 'easy' | 'hard') => {
      let total = 0;
      let n = 0;
      for (const map of MAPS) {
        for (const seed of [11, 12, 13, 14]) {
          total += botTurn(level, seed, map.id, seed % 2 ? 'high' : 'normal').damage;
          n++;
        }
      }
      return total / n;
    };
    const easy = avg('easy');
    const hard = avg('hard');
    expect(hard).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(10);
  });

  it('hard bot is not perfect: it misses some shots', () => {
    let misses = 0;
    for (let seed = 30; seed < 42; seed++) if (botTurn('hard', seed, 'grasslands', 'high').damage === 0) misses++;
    expect(misses).toBeGreaterThan(0);
  });

  it('bot avoids hurting itself at point-blank range', () => {
    const m = makeMatch({ seed: 9, settings: { wind: 'off' } });
    toAim(m);
    flatArena(m, 60);
    const s = m.activeSlot;
    const me = m.characters[s];
    const bot = new Bot('hard', 1);
    runUntil(m, () => {
      for (const c of bot.update(dt, m, s, Infinity)) m.command(s, c);
      return m.phase !== 'aim';
    }, 31);
    runUntil(m, () => m.phase === 'start' || m.phase === 'over', 30);
    expect(me.stats.selfDamage).toBeLessThan(25);
  });

  it('bot vs bot matches finish with a result on every map', () => {
    for (const map of MAPS) {
      const m = botMatch(100 + map.id.length, map.id, ['normal', 'hard']);
      expect(m.phase).toBe('over');
      expect(m.result).not.toBeNull();
      // No leaked entities after a full match.
      expect(m.projectiles.length).toBe(0);
      expect(m.events.length).toBeLessThan(100000);
    }
  }, 120_000);
});
