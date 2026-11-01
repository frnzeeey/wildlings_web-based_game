import type Phaser from 'phaser';
import {
  CHARACTERS, MAPS, RULES, TEAM_COLORS, WEAPONS, characterById, mapById, sanitizeName,
  type MatchPlayerConfig, type MatchResult, type MatchStartMsg, type RoomMember, type ServerMsg,
} from '@wildlings/shared';
import { LocalSession } from '../game/LocalSession.ts';
import { NetSession } from '../game/NetSession.ts';
import type { BattleData, BattleScene } from '../game/BattleScene.ts';
import type { Session } from '../game/view.ts';
import { audio } from '../game/audio.ts';
import { art } from '../game/art.ts';
import { NetClient, serverUrl, type NetState } from '../net/NetClient.ts';
import { DEFAULT_ROSTER, DEFAULT_SETTINGS, DEFAULT_SETUP, load, save, type ClientSettings, type Roster, type Setup } from '../settings.ts';
import { Hud } from './Hud.ts';
import { critterHtml } from './preview.ts';
import { esc, parseValue, seg } from './dom.ts';

/** Menu scenery: the Grasslands parallax layers and drifting clouds (shared art). */
const MENU_BG = `<div class="menu-bg">${[0, 1, 2].map((i) => `<img class="bg-cloud" alt="" src="art/cloud.svg" style="top:${8 + i * 9}%;animation-duration:${80 + i * 30}s;animation-delay:-${i * 35}s;width:${200 - i * 40}px">`).join('')}${['far', 'mid', 'near'].map((l, i) => `<img class="bg-layer l${i + 1}" alt="" src="art/bg_grasslands_${l}.svg">`).join('')}</div>`;

type Screen = 'main' | 'mode' | 'bots' | 'local' | 'characters' | 'settings' | 'howto' | 'online' | 'queue' | 'room';

interface RoomState {
  code: string;
  quick: boolean;
  state: 'lobby' | 'playing' | 'results';
  mapId: string;
  settings: ClientSettings;
  members: RoomMember[];
  rematch: string[];
}

/** Menus, screens and the match lifecycle. DOM UI over the Phaser canvas. */
export class App {
  private game: Phaser.Game;
  private menu = document.getElementById('menu')!;
  private modal = document.getElementById('modal')!;
  private hud = new Hud(document.getElementById('hud')!);
  settings: ClientSettings = load('settings', DEFAULT_SETTINGS);
  roster: Roster = load('roster', DEFAULT_ROSTER);
  setup: Setup = load('setup', DEFAULT_SETUP);
  private screen: Screen = 'main';
  private session: Session | null = null;
  private lastLocal: (() => LocalSession) | null = null;
  private paused = false;
  net: NetClient | null = null;
  private room: RoomState | null = null;
  private notice = '';
  private queuedPlayers = 0;
  private history: { map: string; won: boolean; at: string; opponents: string }[] = [];

