// Keyboard, mouse (pointer lock with a drag fallback) and touch input.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since last frame
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.dragging = false;
    this.enabled = false;
    this.touchMove = { x: 0, y: 0, active: false };
    this.sensitivity = 0.0022;
    this.invertY = false;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
      this.onLockChange?.(false);
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.dragging) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) this.dragging = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });

    // Touch: left half = move stick, right half = look.
    this.touches = new Map();
    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (!this.enabled) return;
        for (const t of e.changedTouches) {
          const left = t.clientX < window.innerWidth * 0.45;
          this.touches.set(t.identifier, { x: t.clientX, y: t.clientY, ox: t.clientX, oy: t.clientY, left });
        }
        e.preventDefault();
      },
      { passive: false },
    );
    canvas.addEventListener(
      'touchmove',
      (e) => {
        for (const t of e.changedTouches) {
          const st = this.touches.get(t.identifier);
          if (!st) continue;
          if (st.left) {
            this.touchMove.x = Math.max(-1, Math.min(1, (t.clientX - st.ox) / 50));
            this.touchMove.y = Math.max(-1, Math.min(1, (t.clientY - st.oy) / 50));
            this.touchMove.active = true;
          } else {
            this.dx += (t.clientX - st.x) * 1.6;
            this.dy += (t.clientY - st.y) * 1.6;
          }
          st.x = t.clientX;
          st.y = t.clientY;
        }
        e.preventDefault();
      },
      { passive: false },
    );
    const end = (e) => {
      for (const t of e.changedTouches) {
        const st = this.touches.get(t.identifier);
        if (st && st.left) {
          this.touchMove.x = 0;
          this.touchMove.y = 0;
          this.touchMove.active = false;
        }
        this.touches.delete(t.identifier);
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => (this.lockFailed = true));
    } catch {
      this.lockFailed = true;
    }
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  consumeLook() {
    const r = [this.dx * this.sensitivity, this.dy * this.sensitivity * (this.invertY ? -1 : 1)];
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  endFrame() {
    this.pressed.clear();
  }
}
