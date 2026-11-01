// Synthesises every sound effect (and a short music loop) as 16-bit mono WAV files, so both
// clients play identical audio with no third-party assets. Recipes follow legacy/src/game/Audio.js.
// Run: node tools/gen-sfx.mjs   (writes shared/assets/sfx/*.wav)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'shared/assets/sfx');
mkdirSync(out, { recursive: true });

const RATE = 22050;
let seed = 12345;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function buffer(seconds) {
  return new Float32Array(Math.ceil(seconds * RATE));
}

function osc(type, phase) {
  const p = phase - Math.floor(phase);
  switch (type) {
    case 'square': return p < 0.5 ? 1 : -1;
    case 'sawtooth': return 2 * p - 1;
    case 'triangle': return 1 - 4 * Math.abs(p - 0.5);
    default: return Math.sin(p * Math.PI * 2);
  }
}

/** Oscillator with exponential pitch slide and exponential decay (like the WebAudio originals). */
function tone(buf, freq, dur, { type = 'sine', vol = 0.4, slide = null, delay = 0, attack = 0.004 } = {}) {
  const start = Math.floor(delay * RATE);
  const n = Math.floor(dur * RATE);
  let phase = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / n;
    const f = slide ? freq * Math.pow(slide / freq, t) : freq;
    phase += f / RATE;
    const env = vol * Math.pow(0.001 / vol, t) * Math.min(1, i / (attack * RATE));
    buf[start + i] += osc(type, phase) * env;
  }
}

/** Filtered noise burst. `type` lowpass | bandpass, cutoff sweeps exponentially to `slide`. */
function noise(buf, dur, { vol = 0.5, freq = 1200, slide = null, type = 'lowpass', delay = 0 } = {}) {
  const start = Math.floor(delay * RATE);
  const n = Math.floor(dur * RATE);
  let lp = 0;
  let bp1 = 0;
  let bp2 = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / n;
    const fc = slide ? freq * Math.pow(slide / freq, t) : freq;
    const a = Math.min(1, (2 * Math.PI * fc) / RATE);
    const x = rand() * 2 - 1;
    let y;
    if (type === 'bandpass') {
      bp1 += a * (x - bp1);
      bp2 += a * 0.5 * (bp1 - bp2);
      y = (bp1 - bp2) * 2.2;
    } else {
      lp += a * (x - lp);
      y = lp;
    }
    const env = vol * Math.pow(0.001 / vol, t) * Math.min(1, i / (0.003 * RATE));
    buf[start + i] += y * env;
  }
}

function writeWav(name, buf, gain = 0.85) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? gain / peak : 0;
  const data = Buffer.alloc(44 + buf.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + buf.length * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24);
  data.writeUInt32LE(RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * k * 32767))), 44 + i * 2);
  writeFileSync(join(out, `${name}.wav`), data);
}

