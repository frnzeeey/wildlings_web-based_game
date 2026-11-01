// Runs the Godot headless test suite (godot/tests/test_runner.tscn) and exits with its code.
// Imports the project first, as a fresh checkout has no .godot/ cache.
// Usage: node tools/run-godot-tests.mjs   (env GODOT=path/to/godot_console)
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GODOT = process.env.GODOT ?? 'D:/Godot_v4.7.2-stable_win64.exe/Godot_v4.7.2-stable_win64_console.exe';
const path = join(root, 'godot');

spawnSync(process.execPath, [join(root, 'tools/sync-godot.mjs')], { stdio: 'inherit' });
spawnSync(GODOT, ['--headless', '--path', path, '--import'], { stdio: 'ignore', timeout: 300000 });
const r = spawnSync(GODOT, ['--headless', '--path', path, 'res://tests/test_runner.tscn'], { encoding: 'utf8', timeout: 900000 });
const out = `${r.stdout}\n${r.stderr}`;
for (const line of out.split(/\r?\n/)) {
  if (/^\s+(test_|FAIL|\d+\/\d+|hard bot|finished)|^Results:|SCRIPT ERROR/.test(line)) console.log(line);
}
process.exit(r.status ?? 1);
