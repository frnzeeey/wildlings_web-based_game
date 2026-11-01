import { animatePreviews } from './previews.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Modal overlay used for both the game-over screen and the pause menu. */
export class GameOver {
  constructor(root, { onRematch, onMenu, onResume }) {
    this.root = root;
    this.stop = () => {};
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'rematch') onRematch();
      if (a === 'menu') onMenu();
      if (a === 'resume') onResume();
    });
  }

  get visible() {
    return this.root.classList.contains('visible');
  }

  show(r) {
    const mins = Math.floor(r.duration / 60);
    const secs = String(Math.floor(r.duration % 60)).padStart(2, '0');
    const rows = r.players
      .map((p) => {
        const acc = p.stats.shots ? Math.round((p.stats.hits / p.stats.shots) * 100) : 0;
        const result = p === r.winner ? '<span class="tag win">Winner</span>' : p.drowned ? '<span class="tag">Drowned</span>' : '<span class="tag">KO</span>';
        return `<tr>
          <td><span class="roster-dot" style="background:${p.color}"></span>${esc(p.name)}${p.isAI ? ' <em>bot</em>' : ''}</td>
          <td>${result}</td><td>${p.stats.damageDealt}</td><td>${p.stats.kills}</td>
          <td>${p.stats.shots}</td><td>${acc}%</td><td>${p.stats.damageTaken}</td></tr>`;
      })
      .join('');
    const w = r.winner;
    this.open(`
      <div class="panel gameover">
        <div class="trophy">${w ? `<canvas data-species="${w.species}" data-color="${w.color}" data-hop="1" data-scale="2.6"></canvas>` : ''}</div>
        <h2>${w ? `<span style="color:${w.color}">${esc(w.name)}</span> wins!` : "It's a draw!"}</h2>
        <p class="panel-sub">${esc(r.map)} · ${r.turns} turns · ${mins}:${secs}</p>
        <div class="table-wrap"><table class="stats">
          <thead><tr><th>Critter</th><th>Result</th><th>Damage</th><th>KOs</th><th>Shots</th><th>Accuracy</th><th>Taken</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="panel-actions">
          <button class="btn" data-action="menu">Main Menu</button>
          <button class="btn btn-primary" data-action="rematch">Rematch</button>
        </div>
      </div>`);
  }

  showPause() {
    this.open(`
      <div class="panel pause">
        <h2>Paused</h2>
        <div class="menu-buttons">
          <button class="btn btn-big btn-primary" data-action="resume">Resume</button>
          <button class="btn btn-big" data-action="rematch">Restart Match</button>
          <button class="btn btn-big" data-action="menu">Quit to Menu</button>
        </div>
      </div>`);
  }

  open(html) {
    this.stop();
    this.root.innerHTML = `<div class="modal-backdrop">${html}</div>`;
    this.root.classList.add('visible');
    this.stop = animatePreviews(this.root);
  }

  hide() {
    this.stop();
    this.root.classList.remove('visible');
    this.root.innerHTML = '';
  }
}
