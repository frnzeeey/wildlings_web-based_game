import { PLAYER } from './config.js';
import { emptyIntents } from './Intents.js';
import { clamp } from './utils.js';

/** Turns keyboard + mouse state into intents for the local player whose turn it is. */
export class HumanController {
  constructor(input) {
    this.input = input;
    this.isAI = false;
  }

  beginTurn() {}

  getIntents(dt, game, player) {
    const i = this.input;
    const it = emptyIntents();
    it.move = (i.isDown('KeyD') || i.isDown('ArrowRight') ? 1 : 0) - (i.isDown('KeyA') || i.isDown('ArrowLeft') ? 1 : 0);
    it.jump = i.wasPressed('KeyW') || i.wasPressed('Space') || i.wasPressed('ArrowUp');
    it.crouch = i.isDown('KeyS') || i.isDown('ArrowDown');

    const m = game.camera.screenToWorld(i.mouse.x, i.mouse.y);
    it.target = m;
    const dx = m.x - player.x;
    const dy = m.y - player.y;
    it.aim = Math.atan2(dy, dx);
    it.power = clamp(Math.hypot(dx, dy) / PLAYER.maxAimDistance, 0.1, 1);

    it.fire = i.click;
    it.weaponDelta = i.wheel;
    for (let n = 1; n <= 9; n++) if (i.wasPressed(`Digit${n}`)) it.selectIndex = n - 1;
    return it;
  }
}
