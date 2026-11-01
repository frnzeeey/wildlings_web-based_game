import { describe, it, expect } from 'vitest';
import { RULES, WEAPONS, weaponById } from '../src/spec.ts';
import { damageAt } from '../src/sim/weapons.ts';
import type { SimEvent } from '../src/sim/types.ts';
import { Barrel } from '../src/sim/entities.ts';
import { makeMatch, runUntil, toAim, flatArena } from './helpers.ts';

const C = RULES.character;
const aimAt = (m: ReturnType<typeof makeMatch>, from: number, to: number) => {
  const a = m.characters[from];
  const b = m.characters[to];
  return Math.atan2(b.y - a.y, b.x - a.x);
};

describe('turn flow', () => {
  it('starts, opens aiming after the delay, and rejects the other player', () => {
    const m = makeMatch();
    m.start();
    expect(m.phase).toBe('start');
    const s = m.activeSlot;
    expect(m.command(s, { t: 'fire', weapon: 'rocket', angle: 0, power: 1 })).toEqual({ ok: false, error: 'wrong-phase' });
    runUntil(m, () => m.phase === 'aim', RULES.turn.startDelay + 0.1);
    const other = 1 - s;
    expect(m.command(other, { t: 'fire', weapon: 'rocket', angle: 0, power: 1 })).toEqual({ ok: false, error: 'not-your-turn' });
    expect(m.command(other, { t: 'input', move: 1, up: false, down: false }).ok).toBe(false);
  });

  it('passes the turn to the other player after a shot settles', () => {
    const m = makeMatch();
    toAim(m);
    const s = m.activeSlot;
    expect(m.command(s, { t: 'fire', weapon: 'rocket', angle: -Math.PI / 2, power: 0.3 }).ok).toBe(true);
    expect(m.phase).toBe('action');
    runUntil(m, () => m.turnNumber === 2);
    expect(m.activeSlot).toBe(1 - s);
  });

  it('rejects a second shot in the same turn', () => {
    const m = makeMatch();
    toAim(m);
    const s = m.activeSlot;
    m.command(s, { t: 'fire', weapon: 'rocket', angle: -1, power: 0.5 });
    expect(m.command(s, { t: 'fire', weapon: 'rocket', angle: -1, power: 0.5 }).ok).toBe(false);
  });

  it('ends the turn when the timer runs out', () => {
    const m = makeMatch({ settings: { turnTime: 5 } });
    toAim(m);
    const events: SimEvent[] = [];
    runUntil(m, () => {
      events.push(...m.takeEvents());
      return m.phase === 'action';
    }, 6);
    expect(events.some((e) => e.e === 'timeUp')).toBe(true);
  });

  it('validates aim and fire parameters', () => {
    const m = makeMatch();
    toAim(m);
    const s = m.activeSlot;
    expect(m.command(s, { t: 'fire', weapon: 'rocket', angle: NaN, power: 1 }).ok).toBe(false);
    expect(m.command(s, { t: 'fire', weapon: 'rocket', angle: 0, power: 1.5 }).ok).toBe(false);
    expect(m.command(s, { t: 'fire', weapon: 'nuke', angle: 0, power: 1 }).ok).toBe(false);
    expect(m.command(s, { t: 'fire', weapon: 'airstrike', angle: 0, power: 1 }).ok).toBe(false); // needs target
    expect(m.command(s, { t: 'fire', weapon: 'teleport', angle: 0, power: 1, tx: 1300, ty: 1290 }).ok).toBe(false); // inside ground
    expect(m.command(s, { t: 'bogus' } as never).ok).toBe(false);
  });
});

describe('movement allowance', () => {
  it('walking drains energy and stops when it runs out', () => {
    const m = makeMatch();
    toAim(m);
    flatArena(m, 1200);
    const s = m.activeSlot;
    const p = m.characters[s];
    const x0 = p.x;
    m.command(s, { t: 'input', move: 1, up: false, down: false });
    runUntil(m, () => p.energy <= 0, 10);
    const walked = p.x - x0;
    expect(walked).toBeGreaterThan(150);
    expect(walked).toBeLessThan(C.maxEnergy / C.energyPerPx + 2);
    const x1 = p.x;
    for (let i = 0; i < 60; i++) m.step();
    expect(p.x).toBe(x1);
  });

  it('jumping costs energy and needs ground', () => {
    const m = makeMatch();
    toAim(m);
    flatArena(m);
    const s = m.activeSlot;
    const p = m.characters[s];
    expect(m.command(s, { t: 'jump' }).ok).toBe(true);
    m.step();
    expect(p.onGround).toBe(false);
    expect(p.energy).toBe(C.maxEnergy - C.jumpCost);
    expect(m.command(s, { t: 'jump' })).toEqual({ ok: false, error: 'airborne' });
  });
});

