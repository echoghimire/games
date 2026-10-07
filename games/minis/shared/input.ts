/** Keyboard, hold/tap (mouse, touch, Space) and a touch joystick. */

export class Keys {
  private readonly down = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  held(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** WASD / arrows as a vector (x right, y down), length ≤ 1. */
  axis(): { x: number; y: number } {
    const x = (this.held('KeyD', 'ArrowRight') ? 1 : 0) - (this.held('KeyA', 'ArrowLeft') ? 1 : 0);
    const y = (this.held('KeyS', 'ArrowDown') ? 1 : 0) - (this.held('KeyW', 'ArrowUp') ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }
}

/**
 * "Hold" input: mouse button, finger or Space held anywhere on `target`.
 * `onPress` fires on every new press (used as a tap).
 */
export class Hold {
  held = false;
  private pointers = 0;
  private space = false;

  constructor(target: HTMLElement, onPress?: () => void) {
    const update = (): void => {
      const now = this.pointers > 0 || this.space;
      if (now && !this.held) onPress?.();
      this.held = now;
    };
    target.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, a, input')) return;
      e.preventDefault();
      this.pointers++;
      update();
    });
    const up = (): void => {
      this.pointers = Math.max(0, this.pointers - 1);
      update();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.space = true;
        update();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.space = false;
        update();
      }
    });
    window.addEventListener('blur', () => {
      this.pointers = 0;
      this.space = false;
      update();
    });
  }
}

export const isTouch = (): boolean => matchMedia('(pointer: coarse)').matches;

/** On-screen joystick for touch devices (bottom-left). */
export class Stick {
  readonly root: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  x = 0;
  y = 0;
  private id: number | null = null;
  private cx = 0;
  private cy = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'stick__knob';
    this.root.append(this.knob);
    parent.append(this.root);
    const R = 50;
    this.root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.id = e.pointerId;
      const r = this.root.getBoundingClientRect();
      this.cx = r.left + r.width / 2;
      this.cy = r.top + r.height / 2;
      try {
        this.root.setPointerCapture(e.pointerId);
      } catch {
        // synthetic or already-released pointer
      }
      this.move(e.clientX, e.clientY, R);
    });
    this.root.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.id) this.move(e.clientX, e.clientY, R);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.id) return;
      this.id = null;
      this.x = this.y = 0;
      this.knob.style.transform = '';
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
  }

  private move(px: number, py: number, R: number): void {
    let dx = px - this.cx;
    let dy = py - this.cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    this.x = dx / R;
    this.y = dy / R;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
