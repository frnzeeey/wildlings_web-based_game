import './styles/main.css';
import { Game } from './game/Game.js';
import { Input } from './game/Input.js';
import { GameAudio } from './game/Audio.js';
import { DEFAULT_SETTINGS, DEFAULT_ROSTER, DEFAULT_SETUP, TEAM_COLORS } from './game/config.js';
import { Menu } from './ui/Menu.js';
import { HUD } from './ui/HUD.js';
import { GameOver } from './ui/GameOver.js';
import { load } from './ui/storage.js';

const canvas = document.getElementById('game');
const app = {
  settings: load('settings', DEFAULT_SETTINGS),
  roster: load('roster', DEFAULT_ROSTER),
  setup: load('setup', DEFAULT_SETUP),
  game: null,
  lastMatch: null,
};

const audio = new GameAudio();
audio.enabled = app.settings.sound;
const input = new Input(canvas);
const hud = new HUD(document.getElementById('hud'), { onPause: () => setPaused(true) });
const modal = new GameOver(document.getElementById('modal'), {
  onRematch: () => startMatch(app.lastMatch),
  onMenu: backToMenu,
  onResume: () => setPaused(false),
});
const menu = new Menu(document.getElementById('menu'), app, { audio, onStart: () => startMatch(buildMatch()) });

function buildMatch() {
  const { mode, count, difficulty, mapId } = app.setup;
  return {
    mapId,
    players: Array.from({ length: count }, (_, i) => ({
      name: app.roster[i].name.trim() || `Player ${i + 1}`,
      species: app.roster[i].species,
      color: TEAM_COLORS[i],
      ai: mode === 'bots' && i > 0 ? difficulty : null,
    })),
  };
}

function stopGame() {
  if (app.game) app.game.destroy();
  app.game = null;
}

function startMatch(match) {
  stopGame();
  modal.hide();
  menu.hide();
  app.lastMatch = match;
  app.game = new Game({
    canvas,
    input,
    audio,
    hud,
    settings: { ...app.settings },
    match,
    onGameOver: (results) => modal.show(results),
  });
  app.game.start();
}

function backToMenu() {
  stopGame();
  modal.hide();
  menu.show('main');
}

function setPaused(paused) {
  const g = app.game;
  if (!g || g.over) return;
  g.paused = paused;
  if (paused) modal.showPause();
  else modal.hide();
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && app.game && !app.game.over) setPaused(!app.game.paused);
});
// Browsers only allow audio after a user gesture.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

menu.show('main');
