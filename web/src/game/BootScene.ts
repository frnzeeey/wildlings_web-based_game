import Phaser from 'phaser';
import { art } from './art.ts';
import { audio } from './audio.ts';

/** Loads the shared SVG art and WAV audio, then hands control to the app. */
export class BootScene extends Phaser.Scene {
  private onReady: () => void;

  constructor(onReady: () => void) {
    super('boot');
    this.onReady = onReady;
  }

  preload(): void {
    const bar = document.querySelector<HTMLElement>('#boot-progress');
    this.load.on('progress', (v: number) => bar && (bar.style.width = `${Math.round(v * 100)}%`));
    art.preload(this.load);
    audio.preload(this.load);
  }

  create(): void {
    audio.attach(this.sound);
    this.onReady();
  }
}