const SFX = {
  fire: [0.35, (b) => { noise(b, 0.3, { vol: 0.5, freq: 1400, slide: 300 }); tone(b, 220, 0.2, { type: 'square', vol: 0.12, slide: 70 }); }, 0.6],
  heavy: [0.5, (b) => { noise(b, 0.45, { vol: 0.6, freq: 900, slide: 150 }); tone(b, 140, 0.35, { type: 'square', vol: 0.18, slide: 45 }); }, 0.7],
  shotgun: [0.3, (b) => noise(b, 0.25, { vol: 0.8, freq: 2400, slide: 400, type: 'bandpass' }), 0.7],
  throw: [0.2, (b) => noise(b, 0.15, { vol: 0.3, freq: 2000, type: 'bandpass' }), 0.45],
  boom: [0.8, (b) => { noise(b, 0.7, { vol: 0.9, freq: 900, slide: 80 }); tone(b, 110, 0.5, { vol: 0.6, slide: 35 }); }, 0.9],
  bigboom: [1.4, (b) => { noise(b, 1.3, { vol: 1, freq: 600, slide: 40 }); tone(b, 80, 1.1, { vol: 0.8, slide: 22 }); }, 0.95],
  smallboom: [0.45, (b) => { noise(b, 0.4, { vol: 0.8, freq: 1400, slide: 150 }); tone(b, 160, 0.3, { vol: 0.4, slide: 60 }); }, 0.7],
  bounce: [0.1, (b) => tone(b, 320, 0.08, { type: 'triangle', vol: 0.25, slide: 180 }), 0.4],
  jump: [0.16, (b) => tone(b, 320, 0.14, { type: 'square', vol: 0.08, slide: 640 }), 0.3],
  land: [0.15, (b) => noise(b, 0.12, { vol: 0.4, freq: 500, slide: 120 }), 0.4],
  hurt: [0.22, (b) => tone(b, 520, 0.2, { type: 'sawtooth', vol: 0.1, slide: 240 }), 0.45],
  splash: [0.65, (b) => noise(b, 0.6, { vol: 0.5, freq: 1800, slide: 500, type: 'bandpass' }), 0.6],
  sizzle: [0.9, (b) => { noise(b, 0.85, { vol: 0.5, freq: 3000, slide: 900, type: 'bandpass' }); tone(b, 180, 0.4, { type: 'sawtooth', vol: 0.06, slide: 60 }); }, 0.6],
  turn: [0.3, (b) => { tone(b, 660, 0.1, { type: 'triangle', vol: 0.25 }); tone(b, 880, 0.16, { type: 'triangle', vol: 0.25, delay: 0.1 }); }, 0.45],
  click: [0.06, (b) => tone(b, 900, 0.05, { type: 'square', vol: 0.06 }), 0.25],
  tick: [0.06, (b) => tone(b, 1250, 0.05, { type: 'square', vol: 0.08 }), 0.3],
  error: [0.2, (b) => tone(b, 160, 0.18, { type: 'square', vol: 0.12 }), 0.35],
  teleport: [0.4, (b) => tone(b, 400, 0.35, { vol: 0.25, slide: 1800 }), 0.5],
  airstrike: [1.0, (b) => { tone(b, 900, 0.9, { type: 'sawtooth', vol: 0.08, slide: 120 }); noise(b, 0.9, { vol: 0.15, freq: 400 }); }, 0.5],
  mine: [0.25, (b) => { tone(b, 1400, 0.08, { type: 'square', vol: 0.1 }); tone(b, 1400, 0.08, { type: 'square', vol: 0.1, delay: 0.14 }); }, 0.35],
  beep: [0.1, (b) => tone(b, 1800, 0.08, { type: 'square', vol: 0.1 }), 0.3],
  ko: [0.55, (b) => tone(b, 500, 0.5, { type: 'triangle', vol: 0.25, slide: 120 }), 0.5],
  win: [0.9, (b) => [523, 659, 784, 1047].forEach((fq, i) => tone(b, fq, 0.3, { type: 'triangle', vol: 0.25, delay: i * 0.12 })), 0.55],
  lose: [0.9, (b) => [440, 392, 330, 262].forEach((fq, i) => tone(b, fq, 0.3, { type: 'triangle', vol: 0.2, delay: i * 0.14 })), 0.5],
  water: [1.2, (b) => { noise(b, 1.1, { vol: 0.4, freq: 600, slide: 200 }); tone(b, 90, 1.0, { vol: 0.3, slide: 60 }); }, 0.5],
  ui: [0.08, (b) => tone(b, 700, 0.07, { type: 'triangle', vol: 0.15, slide: 900 }), 0.3],
};

for (const [name, [dur, fn, gain]] of Object.entries(SFX)) {
  const b = buffer(dur);
  fn(b);
  writeWav(name, b, gain);
}

// ---------------------------------------------------------------- music: a bouncy 8-bar loop
{
  const bpm = 112;
  const beat = 60 / bpm;
  const bars = 8;
  const b = buffer(bars * 4 * beat);
  const chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14], [7, 11, 14]];
  const root = 196; // G3
  const hz = (semi) => root * Math.pow(2, semi / 12);
  const melody = [7, 9, 11, 12, 11, 9, 7, 4, 5, 7, 9, 12, 14, 12, 11, 9, 12, 11, 9, 7, 9, 7, 4, 2, 4, 5, 7, 9, 11, 9, 7, 7];
  for (let bar = 0; bar < bars; bar++) {
    const ch = chords[bar];
    const t0 = bar * 4 * beat;
    for (let k = 0; k < 4; k++) {
      tone(b, hz(ch[0] - 12), beat * 0.9, { type: 'triangle', vol: 0.22, delay: t0 + k * beat });
      for (const n of ch) tone(b, hz(n), beat * 0.4, { type: 'square', vol: 0.025, delay: t0 + k * beat + beat * 0.5 });
      noise(b, 0.05, { vol: 0.08, freq: 6000, type: 'bandpass', delay: t0 + k * beat + beat * 0.5 });
      if (k % 2 === 0) tone(b, 70, 0.12, { vol: 0.3, slide: 40, delay: t0 + k * beat });
    }
    for (let k = 0; k < 4; k++) {
      const n = melody[(bar * 4 + k) % melody.length];
      tone(b, hz(n + 12), beat * 0.8, { type: 'triangle', vol: 0.09, delay: t0 + k * beat });
    }
  }
  writeWav('music', b, 0.5);
}

console.log(`gen-sfx: ${Object.keys(SFX).length + 1} files -> ${out}`);
