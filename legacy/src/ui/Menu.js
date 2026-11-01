import { SPECIES, MAPS, TEAM_COLORS } from '../game/config.js';
import { speciesById } from '../rendering/Sprites.js';
import { animatePreviews } from './previews.js';
import { save } from './storage.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/** Main menu, match setup, character selection and settings screens. */
export class Menu {
  constructor(root, app, { audio, onStart }) {
    this.root = root;
    this.app = app;
    this.audio = audio;
    this.onStart = onStart;
    this.stop = () => {};
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      this.audio.play('click');
      this.handle(el.dataset.action, el.dataset);
    });
    root.addEventListener('input', (e) => {
      const slot = e.target.dataset.slot;
      if (slot == null) return;
      this.app.roster[slot].name = e.target.value.slice(0, 12);
      save('roster', this.app.roster);
    });
  }

  show(screen = 'main') {
    this.screen = screen;
    this.root.classList.add('visible');
    this.render();
  }

  hide() {
    this.stop();
    this.root.classList.remove('visible');
    this.root.innerHTML = '';
  }

  render() {
    this.stop();
    const html = { main: () => this.mainHtml(), play: () => this.playHtml(), characters: () => this.charactersHtml(), settings: () => this.settingsHtml() };
    this.root.innerHTML = `<div class="menu-bg"><div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div><div class="menu-hills"></div></div>${html[this.screen]()}`;
    this.stop = animatePreviews(this.root);
  }

  handle(action, d) {
    const app = this.app;
    switch (action) {
      case 'go':
        this.show(d.to);
        break;
      case 'set': {
        app[d.group][d.key] = parseValue(d.value);
        save(d.group, app[d.group]);
        if (d.key === 'sound') this.audio.enabled = app.settings.sound;
        this.render();
        break;
      }
      case 'species': {
        const r = app.roster[d.slot];
        const i = SPECIES.findIndex((s) => s.id === r.species);
        r.species = SPECIES[(i + Number(d.dir) + SPECIES.length) % SPECIES.length].id;
        save('roster', app.roster);
        this.render();
        break;
      }
      case 'start':
        this.onStart();
        break;
    }
  }

  seg(group, key, options) {
    const cur = this.app[group][key];
    return `<div class="seg">${options
      .map(([v, label]) => `<button class="seg-btn ${String(v) === String(cur) ? 'active' : ''}" data-action="set" data-group="${group}" data-key="${key}" data-value="${v}">${label}</button>`)
      .join('')}</div>`;
  }

  mainHtml() {
    const logo = 'WILDLINGS'.split('').map((c, i) => `<span style="--i:${i}">${c}</span>`).join('');
    const parade = this.app.roster
      .map((r, i) => `<canvas class="parade-critter" data-species="${r.species}" data-color="${TEAM_COLORS[i]}" data-hop="1" data-scale="2.2" data-facing="${i < 2 ? 1 : -1}"></canvas>`)
      .join('');
    return `
      <div class="screen screen-main">
        <h1 class="logo">${logo}</h1>
        <p class="tagline">Turn-based critter artillery chaos</p>
        <div class="parade">${parade}</div>
        <div class="menu-buttons">
          <button class="btn btn-big btn-primary" data-action="go" data-to="play">Play</button>
          <button class="btn btn-big" data-action="go" data-to="characters">Characters</button>
          <button class="btn btn-big" data-action="go" data-to="settings">Settings</button>
        </div>
        <div class="controls-hint">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
          <span><kbd>Space</kbd> jump</span>
          <span><kbd>Mouse</kbd> aim</span>
          <span><kbd>Click</kbd> fire</span>
          <span><kbd>Wheel</kbd> weapons</span>
        </div>
      </div>`;
  }

  playHtml() {
    const { setup, roster } = this.app;
    const maps = [...MAPS, { id: 'random', name: 'Random' }]
      .map((m) => {
        const style = m.sky ? `--sky1:${m.sky[0]};--sky2:${m.sky[1]};--ground:${m.ground.top};--dirt:${m.ground.dirt};--water:${m.water}` : '';
        return `<button class="map-card ${setup.mapId === m.id ? 'active' : ''} ${m.sky ? '' : 'random'}" data-action="set" data-group="setup" data-key="mapId" data-value="${m.id}" style="${style}"><span class="map-thumb">${m.sky ? '' : '?'}</span><span class="map-name">${m.name}</span></button>`;
      })
      .join('');
    const lineup = Array.from({ length: setup.count }, (_, i) => {
      const r = roster[i];
      const tag = setup.mode === 'bots' ? (i === 0 ? 'You' : `Bot · ${setup.difficulty}`) : `Player ${i + 1}`;
      return `<div class="lineup-card" style="--team:${TEAM_COLORS[i]}"><canvas data-species="${r.species}" data-color="${TEAM_COLORS[i]}" data-scale="1.6"></canvas><b>${esc(r.name || `Player ${i + 1}`)}</b><small>${tag}</small></div>`;
    }).join('');
    return `
      <div class="screen panel">
        <h2>Match Setup</h2>
        <div class="field"><label>Mode</label>${this.seg('setup', 'mode', [
          ['bots', 'Vs Bots'],
          ['local', 'Local Multiplayer'],
        ])}</div>
        <div class="field"><label>Players</label>${this.seg('setup', 'count', [
          [2, '2'],
          [3, '3'],
          [4, '4'],
        ])}</div>
        ${
          setup.mode === 'bots'
            ? `<div class="field"><label>Bot skill</label>${this.seg('setup', 'difficulty', [
                ['easy', 'Easy'],
                ['normal', 'Normal'],
                ['hard', 'Hard'],
              ])}</div>`
            : ''
        }
        <div class="field field-col"><label>Battlefield</label><div class="map-grid">${maps}</div></div>
        <div class="lineup">${lineup}</div>
        <div class="panel-actions">
          <button class="btn" data-action="go" data-to="main">Back</button>
          <button class="btn" data-action="go" data-to="characters">Edit Critters</button>
          <button class="btn btn-primary" data-action="start">Start Battle!</button>
        </div>
      </div>`;
  }

  charactersHtml() {
    const cards = this.app.roster
      .map(
        (r, i) => `
        <div class="char-card" style="--team:${TEAM_COLORS[i]}">
          <div class="char-slot">Player ${i + 1}</div>
          <canvas data-species="${r.species}" data-color="${TEAM_COLORS[i]}" data-scale="2.6" data-weapon="rocket"></canvas>
          <div class="species-picker">
            <button class="btn btn-round" data-action="species" data-slot="${i}" data-dir="-1" aria-label="Previous species">◀</button>
            <span>${speciesById(r.species).name}</span>
            <button class="btn btn-round" data-action="species" data-slot="${i}" data-dir="1" aria-label="Next species">▶</button>
          </div>
          <input class="name-input" data-slot="${i}" maxlength="12" value="${esc(r.name)}" aria-label="Player ${i + 1} name" />
        </div>`,
      )
      .join('');
    return `
      <div class="screen panel panel-wide">
        <h2>Choose Your Critters</h2>
        <p class="panel-sub">Slot 1 is you in bot matches. In local multiplayer, each slot is a player.</p>
        <div class="char-grid">${cards}</div>
        <div class="panel-actions">
          <button class="btn" data-action="go" data-to="main">Main Menu</button>
          <button class="btn btn-primary" data-action="go" data-to="play">Play</button>
        </div>
      </div>`;
  }

  settingsHtml() {
    return `
      <div class="screen panel">
        <h2>Settings</h2>
        <div class="field"><label>Turn timer</label>${this.seg('settings', 'turnTime', [
          [15, '15s'],
          [30, '30s'],
          [45, '45s'],
          [60, '60s'],
          [0, '∞'],
        ])}</div>
        <div class="field"><label>Wind</label>${this.seg('settings', 'wind', [
          ['off', 'Off'],
          ['low', 'Low'],
          ['normal', 'Normal'],
          ['high', 'High'],
        ])}</div>
        <div class="field"><label>Starting HP</label>${this.seg('settings', 'startHP', [
          [75, '75'],
          [100, '100'],
          [150, '150'],
          [200, '200'],
        ])}</div>
        <div class="field"><label>Aim guide</label>${this.seg('settings', 'aimGuide', [
          [true, 'On'],
          [false, 'Off'],
        ])}</div>
        <div class="field"><label>Screen shake</label>${this.seg('settings', 'screenShake', [
          [true, 'On'],
          [false, 'Off'],
        ])}</div>
        <div class="field"><label>Sound</label>${this.seg('settings', 'sound', [
          [true, 'On'],
          [false, 'Off'],
        ])}</div>
        <div class="panel-actions">
          <button class="btn btn-primary" data-action="go" data-to="main">Done</button>
        </div>
      </div>`;
  }
}
