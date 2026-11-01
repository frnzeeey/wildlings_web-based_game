// Copies the shared game spec and generated assets into the Godot project, byte for byte.
//   node tools/sync-godot.mjs          copy
//   node tools/sync-godot.mjs --check  fail (exit 1) if the Godot copy differs from shared/
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pairs = [
  ['shared/spec', 'godot/data', (f) => f.endsWith('.json')],
  ['shared/assets/art', 'godot/assets/art', (f) => f.endsWith('.svg') || f.endsWith('.json')],
  ['shared/assets/sfx', 'godot/assets/sfx', (f) => f.endsWith('.wav')],
  ['shared/assets/fonts', 'godot/assets/fonts', (f) => f.endsWith('.ttf') || f.endsWith('.txt')],
];
const check = process.argv.includes('--check');
let problems = 0;
let copied = 0;

for (const [from, to, keep] of pairs) {
  const src = join(root, from);
  const dst = join(root, to);
  if (!existsSync(src)) {
    console.error(`missing ${from} (run npm run assets)`);
    problems++;
    continue;
  }
  const files = readdirSync(src).filter(keep);
  if (!check) mkdirSync(dst, { recursive: true });
  for (const f of files) {
    const a = readFileSync(join(src, f));
    const target = join(dst, f);
    const same = existsSync(target) && readFileSync(target).equals(a);
    if (check) {
      if (!same) {
        console.error(`out of sync: ${to}/${f}`);
        problems++;
      }
    } else if (!same) {
      writeFileSync(target, a);
      copied++;
    }
  }
  // Remove files that no longer exist in shared/ (keeps Godot's .import sidecars of live files).
  if (existsSync(dst)) {
    for (const f of readdirSync(dst).filter(keep)) {
      if (!files.includes(f)) {
        if (check) {
          console.error(`stale file: ${to}/${f}`);
          problems++;
        } else {
          rmSync(join(dst, f));
          if (existsSync(join(dst, `${f}.import`))) rmSync(join(dst, `${f}.import`));
        }
      }
    }
  }
}

// SVGs are read raw at runtime (rasterised at 3x by game/art.gd): ship them as-is, don't import.
if (!check) {
  const dir = join(root, 'godot/assets/art');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.svg'))) {
    const imp = join(dir, `${f}.import`);
    const want = '[remap]\n\nimporter="keep"\n';
    if (!existsSync(imp) || readFileSync(imp, 'utf8') !== want) writeFileSync(imp, want);
  }
}

if (check) {
  if (problems) {
    console.error(`\n${problems} file(s) differ. Run: npm run sync:godot`);
    process.exit(1);
  }
  console.log('godot copy of shared spec + assets is in sync');
} else console.log(`sync-godot: ${copied} file(s) updated`);
