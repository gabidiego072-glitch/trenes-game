// Entrada: teclado (A/D, flechas), táctil y ratón (mantener pulsado a un lado de la pantalla).
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pointers = new Map();
    this.handlers = {};
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.emit('key', e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointers.clear();
    });
    const down = (e) => {
      this.pointers.set(e.pointerId, e.clientX);
    };
    const move = (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, e.clientX);
    };
    const up = (e) => this.pointers.delete(e.pointerId);
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // botones táctiles en pantalla
    this.touchLeft = false;
    this.touchRight = false;
    const bind = (id, prop) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (e) => {
        e.preventDefault();
        this[prop] = true;
        el.classList.add('on');
      };
      const off = (e) => {
        e.preventDefault();
        this[prop] = false;
        el.classList.remove('on');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('pointercancel', off);
    };
    bind('tl', 'touchLeft');
    bind('tr', 'touchRight');
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }
  emit(name, arg) {
    if (this.handlers[name]) this.handlers[name](arg);
  }

  /** -1 = izquierda, +1 = derecha. */
  get steer() {
    if (this.forced !== undefined) return this.forced;
    let s = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) s -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) s += 1;
    if (this.touchLeft) s -= 1;
    if (this.touchRight) s += 1;
    const w = window.innerWidth;
    for (const x of this.pointers.values()) {
      // zona muerta en el centro; cuanto más al borde, más gira
      const u = (x / w) * 2 - 1;
      if (Math.abs(u) > 0.12) s += Math.sign(u) * Math.min(1, (Math.abs(u) - 0.12) / 0.5);
    }
    return Math.max(-1, Math.min(1, s));
  }
}