describe('combat', () => {
  it('damage falls off with distance', () => {
    const w = weaponById('rocket')!;
    expect(damageAt(0, w)).toBe(w.damage);
    expect(damageAt(C.radius + 3 + w.radius / 2, w)).toBe(Math.round(w.damage / 2));
    expect(damageAt(C.radius + 3 + w.radius, w)).toBe(0);
  });

  it('a direct rocket hit damages, knocks back and carves the terrain', () => {
    const m = makeMatch({ settings: { wind: 'off' } });
    toAim(m);
    flatArena(m, 150);
    const s = m.activeSlot;
    const target = m.characters[1 - s];
    const before = target.hp;
    m.command(s, { t: 'fire', weapon: 'rocket', angle: aimAt(m, s, 1 - s), power: 1 });
    const events: SimEvent[] = [];
    runUntil(m, () => {
      events.push(...m.takeEvents());
      return m.phase === 'settle';
    });
    const w = weaponById('rocket')!;
    expect(before - target.hp).toBeGreaterThanOrEqual(w.damage); // includes direct-hit bonus
    expect(events.some((e) => e.e === 'carve')).toBe(true);
    expect(events.some((e) => e.e === 'damage' && e.slot === 1 - s)).toBe(true);
    expect(m.characters[s].stats.hits).toBe(1);
  });

  it('consumes limited ammo and enforces cooldowns', () => {
    const m = makeMatch();
    toAim(m);
    const s = m.activeSlot;
    const p = m.characters[s];
    const heavy = weaponById('heavy')!;
    m.command(s, { t: 'fire', weapon: 'heavy', angle: -Math.PI / 2, power: 0.2 });
    expect(p.inventory.heavy).toBe(heavy.ammo - 1);
    // Next own turn: still cooling down.
    runUntil(m, () => m.turnNumber === 3 && m.phase === 'aim', 60);
    expect(m.activeSlot).toBe(s);
    expect(m.command(s, { t: 'weapon', id: 'heavy' })).toEqual({ ok: false, error: 'weapon-unavailable' });
    expect(m.command(s, { t: 'fire', weapon: 'heavy', angle: -1.5, power: 0.2 })).toEqual({ ok: false, error: 'cooldown' });
    expect(p.inventory.rocket).toBe(-1);
  });

  it('grenades bounce and explode on their fuse', () => {
    const m = makeMatch({ settings: { wind: 'off' } });
    toAim(m);
    flatArena(m, 600);
    const s = m.activeSlot;
    m.command(s, { t: 'fire', weapon: 'grenade', angle: -Math.PI / 3, power: 0.4 });
    const events: SimEvent[] = [];
    let t = 0;
    runUntil(m, () => {
      t++;
      events.push(...m.takeEvents());
      return events.some((e) => e.e === 'explode');
    }, 5);
    expect(t / 60).toBeGreaterThan(2.9);
    expect(events.some((e) => e.e === 'bounce')).toBe(true);
  });

  it('cluster bombs split into bomblets', () => {
    const m = makeMatch({ settings: { wind: 'off' } });
    toAim(m);
    flatArena(m, 600);
    const s = m.activeSlot;
    m.command(s, { t: 'fire', weapon: 'cluster', angle: -Math.PI / 2.5, power: 0.5 });
    const ids = new Set<string>();
    runUntil(m, () => {
      for (const e of m.takeEvents()) if (e.e === 'explode') ids.add(e.id);
      return m.phase === 'settle';
    });
    expect(ids.has('cluster')).toBe(true);
    expect(ids.has('bomblet')).toBe(true);
  });

  it('shotgun fires several pellets with limited range', () => {
    const m = makeMatch();
    toAim(m);
    flatArena(m, 120);
    const s = m.activeSlot;
    m.command(s, { t: 'fire', weapon: 'shotgun', angle: -0.3, power: 0.1 });
    expect(m.projectiles.length).toBe(weaponById('shotgun')!.pellets);
  });

  it('air strike drops a column of bombs on the target', () => {
    const m = makeMatch();
    toAim(m);
    flatArena(m, 400);
    const s = m.activeSlot;
    const t = m.characters[1 - s];
    expect(m.command(s, { t: 'fire', weapon: 'airstrike', angle: 0, power: 1, tx: t.x, ty: t.y }).ok).toBe(true);
    expect(m.projectiles.length).toBe(weaponById('airstrike')!.count);
    const hp = t.hp;
    runUntil(m, () => m.phase === 'settle');
    expect(t.hp).toBeLessThan(hp);
  });

  it('mines settle, arm, and trigger on proximity', () => {
    const m = makeMatch({ settings: { wind: 'off' } });
    toAim(m);
    flatArena(m, 700);
    const s = m.activeSlot;
    m.command(s, { t: 'fire', weapon: 'mine', angle: -Math.PI / 2 + (s === 0 ? 0.4 : -0.4), power: 0.35 });
    runUntil(m, () => m.mines.length === 1, 8);
    const mine = m.mines[0];
    runUntil(m, () => mine.armed, 3);
    // Walk the enemy onto it.
    const enemy = m.characters[1 - s];
    enemy.x = mine.x + 20;
    enemy.y = mine.y - C.radius;
    const hp = enemy.hp;
    runUntil(m, () => !mine.alive, 5);
    expect(enemy.hp).toBeLessThan(hp);
  });

  it('explosions set off barrels', () => {
    const m = makeMatch({ mapId: 'canyon', settings: { wind: 'off' } });
    toAim(m);
    flatArena(m, 240);
    const s = m.activeSlot;
    const p = m.characters[s];
    // Place a barrel between the players, closer to the enemy, and shoot it directly.
    const enemy = m.characters[1 - s];
    const bx = enemy.x - Math.sign(enemy.x - p.x) * 45;
    m.barrels.push(new Barrel(999, bx, 900 - 12));
    const hp = enemy.hp;
    m.command(s, { t: 'fire', weapon: 'rocket', angle: Math.atan2(900 - 14 - p.y, bx - p.x), power: 1 });
    const ex: string[] = [];
    runUntil(m, () => {
      for (const e of m.takeEvents()) if (e.e === 'explode') ex.push(e.id);
      return m.phase === 'settle';
    });
    expect(ex).toContain('barrel');
    expect(enemy.hp).toBeLessThan(hp);
  });

  it('teleports to a valid spot', () => {
    const m = makeMatch();
    toAim(m);
    flatArena(m);
    const s = m.activeSlot;
    expect(m.command(s, { t: 'fire', weapon: 'teleport', angle: 0, power: 1, tx: 500, ty: 600 }).ok).toBe(true);
    expect(m.characters[s].x).toBe(500);
    runUntil(m, () => m.characters[s].onGround, 5);
  });
});

