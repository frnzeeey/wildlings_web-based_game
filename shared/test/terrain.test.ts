import { describe, it, expect } from 'vitest';
import { generateTerrain } from '../src/sim/terrain-gen.ts';
import { TerrainMask, encodeTerrain, decodeTerrain, encodeRLE, decodeRLE, ROCK, WOOD, AIR } from '../src/sim/terrain.ts';
import { MAPS, RULES } from '../src/spec.ts';
import { makeMatch } from './helpers.ts';

const W = RULES.world;

describe('terrain generation', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = generateTerrain(MAPS[0], 42, W.width, W.height, W.waterLevel);
    const b = generateTerrain(MAPS[0], 42, W.width, W.height, W.waterLevel);
    const c = generateTerrain(MAPS[0], 43, W.width, W.height, W.waterLevel);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false);
  });

  it.each(MAPS.map((m) => m.id))('map %s spawns everyone on dry ground', (mapId) => {
    for (const seed of [1, 7, 99, 2024]) {
      const m = makeMatch({ mapId, seed });
      for (const ch of m.characters) {
        expect(ch.onGround).toBe(true);
        expect(ch.y).toBeLessThan(W.waterLevel - 30);
      }
      // Opposite sides of the battlefield.
      expect(Math.sign(m.characters[0].x - W.width / 2)).not.toBe(Math.sign(m.characters[1].x - W.width / 2));
    }
  });

  it('builds the structures each map asks for', () => {
    const canyon = generateTerrain(MAPS.find((m) => m.id === 'canyon')!, 5, W.width, W.height, W.waterLevel);
    expect(canyon.data.includes(ROCK)).toBe(true);
    const jungle = generateTerrain(MAPS.find((m) => m.id === 'jungle')!, 5, W.width, W.height, W.waterLevel);
    expect(jungle.data.includes(WOOD)).toBe(true);
  });
});

describe('terrain mask', () => {
  it('carves a disc and records the dirty rect', () => {
    const t = new TerrainMask(100, 100);
    t.data.fill(1);
    t.carve(50, 50, 10);
    expect(t.isSolid(50, 50)).toBe(false);
    expect(t.isSolid(50, 39)).toBe(true);
    expect(t.takeDirty()).toEqual({ x0: 40, y0: 40, x1: 60, y1: 60 });
    expect(t.takeDirty()).toBeNull();
  });

  it('rock resists the outer part of a blast', () => {
    const t = new TerrainMask(100, 100);
    t.data.fill(ROCK);
    t.carve(50, 50, 20);
    expect(t.material(50, 50)).toBe(AIR);
    expect(t.material(50, 50 + 16)).toBe(ROCK); // 16 > 20 * 0.6
  });

  it('round-trips through RLE + base64 exactly', () => {
    const t = generateTerrain(MAPS[2], 77, W.width, W.height, W.waterLevel);
    t.carve(1000, 800, 60);
    const payload = encodeTerrain(t);
    const back = decodeTerrain(payload);
    expect(Buffer.from(back.data).equals(Buffer.from(t.data))).toBe(true);
    expect(Array.from(back.surface)).toEqual(Array.from(t.surface));
    expect(payload.rle.length).toBeLessThan(80_000);
  });

  it('RLE handles long runs and single bytes', () => {
    const d = new Uint8Array(70000);
    d[5] = 3;
    d[69999] = 2;
    expect(Array.from(decodeRLE(encodeRLE(d), d.length))).toEqual(Array.from(d));
  });
});
