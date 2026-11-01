import { WEAPONS } from '../game/Weapon.js';
import { PLAYER } from '../game/config.js';
import { drawWeaponIcon } from '../rendering/Sprites.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** DOM overlay for in-match information. Only touches the DOM when values change. */
export class HUD {
  constructor(root, { onPause }) {
    this.root = root;
    this.onPause = onPause;
  }

  attach(game) {
    this.game = game;
    this.cache = new Map();
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-card hud-turn">
          <div class="turn-dot"></div>
          <div class="turn-text"><div class="turn-name"></div><div class="turn-sub"></div></div>
          <div class="turn-timer"><svg viewBox="0 0 40 40"><circle class="ring-bg" cx="20" cy="20" r="17"/><circle class="ring" cx="20" cy="20" r="17"/></svg><span></span></div>
        </div>
        <div class="hud-card hud-wind">
          <div class="hud-label">Wind</div>
          <div class="wind-bar"><div class="wind-fill"></div><div class="wind-mid"></div></div>
          <div class="wind-value"></div>
        </div>
        <div class="hud-right">
          <div class="hud-card hud-roster">${game.players
            .map(
              (p) => `<div class="roster-row" data-id="${p.id}"><span class="roster-dot" style="background:${p.color}"></span><span class="roster-name">${esc(p.name)}${p.isAI ? ' <em>bot</em>' : ''}</span><span class="roster-hp"><i></i></span></div>`,
            )
            .join('')}</div>
          <button class="hud-btn hud-pause" title="Pause (Esc)">❚❚</button>
        </div>
      </div>
      <div class="hud-banner"><div class="banner-title"></div><div class="banner-sub"></div></div>
      <div class="hud-toasts"></div>
      <div class="hud-bottom">
        <div class="hud-card hud-stats">
          <div class="stat"><span class="hud-label">Angle</span><b class="stat-angle"></b></div>
          <div class="stat stat-bar"><span class="hud-label">Power</span><div class="bar"><i class="bar-power"></i></div></div>
          <div class="stat stat-bar"><span class="hud-label">Move</span><div class="bar"><i class="bar-energy"></i></div></div>
        </div>
        <div class="hud-weapons-wrap">
          <div class="weapon-info"><b></b><span></span></div>
          <div class="hud-card hud-weapons">${WEAPONS.map(
            (w, i) => `<button class="slot" data-index="${i}" title="${esc(w.name)}"><canvas></canvas><span class="slot-key">${i + 1}</span><span class="slot-ammo"></span></button>`,
          ).join('')}</div>
        </div>
        <div class="hud-help">WASD move · Space jump · S steady aim · Mouse aim · Click fire · Wheel/1-8 weapon · Right-drag pan · +/- zoom</div>
      </div>`;
    this.root.classList.add('visible');
    const q = (s) => this.root.querySelector(s);
    this.els = {
      dot: q('.turn-dot'),
      name: q('.turn-name'),
      sub: q('.turn-sub'),
      timer: q('.turn-timer'),
      timerText: q('.turn-timer span'),
      ring: q('.ring'),
      windFill: q('.wind-fill'),
      windValue: q('.wind-value'),
      angle: q('.stat-angle'),
      power: q('.bar-power'),
      energy: q('.bar-energy'),
      weaponName: q('.weapon-info b'),
      weaponDesc: q('.weapon-info span'),
      weapons: q('.hud-weapons'),
      banner: q('.hud-banner'),
      bannerTitle: q('.banner-title'),
      bannerSub: q('.banner-sub'),
      toasts: q('.hud-toasts'),
      rows: [...this.root.querySelectorAll('.roster-row')],
      slots: [...this.root.querySelectorAll('.slot')],
    };
    this.els.slots.forEach((el, i) => {
      requestAnimationFrame(() => drawWeaponIcon(el.querySelector('canvas'), WEAPONS[i]));
      el.addEventListener('click', () => game.uiSelectWeapon(i));
    });
    q('.hud-pause').addEventListener('click', () => this.onPause());
  }

  detach() {
    this.root.innerHTML = '';
    this.root.classList.remove('visible');
    this.game = null;
  }

  set(key, value, apply) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply(value);
  }

  update(game) {
    const tm = game.turns;
    const p = tm.active;
    if (!p || !this.els) return;
    const e = this.els;

    this.set('dot', p.color, (v) => (e.dot.style.background = v));
    this.set('name', p.name, (v) => (e.name.textContent = v));
    let sub = 'Your move';
    if (game.over) sub = 'Match over';
    else if (tm.phase === 'action' || tm.phase === 'settle') sub = 'Resolving...';
    else if (p.isAI) sub = `Bot (${p.controller.difficulty}) is thinking...`;
    else if (tm.phase === 'start') sub = 'Get ready!';
    this.set('sub', sub, (v) => (e.sub.textContent = v));

    const total = game.settings.turnTime;
    const tl = tm.timeLeft;
    const timerText = tl === Infinity ? '∞' : String(Math.ceil(tl));
    this.set('timer', timerText, (v) => (e.timerText.textContent = v));
    const frac = tl === Infinity || !total ? 1 : Math.max(0, tl / total);
    this.set('ring', Math.round(frac * 200), () => (e.ring.style.strokeDashoffset = String(106.8 * (1 - frac))));
    this.set('low', tm.phase === 'aim' && tl <= 5, (v) => e.timer.classList.toggle('low', v));

    const wind = game.wind;
    this.set('wind', wind, (v) => {
      const pct = Math.min(50, (Math.abs(v) / 1.6) * 50);
      e.windFill.style.width = `${pct}%`;
      e.windFill.style.left = v < 0 ? `${50 - pct}%` : '50%';
      const n = Math.round(Math.abs(v) * 10);
      e.windValue.textContent = n === 0 ? 'Calm' : `${v < 0 ? '◀ ' : ''}${n}${v > 0 ? ' ▶' : ''}`;
    });

    const elev = Math.round((Math.atan2(-Math.sin(p.aim), Math.abs(Math.cos(p.aim))) * 180) / Math.PI);
    this.set('angle', elev, (v) => (e.angle.textContent = `${v}°`));
    const power = p.weapon.fixedPower ? 1 : p.power;
    this.set('power', Math.round(power * 100), (v) => (e.power.style.width = `${v}%`));
    this.set('energy', Math.round((p.energy / PLAYER.maxEnergy) * 100), (v) => (e.energy.style.width = `${v}%`));

    const w = p.weapon;
    this.set('wname', w.name, (v) => (e.weaponName.textContent = v));
    this.set('wdesc', w.desc, (v) => (e.weaponDesc.textContent = v));
    const locked = p.isAI || tm.phase !== 'aim' || game.over;
    this.set('locked', locked, (v) => e.weapons.classList.toggle('locked', v));
    e.slots.forEach((el, i) => {
      const ammo = p.inventory[WEAPONS[i].id];
      this.set(`ammo${i}`, ammo, (v) => {
        el.querySelector('.slot-ammo').textContent = v === Infinity ? '∞' : v;
        el.classList.toggle('empty', v <= 0);
      });
      this.set(`sel${i}`, i === p.weaponIndex, (v) => el.classList.toggle('selected', v));
    });

    game.players.forEach((pl, i) => {
      const row = e.rows[i];
      this.set(`hp${i}`, pl.alive ? pl.hp : 0, (v) => {
        const k = v / pl.maxHp;
        const bar = row.querySelector('.roster-hp i');
        bar.style.width = `${k * 100}%`;
        bar.style.background = k > 0.5 ? '#5ee05e' : k > 0.25 ? '#ffd23f' : '#ff4d4d';
      });
      this.set(`dead${i}`, !pl.alive, (v) => row.classList.toggle('dead', v));
      this.set(`act${i}`, pl === p, (v) => row.classList.toggle('active', v));
    });
  }

  banner(title, color, sub = '') {
    const e = this.els;
    if (!e) return;
    e.bannerTitle.textContent = title;
    e.bannerTitle.style.color = color;
    e.bannerSub.textContent = sub;
    e.banner.classList.remove('show');
    void e.banner.offsetWidth; // restart the CSS animation
    e.banner.classList.add('show');
  }

  toast(msg) {
    if (!this.els) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this.els.toasts.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }
}
