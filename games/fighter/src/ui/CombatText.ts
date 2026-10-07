import { el, replayClass } from './dom';

export type PopupKind = 'damage' | 'block' | 'counter' | 'throw';

interface Popup {
  node: HTMLDivElement;
  life: number;
  x: number;
  y: number;
}

const POOL_SIZE = 16;
const POPUP_LIFE = 0.9;

/** Floating combat text (damage numbers, BLOCK, COUNTER) anchored to screen points. Pooled. */
export class CombatText {
  private readonly pool: Popup[] = [];
  private next = 0;

  constructor(parent: HTMLElement) {
    const layer = el('div', 'popups', '', parent);
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({ node: el('div', 'popup', '', layer), life: 0, x: 0, y: 0 });
    }
  }

  spawn(kind: PopupKind, text: string, screenX: number, screenY: number): void {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % POOL_SIZE;
    if (!p) return;
    p.life = POPUP_LIFE;
    p.x = screenX + (Math.random() - 0.5) * 30;
    p.y = screenY;
    p.node.textContent = text;
    p.node.className = `popup popup--${kind}`;
    replayClass(p.node, 'popup--in');
    this.place(p);
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.y -= dt * 60;
      if (p.life <= 0) p.node.classList.remove('popup--in');
      this.place(p);
    }
  }

  private place(p: Popup): void {
    p.node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
  }
}

/** "3 HITS" counter on one side of the screen, with combo name. */
export class ComboCounter {
  private readonly root: HTMLDivElement;
  private readonly count: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private visibleFor = 0;

  constructor(parent: HTMLElement, side: 'left' | 'right') {
    this.root = el('div', `combo combo--${side}`, '', parent);
    this.count = el('div', 'combo__count', '', this.root);
    el('div', 'combo__label', 'HITS', this.root);
    this.name = el('div', 'combo__name', '', this.root);
  }

  show(hits: number, comboName: string | null): void {
    if (hits < 2 && !comboName) return;
    this.count.textContent = String(hits);
    if (comboName) {
      this.name.textContent = comboName;
      replayClass(this.name, 'combo__name--in');
    }
    replayClass(this.root, 'combo--in');
    this.visibleFor = 1.6;
  }

  update(dt: number): void {
    if (this.visibleFor <= 0) return;
    this.visibleFor -= dt;
    if (this.visibleFor <= 0) {
      this.root.classList.remove('combo--in');
      this.name.classList.remove('combo__name--in');
    }
  }

  clear(): void {
    this.visibleFor = 0;
    this.root.classList.remove('combo--in');
  }
}
