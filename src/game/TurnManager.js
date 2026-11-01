import { PLAYER, WIND_LEVELS } from './config.js';

/**
 * Turn flow:  start (banner) -> aim (move/aim/fire, timer runs) -> action (wait for
 * projectiles and bodies to settle) -> settle (resolve KOs) -> next turn / game over.
 */
export class TurnManager {
  constructor(game) {
    this.game = game;
    this.index = -1;
    this.turnNumber = 0;
    this.phase = 'idle';
    this.elapsed = 0;
    this.calm = 0;
    this.timeLeft = Infinity;
    this.active = null;
  }

  setPhase(phase) {
    this.phase = phase;
    this.elapsed = 0;
    this.calm = 0;
  }

  nextTurn() {
    const g = this.game;
    const ps = g.players;
    for (let k = 1; k <= ps.length; k++) {
      const i = (this.index + k) % ps.length;
      if (ps[i].alive) {
        this.index = i;
        break;
      }
    }
    const p = (this.active = ps[this.index]);
    this.turnNumber++;
    const level = WIND_LEVELS[g.settings.wind] ?? 1;
    g.wind = Math.round(g.rng.float(-1, 1) * level * 20) / 20;
    p.energy = PLAYER.maxEnergy;
    p.crouching = false;
    p.stats.turns++;
    p.ensureWeapon();
    this.timeLeft = g.settings.turnTime > 0 ? g.settings.turnTime : Infinity;
    this.lastTick = Math.ceil(this.timeLeft);
    this.setPhase('start');
    p.controller.beginTurn(g, p);
    g.onTurnStart(p);
  }

  /** Called by the game once the active player has used their attack. */
  onFired() {
    if (this.phase === 'aim') this.setPhase('action');
  }

  update(dt) {
    const g = this.game;
    this.elapsed += dt;
    switch (this.phase) {
      case 'start':
        if (this.elapsed >= 1) this.setPhase('aim');
        break;
      case 'aim': {
        const p = this.active;
        if (!p.alive || p.hp <= 0) {
          this.setPhase('action');
          break;
        }
        if (this.timeLeft !== Infinity) {
          this.timeLeft -= dt;
          const sec = Math.ceil(this.timeLeft);
          if (sec < this.lastTick) {
            this.lastTick = sec;
            if (sec <= 5 && sec > 0 && !p.isAI) g.audio.play('tick');
          }
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            g.hud.toast("Time's up!");
            this.setPhase('action');
          }
        }
        break;
      }
      case 'action':
        this.calm = g.isSettled() ? this.calm + dt : 0;
        if (this.calm >= 0.6 || this.elapsed > 15) {
          g.resolveDeaths();
          this.setPhase('settle');
        }
        break;
      case 'settle':
        if (this.elapsed >= 0.8 && (g.isSettled() || this.elapsed > 6)) {
          g.resolveDeaths();
          if (!g.checkGameOver()) this.nextTurn();
        }
        break;
    }
  }
}