describe('deaths and results', () => {
  it('falling in the water eliminates and ends the match', () => {
    const m = makeMatch();
    toAim(m);
    const loser = m.characters[1];
    loser.x = 5;
    loser.y = RULES.world.waterLevel + 20;
    loser.onGround = false;
    runUntil(m, () => m.phase === 'over', 30);
    expect(m.result!.winnerTeam).toBe(0);
    expect(m.result!.players.find((p) => p.slot === 1)!.alive).toBe(false);
  });

  it('forfeit gives the win to the other team', () => {
    const m = makeMatch();
    toAim(m);
    m.forfeit(0);
    expect(m.phase).toBe('over');
    expect(m.result!.winnerTeam).toBe(1);
  });

  it('teams: 2v2 alternates teams and ends when one team is gone', () => {
    const m = makeMatch({
      players: [
        { name: 'A1', species: 'fox', team: 0 },
        { name: 'A2', species: 'cat', team: 0 },
        { name: 'B1', species: 'bear', team: 1 },
        { name: 'B2', species: 'frog', team: 1 },
      ],
    });
    m.start();
    const teams: number[] = [];
    for (let i = 0; i < 4; i++) {
      runUntil(m, () => m.phase === 'aim', 30);
      teams.push(m.active!.team);
      m.command(m.activeSlot, { t: 'skip' });
      runUntil(m, () => m.phase === 'start', 30);
    }
    expect(teams).toEqual([0, 1, 0, 1]);
    m.forfeit(2);
    m.forfeit(3);
    expect(m.result!.winnerTeam).toBe(0);
  });
});

describe('determinism', () => {
  it('same seed + same commands produce identical matches', () => {
    const script = (m: ReturnType<typeof makeMatch>) => {
      m.start();
      const log: string[] = [];
      for (let turn = 0; turn < 6 && m.phase !== 'over'; turn++) {
        runUntil(m, () => m.phase === 'aim' || m.phase === 'over', 60);
        if ((m.phase as string) === 'over') break;
        const s = m.activeSlot;
        const w = WEAPONS[turn % 4];
        m.command(s, { t: 'input', move: 1, up: false, down: false });
        for (let i = 0; i < 40; i++) m.step();
        m.command(s, { t: 'fire', weapon: w.id, angle: -0.6 - turn * 0.3, power: 0.7 });
        runUntil(m, () => m.phase === 'start' || m.phase === 'over', 60);
        log.push(JSON.stringify(m.snapshot()));
      }
      return log;
    };
    const a = script(makeMatch({ seed: 555 }));
    const b = script(makeMatch({ seed: 555 }));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
  });
});
