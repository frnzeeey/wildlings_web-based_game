// Writes cross-engine fixtures computed by the TypeScript reference sim, so the Godot port can be
// checked against it: RNG sequences, terrain hashes, damage/launch maths and a terrain payload.
// Run: node tools/gen-fixtures.mjs   (writes godot/tests/fixtures.json)
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RNG, MAPS, RULES, generateTerrain, damageAt, launchParams, weaponById, encodeTerrain } from '../shared/src/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = RULES.world;
const sha = (d) => createHash('sha256').update(d).digest('hex').slice(0, 16);

const rng = {};
for (const seed of [0, 1, 1234, 0xdeadbeef]) {
  const r = new RNG(seed);
  rng[seed] = Array.from({ length: 8 }, () => r.next());
}

const terrain = [];
for (const map of MAPS) {
  for (const seed of [7, 4242]) {
    const t = generateTerrain(map, seed, W.width, W.height, W.waterLevel);
    terrain.push({ map: map.id, seed, sum: sha(t.data), surface: Array.from(t.surface.slice(0, 2600)).filter((_, i) => i % 260 === 0) });
  }
}

const rocket = weaponById('rocket');
const damage = [0, 10, 20, 40, 60, 80].map((d) => ({ dist: d, rocket: damageAt(d, rocket), heavy: damageAt(d, weaponById('heavy')) }));
const launch = [[-0.7, 0.5], [-2.4, 1], [0.3, 0.1]].map(([a, p]) => ({ angle: a, power: p, ...launchParams(500, 600, a, p, rocket) }));

const t = generateTerrain(MAPS[0], 99, W.width, W.height, W.waterLevel);
t.carve(1200, 700, 60);
t.carve(1300.25, 650.5, 33.33);
const payload = { ...encodeTerrain(t), sum: sha(t.data) };

writeFileSync(join(root, 'godot/tests/fixtures.json'), JSON.stringify({ rng, terrain, damage, launch, payload }));
console.log('gen-fixtures: godot/tests/fixtures.json');
