import { el, replayClass } from './dom';

/**
 * Health bar with a delayed "damage trail": the red part drains to the new
 * value after a short pause, so every hit visibly shows how much it took.
 */
export class HealthBar {
  readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly trail: HTMLDivElement;
  private shown = 1;
  private trailValue = 1;
  private trailDelay = 0;

  constructor(parent: HTMLElement, side: 'left' | 'right') {
    this.root = el('div', `health health--${side}`, '', parent);
    const frame = el('div', 'health__frame', '', this.root);
    this.trail = el('div', 'health__trail', '', frame);
    this.fill = el('div', 'health__fill', '', frame);
    el('div', 'health__shine', '', frame);
  }

  set(ratio: number, instant = false): void {
    const r = Math.max(0, Math.min(1, ratio));
    if (r < this.shown && !instant) {
      this.trailDelay = 0.45;
      replayClass(this.root, 'health--hit');
    }
    this.shown = r;
    if (instant) this.trailValue = r;
    this.root.classList.toggle('health--low', r <= 0.25);
    this.apply();
  }

  update(dt: number): void {
    if (this.trailValue <= this.shown) return;
    if (this.trailDelay > 0) {
      this.trailDelay -= dt;
      return;
    }
    this.trailValue = Math.max(this.shown, this.trailValue - dt * 0.6);
    this.apply();
  }

  private apply(): void {
    this.fill.style.transform = `scaleX(${this.shown})`;
    this.trail.style.transform = `scaleX(${this.trailValue})`;
  }
}
