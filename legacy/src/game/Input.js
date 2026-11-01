const BLOCKED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Raw keyboard/mouse state. Edge-triggered events are cleared at the end of every frame. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0 };
    this.click = false;
    this.wheel = 0;
    this.lastWheel = 0;
    this.drag = null;
    this.dragDelta = { x: 0, y: 0 };

    const typing = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    this.handlers = {
      keydown: (e) => {
        if (typing(e)) return;
        if (BLOCKED.has(e.code)) e.preventDefault();
        if (!this.keys.has(e.code)) this.pressed.add(e.code);
        this.keys.add(e.code);
      },
      keyup: (e) => this.keys.delete(e.code),
      blur: () => this.keys.clear(),
      mousemove: (e) => {
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        if (this.drag) {
          this.dragDelta.x += x - this.mouse.x;
          this.dragDelta.y += y - this.mouse.y;
        }
        this.mouse.x = x;
        this.mouse.y = y;
      },
      mouseup: (e) => {
        if (e.button === 2) this.drag = null;
      },
    };
    this.canvasHandlers = {
      mousedown: (e) => {
        if (e.button === 0) this.click = true;
        if (e.button === 2) this.drag = true;
      },
      wheel: (e) => {
        e.preventDefault();
        const now = performance.now();
        if (now - this.lastWheel < 110 || e.deltaY === 0) return;
        this.lastWheel = now;
        this.wheel = Math.sign(e.deltaY);
      },
      contextmenu: (e) => e.preventDefault(),
    };
    for (const [k, fn] of Object.entries(this.handlers)) window.addEventListener(k, fn);
    for (const [k, fn] of Object.entries(this.canvasHandlers)) canvas.addEventListener(k, fn, { passive: k !== 'wheel' });
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  consumeDrag() {
    const d = { ...this.dragDelta };
    this.dragDelta.x = 0;
    this.dragDelta.y = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.click = false;
    this.wheel = 0;
  }
}
