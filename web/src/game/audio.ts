import Phaser from 'phaser';

export const SFX = [
  'fire', 'heavy', 'shotgun', 'throw', 'boom', 'bigboom', 'smallboom', 'bounce', 'jump', 'land', 'hurt', 'splash', 'sizzle',
  'turn', 'click', 'tick', 'error', 'teleport', 'airstrike', 'mine', 'beep', 'ko', 'win', 'lose', 'water', 'ui',
] as const;
export type SfxName = (typeof SFX)[number];

/** Thin wrapper over Phaser's sound manager with volume settings and per-sound rate limiting. */
class Audio {
  private sound: Phaser.Sound.BaseSoundManager | null = null;
  private last = new Map<string, number>();
  private music: Phaser.Sound.BaseSound | null = null;
  sfxVolume = 0.7;
  musicVolume = 0.35;

  preload(load: Phaser.Loader.LoaderPlugin): void {
    for (const s of SFX) load.audio(`sfx_${s}`, `sfx/${s}.wav`);
    load.audio('music', 'sfx/music.wav');
  }

  attach(sound: Phaser.Sound.BaseSoundManager): void {
    this.sound = sound;
  }

  play(name: SfxName, volume = 1, detune = 0): void {
    if (!this.sound || this.sfxVolume <= 0) return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? 0) < 40) return;
    this.last.set(name, now);
    this.sound.play(`sfx_${name}`, { volume: this.sfxVolume * volume, detune: detune + (Math.random() - 0.5) * 120 });
  }

  startMusic(): void {
    if (!this.sound) return;
    if (!this.music) this.music = this.sound.add('music', { loop: true, volume: this.musicVolume });
    if (!this.music.isPlaying) this.music.play();
    this.setMusicVolume(this.musicVolume);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    const m = this.music as (Phaser.Sound.BaseSound & { setVolume?: (v: number) => void }) | null;
    m?.setVolume?.(v);
  }
}

export const audio = new Audio();