  constructor(game: Phaser.Game) {
    this.game = game;
    audio.sfxVolume = this.settings.sfxVolume;
    audio.musicVolume = this.settings.musicVolume;
    this.menu.addEventListener('click', (e) => this.onClick(e));
    this.modal.addEventListener('click', (e) => this.onClick(e));
    this.menu.addEventListener('input', (e) => this.onInput(e));
    this.menu.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (e.key === 'Enter' && t.id === 'join-code') this.joinRoom();
    });
    this.hud.onPause = () => this.togglePause();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.session) this.togglePause();
    });
    window.addEventListener('pointerdown', () => audio.startMusic(), { once: true });

    const code = new URLSearchParams(location.search).get('room');
    if (code) {
      this.show('online');
      this.pendingJoin = code.toUpperCase();
    } else this.show('main');
  }

  private pendingJoin = '';

  // ------------------------------------------------------------------ navigation

  show(screen: Screen): void {
    if (this.session) this.endSession();
    this.screen = screen;
    if (screen === 'online' || screen === 'room' || screen === 'queue') this.ensureNet();
    this.menu.classList.add('visible');
    this.render();
  }

  private render(): void {
    if (!this.menu.classList.contains('visible')) return;
    const screens: Record<Screen, () => string> = {
      main: () => this.mainHtml(), mode: () => this.modeHtml(), bots: () => this.setupHtml('bots'), local: () => this.setupHtml('local'),
      characters: () => this.charactersHtml(), settings: () => this.settingsHtml(), howto: () => this.howtoHtml(),
      online: () => this.onlineHtml(), queue: () => this.queueHtml(), room: () => this.roomHtml(),
    };
    const scroll = this.menu.scrollTop;
    this.menu.innerHTML = `${MENU_BG}${screens[this.screen]()}`;
    this.menu.scrollTop = scroll;
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    audio.play('ui');
    const d = el.dataset;
    switch (d.action) {
      case 'go':
        this.show(d.to as Screen);
        break;
      case 'set': {
        const group = d.group as 'settings' | 'setup' | 'room';
        const value = parseValue(d.value!);
        if (group === 'room') {
          this.net?.send({ t: 'roomConfig', ...(d.key === 'mapId' ? { mapId: String(value) } : { settings: { [d.key!]: value } }) });
          break;
        }
        (this[group] as unknown as Record<string, unknown>)[d.key!] = value;
        save(group, this[group]);
        if (d.key === 'sfxVolume') audio.sfxVolume = Number(value);
        if (d.key === 'musicVolume') audio.setMusicVolume(Number(value));
        this.render();
        break;
      }
      case 'species': {
        const r = this.roster.players[Number(d.slot)];
        const i = CHARACTERS.findIndex((s) => s.id === r.species);
        r.species = CHARACTERS[(i + Number(d.dir) + CHARACTERS.length) % CHARACTERS.length].id;
        save('roster', this.roster);
        if (d.slot === '0') this.net?.setProfile(this.myName(), r.species);
        this.render();
        break;
      }
      case 'start':
        this.startLocal();
        break;
      case 'quick':
        this.notice = '';
        this.net?.send({ t: 'queue' });
        break;
      case 'unqueue':
        this.net?.send({ t: 'unqueue' });
        this.show('online');
        break;
      case 'create':
        this.notice = '';
        this.net?.send({ t: 'createRoom', mapId: this.setup.mapId === 'random' ? 'random' : this.setup.mapId, settings: this.matchSettings() });
        break;
      case 'join':
        this.joinRoom();
        break;
      case 'ready': {
        const me = this.room?.members.find((m) => m.id === this.net?.playerId);
        this.net?.send({ t: 'ready', ready: !me?.ready });
        break;
      }
      case 'leave':
        this.net?.send({ t: 'leaveRoom' });
        this.room = null;
        this.show('online');
        break;
      case 'copy': {
        const link = `${location.origin}${location.pathname}?room=${this.room?.code}`;
        navigator.clipboard?.writeText(link).then(
          () => this.toastMenu('Invite link copied!'),
          () => this.toastMenu(link),
        );
        break;
      }
      case 'resume':
        this.togglePause();
        break;
      case 'resign':
        this.net?.send({ t: 'resign' });
        this.closeModal();
        break;
      case 'quit':
        this.endSession();
        if (this.room) {
          this.net?.send({ t: 'leaveRoom' });
          this.room = null;
          this.show('online');
        } else this.show('main');
        break;
      case 'rematch':
        if (this.session?.online || this.room) {
          this.net?.send({ t: 'rematch' });
          el.textContent = 'Waiting for opponent…';
          (el as HTMLButtonElement).disabled = true;
        } else if (this.lastLocal) this.runSession(this.lastLocal());
        break;
      case 'menu':
        this.endSession();
        this.show('main');
        break;
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.dataset.slot != null) {
      this.roster.players[Number(t.dataset.slot)].name = t.value.slice(0, 16);
      save('roster', this.roster);
      if (t.dataset.slot === '0') this.net?.setProfile(this.myName(), this.roster.players[0].species);
    } else if (t.dataset.range) {
      (this.settings as unknown as Record<string, number>)[t.dataset.range] = Number(t.value) / 100;
      save('settings', this.settings);
      audio.sfxVolume = this.settings.sfxVolume;
      audio.setMusicVolume(this.settings.musicVolume);
    }
  }

  private toastMenu(msg: string): void {
    const el = document.createElement('div');
    el.className = 'toast menu-toast';
    el.textContent = msg;
    this.menu.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  private myName(): string {
    return sanitizeName(this.roster.players[0].name);
  }

  private matchSettings() {
    const s = this.settings;
    return { turnTime: s.turnTime, wind: s.wind, startHP: s.startHP, suddenDeath: s.suddenDeath };
  }

  // ------------------------------------------------------------------ local matches

  private startLocal(): void {
    const { mode, count, difficulty, mapId } = this.setup;
    const make = () => {
      const map = mapId === 'random' ? MAPS[Math.floor(Math.random() * MAPS.length)].id : mapId;
      const players: MatchPlayerConfig[] = Array.from({ length: count }, (_, i) => ({
        name: sanitizeName(this.roster.players[i].name || `Player ${i + 1}`),
        species: this.roster.players[i].species,
        team: i,
        bot: mode === 'bots' && i > 0 ? difficulty : null,
      }));
      return new LocalSession({ mapId: map, seed: (Math.random() * 2 ** 31) | 0, players, settings: this.matchSettings() });
    };
    this.lastLocal = make;
    this.runSession(make());
  }

  private runSession(session: Session): void {
    this.endSession();
    this.closeModal();
    this.menu.classList.remove('visible');
    this.menu.innerHTML = '';
    this.session = session;
    this.paused = false;
    this.hud.attach(session);
    const data: BattleData = {
      session,
      settings: this.settings,
      hooks: {
        banner: (t, c, s) => this.hud.banner(t, c, s),
        toast: (m) => this.hud.toast(m),
        frame: (s, scene: BattleScene) => this.hud.update(s, scene),
        gameOver: (r) => this.showResults(r),
        takeUiWeapon: () => this.hud.takeUiWeapon(),
      },
    };
    this.game.scene.start('battle', data);
  }

  private endSession(): void {
    if (this.game.scene.isActive('battle') || this.game.scene.isPaused('battle')) this.game.scene.stop('battle');
    this.session?.dispose();
    this.session = null;
    this.hud.detach();
    this.closeModal();
  }

  private togglePause(): void {
    if (!this.session) return;
    if (this.modal.classList.contains('visible') && !this.paused) return; // results showing
    this.paused = !this.paused;
    if (!this.session.online) {
      if (this.paused) this.game.scene.pause('battle');
      else this.game.scene.resume('battle');
    }
    if (this.paused) {
      const online = this.session.online;
      this.modal.innerHTML = `<div class="modal-backdrop"><div class="panel pause">
        <h2>${online ? 'Menu' : 'Paused'}</h2>
        ${online ? '<p class="panel-sub">The match keeps running while this menu is open.</p>' : ''}
        <div class="field"><label>Sound</label><input type="range" min="0" max="100" value="${Math.round(this.settings.sfxVolume * 100)}" data-range="sfxVolume"></div>
        <div class="field"><label>Music</label><input type="range" min="0" max="100" value="${Math.round(this.settings.musicVolume * 100)}" data-range="musicVolume"></div>
        <div class="panel-actions">
          <button class="btn btn-primary" data-action="resume">Resume</button>
          ${online ? '<button class="btn" data-action="resign">Resign</button>' : ''}
          <button class="btn" data-action="quit">${online ? 'Leave match' : 'Quit to menu'}</button>
        </div></div></div>`;
      this.modal.classList.add('visible');
      this.modal.querySelectorAll('input[type=range]').forEach((el) => el.addEventListener('input', (e) => this.onInput(e)));
    } else this.closeModal();
  }

  private closeModal(): void {
    this.modal.classList.remove('visible');
    this.modal.innerHTML = '';
  }

  private showResults(r: MatchResult): void {
    this.paused = false;
    const s = this.session;
    if (!s) return;
    const names = r.winners.map((w) => r.players.find((p) => p.slot === w)?.name).filter(Boolean);
    const youWon = s.online ? r.winners.includes((s as NetSession).you) : null;
    const rows = [...r.players]
      .sort((a, b) => Number(r.winners.includes(b.slot)) - Number(r.winners.includes(a.slot)) || b.stats.damageDealt - a.stats.damageDealt)
      .map((p) => {
        const acc = p.stats.shots ? Math.round((p.stats.hits / p.stats.shots) * 100) : 0;
        const ch = s.world.characters[p.slot];
        return `<tr class="${r.winners.includes(p.slot) ? 'winner' : ''}"><td><span class="roster-dot" style="background:${TEAM_COLORS[p.team % 4]}"></span>${esc(p.name)} ${r.winners.includes(p.slot) ? '👑' : ''}</td>
          <td>${p.stats.damageDealt}</td><td>${p.stats.kills}</td><td>${p.stats.shots}</td><td>${acc}%</td><td>${p.alive ? `${ch?.hp ?? 0} HP` : 'KO'}</td></tr>`;
      })
      .join('');
    const title = youWon === true ? 'Victory!' : youWon === false ? 'Defeat' : names.length ? `${names.join(' & ')} wins!` : "It's a draw!";
    const winnerSlot = r.winners[0];
    const winnerChar = winnerSlot !== undefined ? s.world.characters[winnerSlot] : null;
    this.modal.innerHTML = `<div class="modal-backdrop"><div class="panel gameover">
      ${winnerChar ? `<div class="winner-pose">${critterHtml(winnerChar.species, TEAM_COLORS[winnerChar.team % 4], 2.4, { hop: true })}</div>` : ''}
      <h2>${esc(title)}</h2>
      <p class="panel-sub">${esc(mapById(r.map)?.name ?? r.map)} · ${r.turns} turns · ${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}</p>
      <div class="table-wrap"><table class="stats"><thead><tr><th>Critter</th><th>Damage</th><th>KOs</th><th>Shots</th><th>Accuracy</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="panel-actions">
        <button class="btn btn-primary" data-action="rematch">Rematch</button>
        <button class="btn" data-action="${s.online ? 'quit' : 'menu'}">${s.online ? 'Leave room' : 'Main menu'}</button>
      </div></div></div>`;
    this.modal.classList.add('visible');
  }

  // ------------------------------------------------------------------ online

  private ensureNet(): void {
    if (!this.net) {
      this.net = new NetClient({ name: this.myName(), species: this.roster.players[0].species });
      this.net.on((m) => this.onNet(m));
      this.net.onState((s) => this.onNetState(s));
    }
    if (this.net.state === 'offline') this.net.connect();
  }

  private onNetState(s: NetState): void {
    if (s === 'online' && this.pendingJoin) {
      this.net!.send({ t: 'joinRoom', code: this.pendingJoin });
      this.pendingJoin = '';
      history.replaceState(null, '', location.pathname);
    }
    if (s === 'online') this.loadHistory();
    if (!this.session) this.render();
  }

  private async loadHistory(): Promise<void> {
    try {
      const base = serverUrl().replace(/^ws/, 'http').replace(/\/ws$/, '');
      const res = await fetch(`${base}/api/history`, { headers: { authorization: `Bearer ${this.net!.token}` } });
      if (res.ok) this.history = await res.json();
      if (!this.session && this.screen === 'online') this.render();
    } catch {
      /* history is optional */
    }
  }

  private onNet(m: ServerMsg): void {
    switch (m.t) {
      case 'queued':
        this.queuedPlayers = m.players;
        if (!this.session) this.show('queue');
        break;
      case 'room': {
        const sameRoom = this.room?.code === m.code;
        this.room = { ...m, settings: { ...this.settings, ...m.settings } };
        if (this.session && sameRoom && m.state === 'results') this.updateRematch(m.rematch);
        else if (m.state !== 'playing' && (!this.session || !sameRoom || m.state === 'lobby')) this.show('room');
        break;
      }
      case 'left':
        this.room = null;
        if (this.session?.online && this.session.result()) {
          this.notice = 'Your opponent left the room.';
          this.show('online');
        } else if (!this.session) this.show('online');
        break;
      case 'matchStart':
        this.onMatchStart(m);
        break;
      case 'matchEnd':
        this.loadHistory();
        break;
      case 'error':
        this.notice = m.msg;
        if (this.session) this.hud.toast(m.msg);
        else this.render();
        break;
    }
  }

  private onMatchStart(m: MatchStartMsg): void {
    const cur = this.session as NetSession | null;
    if (cur?.online && cur.matchId === m.matchId) return; // resync handled by the session
    this.runSession(new NetSession(this.net!, m));
    if (m.resumed) this.hud.toast('Reconnected to your match');
  }

  private updateRematch(votes: string[]): void {
    const btn = this.modal.querySelector<HTMLButtonElement>('[data-action=rematch]');
    if (!btn) return;
    const others = (this.room?.members ?? []).filter((m) => m.id !== this.net?.playerId && votes.includes(m.id));
    if (others.length && !btn.disabled) btn.textContent = 'Opponent wants a rematch!';
  }

  private joinRoom(): void {
    const input = this.menu.querySelector<HTMLInputElement>('#join-code');
    const code = (input?.value ?? '').trim().toUpperCase();
    if (code.length < 4) {
      this.notice = 'Enter the 5-letter room code';
      this.render();
      return;
    }
    this.notice = '';
    this.net?.send({ t: 'joinRoom', code });
  }

  // ------------------------------------------------------------------ screens

  private mainHtml(): string {
    const parade = this.roster.players
      .map((r, i) => `<div class="parade-slot" style="--d:${i * 0.15}s">${critterHtml(r.species, TEAM_COLORS[i], 2.4, { hop: true, facing: i < 2 ? 1 : -1, weapon: i === 0 ? 'rocket' : undefined })}</div>`)
      .join('');
    return `
      <div class="screen screen-main">
        <h1 class="logo"><img class="logo-img" alt="Wildlings: Critter Artillery" src="${art.url('logo')}"></h1>
        <div class="parade">${parade}</div>
        <div class="menu-buttons">
          <button class="btn btn-big btn-primary" data-action="go" data-to="mode">Play</button>
          <div class="menu-row">
            <button class="btn" data-action="go" data-to="bots">VS Bot</button>
            <button class="btn" data-action="go" data-to="online">Online PvP</button>
          </div>
          <div class="menu-row">
            <button class="btn" data-action="go" data-to="characters">Characters</button>
            <button class="btn" data-action="go" data-to="settings">Settings</button>
            <button class="btn" data-action="go" data-to="howto">How to Play</button>
          </div>
        </div>
        <div class="controls-hint">
          <span><kbd>A</kbd><kbd>D</kbd> walk</span><span><kbd>W</kbd> climb</span><span><kbd>S</kbd> steady</span>
          <span><kbd>Space</kbd> jump</span><span><kbd>Mouse</kbd> aim</span><span><kbd>Click</kbd> fire</span><span><kbd>E</kbd><kbd>Q</kbd> weapons</span>
        </div>
      </div>`;
  }

  private modeHtml(): string {
    const card = (to: string, title: string, desc: string, icon: string) =>
      `<button class="mode-card" data-action="go" data-to="${to}"><img alt="" src="${art.url(icon)}"><b>${title}</b><span>${desc}</span></button>`;
    return `
      <div class="screen panel panel-wide">
        <h2>Choose a Mode</h2>
        <div class="mode-cards">
          ${card('bots', 'VS Bot', 'Battle up to three computer critters. Easy, Normal or Hard.', 'icon_rocket')}
          ${card('online', 'Online PvP', 'Quick Match against real players, or a private room with friends.', 'icon_airstrike')}
          ${card('local', 'Local Party', 'Two to four players take turns on this computer.', 'icon_cluster')}
        </div>
        <div class="panel-actions"><button class="btn" data-action="go" data-to="main">Back</button></div>
      </div>`;
  }

  private mapGrid(current: string, group: 'setup' | 'room', disabled = false): string {
    const maps = [...MAPS.map((m) => ({ id: m.id, name: m.name, p: m.palette as Record<string, string> & { sky: string[] }, hazard: m.hazard })), { id: 'random', name: 'Random', p: null, hazard: '' }];
    return `<div class="map-grid">${maps
      .map((m) => {
        const style = m.p ? `--sky1:${m.p.sky[0]};--sky2:${m.p.sky[1]};--ground:${m.p.top};--dirt:${m.p.dirt};--water:${m.p.liquid}` : '';
        return `<button class="map-card ${current === m.id ? 'active' : ''} ${m.p ? '' : 'random'}" ${disabled ? 'disabled' : ''} data-action="set" data-group="${group}" data-key="mapId" data-value="${m.id}" style="${style}"><span class="map-thumb">${m.p ? '' : '?'}</span><span class="map-name">${esc(m.name)}</span></button>`;
      })
      .join('')}</div>`;
  }

  private rulesFields(group: 'settings' | 'room', s: ClientSettings, disabled = false): string {
    return `
      <div class="field"><label>Turn timer</label>${seg(group, 'turnTime', s.turnTime, RULES.turn.timeOptions.map((t) => [t, t ? `${t}s` : '∞']), disabled)}</div>
      <div class="field"><label>Wind</label>${seg(group, 'wind', s.wind, [['off', 'Off'], ['low', 'Low'], ['normal', 'Normal'], ['high', 'High']], disabled)}</div>
      <div class="field"><label>Starting HP</label>${seg(group, 'startHP', s.startHP, RULES.match.startHPOptions.map((h) => [h, String(h)]), disabled)}</div>
      <div class="field"><label>Sudden death</label>${seg(group, 'suddenDeath', s.suddenDeath, [[true, 'On'], [false, 'Off']], disabled)}</div>`;
  }

  private setupHtml(mode: 'bots' | 'local'): string {
    if (this.setup.mode !== mode) {
      this.setup.mode = mode;
      save('setup', this.setup);
    }
    const { count, difficulty, mapId } = this.setup;
    const lineup = Array.from({ length: count }, (_, i) => {
      const r = this.roster.players[i];
      const tag = mode === 'bots' ? (i === 0 ? 'You' : `Bot · ${difficulty}`) : `Player ${i + 1}`;
      return `<div class="lineup-card" style="--team:${TEAM_COLORS[i]}">${critterHtml(r.species, TEAM_COLORS[i], 1.5, { facing: i ? -1 : 1 })}<b>${esc(r.name || `Player ${i + 1}`)}</b><small>${tag}</small></div>`;
    }).join('');
    return `
      <div class="screen panel panel-wide">
        <h2>${mode === 'bots' ? 'VS Bot' : 'Local Party'}</h2>
        <div class="field"><label>${mode === 'bots' ? 'Critters' : 'Players'}</label>${seg('setup', 'count', count, mode === 'bots' ? [[2, '1 bot'], [3, '2 bots'], [4, '3 bots']] : [[2, '2'], [3, '3'], [4, '4']])}</div>
        ${mode === 'bots' ? `<div class="field"><label>Bot skill</label>${seg('setup', 'difficulty', difficulty, [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}</div>` : ''}
        <div class="field field-col"><label>Battlefield</label>${this.mapGrid(mapId, 'setup')}</div>
        ${this.rulesFields('settings', this.settings)}
        <div class="lineup">${lineup}</div>
        <div class="panel-actions">
          <button class="btn" data-action="go" data-to="mode">Back</button>
          <button class="btn" data-action="go" data-to="characters">Edit Critters</button>
          <button class="btn btn-primary" data-action="start">Start Battle!</button>
        </div>
      </div>`;
  }

  private charactersHtml(): string {
    const cards = this.roster.players
      .map((r, i) => `
        <div class="char-card" style="--team:${TEAM_COLORS[i]}">
          <div class="char-slot">${i === 0 ? 'You' : `Player ${i + 1}`}</div>
          <div class="char-stage">${critterHtml(r.species, TEAM_COLORS[i], 2.6, { hop: true, weapon: 'rocket' })}</div>
          <div class="species-picker">
            <button class="btn btn-round" data-action="species" data-slot="${i}" data-dir="-1" aria-label="Previous critter">◀</button>
            <span>${esc(characterById(r.species).name)}</span>
            <button class="btn btn-round" data-action="species" data-slot="${i}" data-dir="1" aria-label="Next critter">▶</button>
          </div>
          <input class="name-input" data-slot="${i}" maxlength="16" value="${esc(r.name)}" aria-label="Player ${i + 1} name" />
        </div>`)
      .join('');
    return `
      <div class="screen panel panel-wide">
        <h2>Choose Your Critters</h2>
        <p class="panel-sub">Slot 1 is you (online and vs bots). Every critter has the same stats, so pick your favourite.</p>
        <div class="char-grid">${cards}</div>
        <div class="panel-actions">
          <button class="btn" data-action="go" data-to="main">Main Menu</button>
          <button class="btn btn-primary" data-action="go" data-to="mode">Play</button>
        </div>
      </div>`;
  }

  private settingsHtml(): string {
    const s = this.settings;
    return `
      <div class="screen panel">
        <h2>Settings</h2>
        <h3>Match rules (offline &amp; rooms you host)</h3>
        ${this.rulesFields('settings', s)}
        <h3>Controls &amp; display</h3>
        <div class="field"><label>Mouse wheel</label>${seg('settings', 'wheelMode', s.wheelMode, [['weapon', 'Switch weapon'], ['power', 'Adjust power']])}</div>
        <div class="field"><label>Aim guide</label>${seg('settings', 'aimGuide', s.aimGuide, [[true, 'On'], [false, 'Off']])}</div>
        <div class="field"><label>Screen shake</label>${seg('settings', 'screenShake', s.screenShake, [[true, 'On'], [false, 'Off']])}</div>
        <div class="field"><label>Zoom</label>${seg('settings', 'zoom', s.zoom, [[0.75, 'Far'], [1, 'Normal'], [1.3, 'Close']])}</div>
        <h3>Audio</h3>
        <div class="field"><label>Sound effects</label>${seg('settings', 'sfxVolume', s.sfxVolume, [[0, 'Off'], [0.35, 'Low'], [0.7, 'Normal'], [1, 'Loud']])}</div>
        <div class="field"><label>Music</label>${seg('settings', 'musicVolume', s.musicVolume, [[0, 'Off'], [0.2, 'Low'], [0.35, 'Normal'], [0.6, 'Loud']])}</div>
        <div class="panel-actions"><button class="btn btn-primary" data-action="go" data-to="main">Done</button></div>
      </div>`;
  }

  private howtoHtml(): string {
    const weapons = WEAPONS.map((w) => `<li><img alt="" src="${art.url(`icon_${w.id}`)}"><b>${esc(w.name)}</b> <small>${w.ammo < 0 ? '∞' : `×${w.ammo}`}${w.cooldown ? ` · ${w.cooldown}-turn cooldown` : ''}</small><br><span>${esc(w.desc)}</span></li>`).join('');
    return `
      <div class="screen panel panel-wide howto">
        <h2>How to Play</h2>
        <p>Take turns with your opponents. On your turn you can <b>walk</b>, <b>climb</b> and <b>jump</b> while your
        <b>Move</b> energy lasts, then fire <b>one</b> weapon. Knock everyone else out, or into the water, to win.</p>
        <div class="howto-grid">
          <div><h3>Controls</h3><ul class="keys">
            <li><kbd>A</kbd><kbd>D</kbd> walk (uses energy)</li><li><kbd>W</kbd> hold to climb steep slopes (costs more)</li>
            <li><kbd>S</kbd> hold to steady your aim: longer guide that accounts for wind, plus an impact marker</li>
            <li><kbd>Space</kbd> jump</li><li><kbd>Mouse</kbd> aim: distance from your critter sets the power</li>
            <li><kbd>Left click</kbd> fire</li><li><kbd>E</kbd>/<kbd>Q</kbd>, wheel, <kbd>1</kbd>–<kbd>9</kbd> switch weapon</li>
            <li>Right-drag pan · <kbd>+</kbd>/<kbd>-</kbd> zoom · <kbd>Esc</kbd> menu</li></ul>
            <h3>Tips</h3><ul>
            <li>Wind changes every turn. Rockets ride it, shotgun pellets ignore it.</li>
            <li>Falls hurt. Water and lava are an instant knock-out.</li>
            <li>Red barrels explode when hit. Mines blink red when armed.</li>
            <li>After turn ${RULES.suddenDeath.startTurn}, sudden death raises the water every turn.</li></ul></div>
          <div><h3>Weapons</h3><ul class="weapon-list">${weapons}</ul></div>
        </div>
        <div class="panel-actions"><button class="btn btn-primary" data-action="go" data-to="main">Got it!</button></div>
      </div>`;
  }

  private connBadge(): string {
    const s = this.net?.state ?? 'offline';
    const label: Record<NetState, string> = { offline: 'Offline', connecting: 'Connecting…', online: 'Connected', reconnecting: 'Reconnecting…' };
    return `<span class="conn conn-${s}">${label[s]}${s === 'online' && this.net?.rtt ? ` · ${Math.round(this.net.rtt)} ms` : ''}</span>`;
  }

  private onlineHtml(): string {
    const ok = this.net?.state === 'online';
    const me = this.roster.players[0];
    const hist = this.history.length
      ? `<ul class="history">${this.history.slice(0, 6).map((h) => `<li class="${h.won ? 'won' : 'lost'}"><b>${h.won ? 'Win' : 'Loss'}</b> vs ${esc(h.opponents)} <small>${esc(mapById(h.map)?.name ?? h.map)}</small></li>`).join('')}</ul>`
      : '<p class="panel-sub">No online matches yet.</p>';
    return `
      <div class="screen panel panel-wide">
        <h2>Online PvP</h2>
        <div class="online-head">
          ${critterHtml(me.species, TEAM_COLORS[0], 1.6)}
          <div><input class="name-input" data-slot="0" maxlength="16" value="${esc(me.name)}" aria-label="Your name"><div>${this.connBadge()}</div></div>
          <button class="btn btn-round" data-action="go" data-to="characters">Change critter</button>
        </div>
        ${this.notice ? `<div class="notice">${esc(this.notice)}</div>` : ''}
        ${this.net?.lastError && !ok ? `<div class="notice">${esc(this.net.lastError)}</div>` : ''}
        <div class="mode-cards">
          <button class="mode-card" data-action="quick" ${ok ? '' : 'disabled'}><img alt="" src="${art.url('icon_rocket')}"><b>Quick Match</b><span>Get paired with the next available player.</span></button>
          <button class="mode-card" data-action="create" ${ok ? '' : 'disabled'}><img alt="" src="${art.url('icon_grenade')}"><b>Private Room</b><span>Create a room and invite a friend with a code or link.</span></button>
          <div class="mode-card join-card"><img alt="" src="${art.url('icon_teleport')}"><b>Join Room</b>
            <input id="join-code" class="name-input code-input" maxlength="5" placeholder="CODE" autocomplete="off" aria-label="Room code">
            <button class="btn btn-round" data-action="join" ${ok ? '' : 'disabled'}>Join</button></div>
        </div>
        <h3>Recent matches</h3>${hist}
        <div class="panel-actions"><button class="btn" data-action="go" data-to="main">Back</button></div>
      </div>`;
  }

  private queueHtml(): string {
    return `
      <div class="screen panel">
        <h2>Finding an opponent…</h2>
        <div class="searching">${critterHtml(this.roster.players[0].species, TEAM_COLORS[0], 2.2, { hop: true })}</div>
        <p class="panel-sub">${this.queuedPlayers > 1 ? `${this.queuedPlayers} players searching` : 'Waiting for another player to join the queue.'}</p>
        <div class="panel-actions"><button class="btn" data-action="unqueue">Cancel</button></div>
      </div>`;
  }

  private roomHtml(): string {
    const r = this.room;
    if (!r) return this.onlineHtml();
    const me = r.members.find((m) => m.id === this.net?.playerId);
    const host = !!me?.host && !r.quick;
    const members = r.members
      .map((m, i) => `<div class="member ${m.ready ? 'ready' : ''} ${m.connected ? '' : 'offline'}" style="--team:${TEAM_COLORS[i % 4]}">
        ${critterHtml(m.species, TEAM_COLORS[i % 4], 1.4, { facing: i % 2 ? -1 : 1 })}
        <div><b>${esc(m.name)}${m.id === this.net?.playerId ? ' (you)' : ''}</b><small>${m.host ? 'Host · ' : ''}${m.client === 'godot' ? 'Desktop' : 'Browser'}${m.connected ? '' : ' · disconnected'}</small></div>
        <span class="ready-tag">${m.ready ? 'Ready!' : 'Not ready'}</span></div>`)
      .join('');
    const empty = r.members.length < 2 ? `<div class="member empty"><div><b>Waiting for a friend…</b><small>Share the code or invite link</small></div></div>` : '';
    return `
      <div class="screen panel panel-wide">
        <h2>${r.quick ? 'Match Found' : 'Private Room'}</h2>
        ${r.quick ? '' : `<div class="room-code"><span>Room code</span><b>${esc(r.code)}</b><button class="btn btn-round" data-action="copy">Copy invite link</button></div>`}
        ${this.notice ? `<div class="notice">${esc(this.notice)}</div>` : ''}
        <div class="members">${members}${empty}</div>
        <div class="field field-col"><label>Battlefield ${host ? '' : '<small>(host picks)</small>'}</label>${this.mapGrid(r.mapId, 'room', !host)}</div>
        ${this.rulesFields('room', r.settings, !host)}
        <div class="panel-actions">
          <button class="btn" data-action="leave">Leave</button>
          <button class="btn btn-primary" data-action="ready">${me?.ready ? 'Not ready' : "I'm ready!"}</button>
        </div>
        <div class="conn-line">${this.connBadge()}</div>
      </div>`;
  }
}
