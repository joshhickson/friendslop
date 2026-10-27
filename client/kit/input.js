// Keyboard + mouse input with pointer lock, for any game.
//
//   const input = new Input(api, canvas);
//   if (input.down('KeyW')) ...          // held this frame (uses KeyboardEvent.code)
//   if (input.pressed('Space')) ...      // went down since last endFrame()
//   const { dx, dy } = input.consumeMouse();
//   input.endFrame();                    // call once at the end of each frame
//
// Keys are ignored while the player is typing in chat or a framework menu is open.

import { isTyping } from '../js/dom.js';

export class Input {
  /**
   * @param {object} api  the game api (used to know when menus/chat are open)
   * @param {HTMLElement} target  element that captures the pointer on click
   * @param {{ pointerLock?: boolean }} opts
   */
  constructor(api, target, { pointerLock = true } = {}) {
    this.api = api;
    this.target = target;
    this.pointerLock = pointerLock;
    this.keys = new Set();
    this.justPressed = new Set();
    this.buttons = new Set();
    this.justClicked = new Set();
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0 };
    this.wheel = 0;
    this.listeners = [];

    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this.listeners.push(() => el.removeEventListener(type, fn, opts));
    };

    on(window, 'keydown', (e) => {
      if (this.blocked) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
    });
    on(window, 'blur', () => this.releaseAll());
    on(target, 'mousedown', (e) => {
      if (this.blocked) return;
      if (this.pointerLock && !this.locked) {
        this.lock();
        return; // the click that grabs the mouse shouldn't also fire
      }
      this.buttons.add(e.button);
      this.justClicked.add(e.button);
    });
    on(window, 'mouseup', (e) => this.buttons.delete(e.button));
    on(window, 'mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.pointerLock && !this.locked) return;
      if (this.blocked) return;
      const mx = e.movementX ?? 0;
      const my = e.movementY ?? 0;
      // Browsers sometimes report one huge bogus jump right after locking; drop it.
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
      this.mouse.dx += mx;
      this.mouse.dy += my;
    });
    on(target, 'wheel', (e) => {
      if (!this.blocked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    on(target, 'contextmenu', (e) => e.preventDefault());
    on(document, 'pointerlockchange', () => {
      if (!this.locked) this.releaseAll();
    });
    this.listeners.push(api.ui.on('resume', () => this.lock()));
  }

  get locked() {
    return document.pointerLockElement === this.target;
  }

  /** True when input should be ignored (chat open, menu open, typing). */
  get blocked() {
    return this.api.ui.isBlocking() || isTyping();
  }

  lock() {
    if (!this.pointerLock || this.locked || this.api.ui.isBlocking()) return;
    try {
      const p = this.target.requestPointerLock({ unadjustedMovement: true });
      // Some browsers reject unadjustedMovement; retry without it.
      p?.catch?.(() => this.target.requestPointerLock()?.catch?.(() => {}));
    } catch {
      /* ignore */
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  down(code) {
    return !this.blocked && this.keys.has(code);
  }

  pressed(code) {
    return !this.blocked && this.justPressed.has(code);
  }

  mouseDown(button = 0) {
    return !this.blocked && this.buttons.has(button);
  }

  clicked(button = 0) {
    return !this.blocked && this.justClicked.has(button);
  }

  /** Returns mouse movement since the last call and resets it. */
  consumeMouse() {
    const { dx, dy } = this.mouse;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return { dx, dy };
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Movement axes from WASD / arrows: { x: -1..1 (right), z: -1..1 (forward) } */
  axes() {
    const x = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    const z = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0);
    return { x, z };
  }

  releaseAll() {
    this.keys.clear();
    this.buttons.clear();
  }

  endFrame() {
    this.justPressed.clear();
    this.justClicked.clear();
  }

  destroy() {
    this.unlock();
    for (const off of this.listeners) off();
    this.listeners = [];
  }
}
