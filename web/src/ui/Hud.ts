import { RULES, TEAM_COLORS, WEAPONS, weaponById } from '@wildlings/shared';
import type { Session } from '../game/view.ts';
import type { BattleScene } from '../game/BattleScene.ts';
import { art } from '../game/art.ts';
import { esc } from './dom.ts';

const C = RULES.character;

/** DOM overlay for in-match information. Only touches the DOM when values change. */
export class Hud {
  private root: HTMLElement;
  private cache = new Map<string, unknown>();
  private els: Record<string, HTMLElement> = {};
  private rows: HTMLElement[] = [];
  private slotsEl: HTMLElement[] = [];
  private uiWeapon: string | null = null;
  onPause: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
  }

  attach(session: Session): void {
    this.cache.clear();
    const w = session.world;
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
          <div class="hud-card hud-roster">${w.characters
            .map((c, i) => {
              const s = session.slots[i];
              const tag = s.kind === 'bot' ? ` <em>bot</em>` : s.kind === 'remote' ? ` <em>${esc(s.detail ?? '')}</em>` : '';
              return `<div class="roster-row" data-slot="${i}"><span class="roster-dot" style="background:${TEAM_COLORS[c.team % 4]}"></span><span class="roster-name">${esc(c.name)}${tag}</span><span class="roster-hp"><i></i></span><b class="roster-num"></b></div>`;
            })
            .join('')}</div>
          <button class="hud-btn hud-pause" title="Menu (Esc)" aria-label="Pause menu">❚❚</button>
        </div>
      </div>
      <div class="hud-status"></div>
      <div class="hud-banner"><div class="banner-title"></div><div class="banner-sub"></div></div>
      <div class="hud-toasts"></div>
      <div class="hud-bottom">
        <div class="hud-card hud-stats">
          <div class="stat"><span class="hud-label">Angle</span><b class="stat-angle"></b></div>
          <div class="stat stat-bar"><span class="hud-label">Power</span><div class="bar"><i class="bar-power"></i></div><b class="stat-power"></b></div>
          <div class="stat stat-bar"><span class="hud-label">Move</span><div class="bar"><i class="bar-energy"></i></div></div>
        </div>
        <div class="hud-weapons-wrap">
          <div class="weapon-info"><b></b><span></span></div>
          <div class="hud-card hud-weapons">${WEAPONS.map(
            (wp, i) => `<button class="slot" data-id="${wp.id}" title="${esc(wp.name)} (${i + 1})"><img alt="" src="${art.url(`icon_${wp.id}`)}"><span class="slot-key">${i + 1}</span><span class="slot-ammo"></span><span class="slot-cd"></span></button>`,
          ).join('')}</div>
        </div>
        <div class="hud-help">A/D walk · W climb · S steady aim · Space jump · Mouse aim · Click fire · E/Q or wheel weapons · Right-drag pan · +/- zoom</div>
      </div>`;
    this.root.classList.add('visible');
    const q = (s: string) => this.root.querySelector<HTMLElement>(s)!;
    this.els = {
      dot: q('.turn-dot'), name: q('.turn-name'), sub: q('.turn-sub'), timer: q('.turn-timer'), timerText: q('.turn-timer span'),
      ring: q('.ring'), windFill: q('.wind-fill'), windValue: q('.wind-value'), angle: q('.stat-angle'), power: q('.bar-power'),
      powerNum: q('.stat-power'), energy: q('.bar-energy'), weaponName: q('.weapon-info b'), weaponDesc: q('.weapon-info span'),
      weapons: q('.hud-weapons'), banner: q('.hud-banner'), bannerTitle: q('.banner-title'), bannerSub: q('.banner-sub'),
      toasts: q('.hud-toasts'), status: q('.hud-status'), stats: q('.hud-stats'),
    };
    this.rows = [...this.root.querySelectorAll<HTMLElement>('.roster-row')];
    this.slotsEl = [...this.root.querySelectorAll<HTMLElement>('.slot')];
    for (const el of this.slotsEl) el.addEventListener('click', () => (this.uiWeapon = el.dataset.id!));
    q('.hud-pause').addEventListener('click', () => this.onPause());
  }

  detach(): void {
    this.root.innerHTML = '';
    this.root.classList.remove('visible');
  }

  takeUiWeapon(): string | null {
    const w = this.uiWeapon;
    this.uiWeapon = null;
    return w;
  }

  private set(key: string, value: unknown, apply: (v: never) => void): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply(value as never);
  }

  update(session: Session, scene: BattleScene): void {
    const w = session.world;
    const p = w.characters[w.activeSlot];
    if (!p) return;
    const e = this.els;
    const mine = session.controlledSlot() === p.slot;
    const local = mine ? scene.input2.aim : null;
    const info = session.slots[p.slot];

    this.set('dot', TEAM_COLORS[p.team % 4], (v: string) => (e.dot.style.background = v));
    this.set('name', p.name, (v: string) => (e.name.textContent = v));
    let sub = mine ? 'Your move!' : info.kind === 'bot' ? `Bot (${info.detail}) is thinking…` : info.kind === 'remote' ? 'Opponent is playing…' : 'Get ready!';
    if (w.phase === 'over') sub = 'Match over';
    else if (w.phase === 'action' || w.phase === 'settle') sub = 'Resolving…';
    else if (w.phase === 'start') sub = mine ? 'Get ready!' : sub;
    this.set('sub', sub, (v: string) => (e.sub.textContent = v));

    const total = w.settings.turnTime;
    const tl = w.timeLeft;
    const timerText = tl === Infinity || !total ? '∞' : String(Math.ceil(tl));
    this.set('timer', timerText, (v: string) => (e.timerText.textContent = v));
    const frac = tl === Infinity || !total ? 1 : Math.max(0, tl / total);
    this.set('ring', Math.round(frac * 200), () => (e.ring.style.strokeDashoffset = String(106.8 * (1 - frac))));
    this.set('low', w.phase === 'aim' && tl <= 5, (v: boolean) => e.timer.classList.toggle('low', v));

    this.set('wind', w.wind, (v: number) => {
      const pct = Math.min(50, (Math.abs(v) / 2) * 50);
      e.windFill.style.width = `${pct}%`;
      e.windFill.style.left = v < 0 ? `${50 - pct}%` : '50%';
      const n = Math.round(Math.abs(v) * 10);
      e.windValue.textContent = n === 0 ? 'Calm' : `${v < 0 ? '◀ ' : ''}${n}${v > 0 ? ' ▶' : ''}`;
    });

    const aim = local ? local.angle : p.aim;
    const weaponId = local ? local.weaponId : p.weaponId;
    const weapon = weaponById(weaponId) ?? WEAPONS[0];
    const elev = Math.round((Math.atan2(-Math.sin(aim), Math.abs(Math.cos(aim))) * 180) / Math.PI);
    this.set('angle', elev, (v: number) => (e.angle.textContent = `${v}°`));
    const power = weapon.fixedPower ? 1 : local ? local.power : p.power;
    this.set('power', Math.round(power * 100), (v: number) => {
      e.power.style.width = `${v}%`;
      e.powerNum.textContent = `${v}`;
    });
    this.set('energy', Math.round((p.energy / C.maxEnergy) * 100), (v: number) => (e.energy.style.width = `${v}%`));
    this.set('wname', weapon.name, (v: string) => (e.weaponName.textContent = v));
    this.set('wdesc', weapon.desc, (v: string) => (e.weaponDesc.textContent = v));
    const locked = !mine || w.phase !== 'aim';
    this.set('locked', locked, (v: boolean) => {
      e.weapons.classList.toggle('locked', v);
      e.stats.classList.toggle('locked', v);
    });
    for (const el of this.slotsEl) {
      const id = el.dataset.id!;
      const ammo = p.inventory[id];
      const cd = p.cooldowns[id] ?? 0;
      this.set(`ammo${id}`, ammo, (v: number) => {
        el.querySelector('.slot-ammo')!.textContent = v < 0 ? '∞' : String(v);
        el.classList.toggle('empty', v === 0);
      });
      this.set(`cd${id}`, cd, (v: number) => {
        el.querySelector('.slot-cd')!.textContent = v > 0 ? String(v) : '';
        el.classList.toggle('cooling', v > 0);
      });
      this.set(`sel${id}`, id === weaponId, (v: boolean) => el.classList.toggle('selected', v));
    }

    w.characters.forEach((c, i) => {
      const row = this.rows[i];
      if (!row) return;
      this.set(`hp${i}`, c.alive ? c.hp : 0, (v: number) => {
        const k = v / c.maxHp;
        const bar = row.querySelector<HTMLElement>('.roster-hp i')!;
        bar.style.width = `${k * 100}%`;
        bar.style.background = k > 0.5 ? '#5ee05e' : k > 0.25 ? '#ffd23f' : '#ff4d4d';
        row.querySelector('.roster-num')!.textContent = String(v);
      });
      this.set(`dead${i}`, !c.alive, (v: boolean) => row.classList.toggle('dead', v));
      this.set(`act${i}`, c === p, (v: boolean) => row.classList.toggle('active', v));
      this.set(`conn${i}`, session.slots[i].connected, (v: boolean) => row.classList.toggle('offline', !v));
    });
    this.set('status', session.status() ?? '', (v: string) => {
      e.status.textContent = v;
      e.status.classList.toggle('show', !!v);
    });
  }

  banner(title: string, color: string, sub = ''): void {
    const e = this.els;
    if (!e.banner) return;
    e.bannerTitle.textContent = title;
    e.bannerTitle.style.color = color;
    e.bannerSub.textContent = sub;
    e.banner.classList.remove('show');
    void e.banner.offsetWidth;
    e.banner.classList.add('show');
  }

  toast(msg: string): void {
    if (!this.els.toasts) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this.els.toasts.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }
}
