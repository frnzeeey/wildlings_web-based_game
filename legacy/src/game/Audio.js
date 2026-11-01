/** Tiny synthesized sound effects via WebAudio, so the game ships with no audio files. */
export class GameAudio {
  constructor() {
    this.enabled = true;
    this.ac = null;
  }

  unlock() {
    if (this.ac) {
      if (this.ac.state === 'suspended') this.ac.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ac = null;
    }
  }

  tone(freq, dur, { type = 'sine', vol = 0.4, slide = null, delay = 0 } = {}) {
    const ac = this.ac;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise(dur, { vol = 0.5, freq = 1200, slide = null, type = 'lowpass', delay = 0 } = {}) {
    const ac = this.ac;
    const t0 = ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  play(name) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ac) return;
    switch (name) {
      case 'fire':
        this.noise(0.3, { vol: 0.5, freq: 1400, slide: 300 });
        this.tone(220, 0.2, { type: 'square', vol: 0.12, slide: 70 });
        break;
      case 'shotgun':
        this.noise(0.25, { vol: 0.8, freq: 2400, slide: 400, type: 'bandpass' });
        break;
      case 'throw':
        this.noise(0.15, { vol: 0.3, freq: 2000, type: 'bandpass' });
        break;
      case 'boom':
        this.noise(0.7, { vol: 0.9, freq: 900, slide: 80 });
        this.tone(110, 0.5, { vol: 0.6, slide: 35 });
        break;
      case 'bigboom':
        this.noise(1.3, { vol: 1, freq: 600, slide: 40 });
        this.tone(80, 1.1, { vol: 0.8, slide: 22 });
        break;
      case 'bounce':
        this.tone(320, 0.08, { type: 'triangle', vol: 0.25, slide: 180 });
        break;
      case 'jump':
        this.tone(320, 0.14, { type: 'square', vol: 0.08, slide: 640 });
        break;
      case 'hurt':
        this.tone(520, 0.2, { type: 'sawtooth', vol: 0.1, slide: 240 });
        break;
      case 'splash':
        this.noise(0.6, { vol: 0.5, freq: 1800, slide: 500, type: 'bandpass' });
        break;
      case 'turn':
        this.tone(660, 0.1, { type: 'triangle', vol: 0.25 });
        this.tone(880, 0.16, { type: 'triangle', vol: 0.25, delay: 0.1 });
        break;
      case 'click':
        this.tone(900, 0.05, { type: 'square', vol: 0.06 });
        break;
      case 'tick':
        this.tone(1250, 0.05, { type: 'square', vol: 0.08 });
        break;
      case 'error':
        this.tone(160, 0.18, { type: 'square', vol: 0.12 });
        break;
      case 'teleport':
        this.tone(400, 0.35, { vol: 0.25, slide: 1800 });
        break;
      case 'meteor':
        this.tone(900, 0.9, { type: 'sawtooth', vol: 0.08, slide: 120 });
        break;
      case 'ko':
        this.tone(500, 0.5, { type: 'triangle', vol: 0.25, slide: 120 });
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.25, delay: i * 0.12 }));
        break;
    }
  }
}
