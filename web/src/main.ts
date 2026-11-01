import Phaser from 'phaser';
import './styles.css';
import './theme.css';
import { BootScene } from './game/BootScene.ts';
import { BattleScene } from './game/BattleScene.ts';
import { art } from './game/art.ts';
import { App } from './ui/App.ts';

async function boot(): Promise<void> {
  const menu = document.getElementById('menu')!;
  menu.classList.add('visible');
  menu.innerHTML = `<div class="boot"><img alt="Wildlings" src="art/logo.svg"><div class="boot-bar"><i id="boot-progress"></i></div></div>`;
  await art.loadManifest();

  let app: App | null = null;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1b2440',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    render: { antialias: true },
    audio: { disableWebAudio: false },
    scene: [new BootScene(() => (app = new App(game))), BattleScene],
  });
  (window as unknown as { wildlings: unknown }).wildlings = { game, get app() { return app; } };
}

boot();
