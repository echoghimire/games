import { el } from './dom';

export interface ResultCallbacks {
  onRematch(): void;
  onMenu(): void;
}

/** Victory / defeat overlay shown when the match ends. */
export class ResultScreen {
  readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly rematch: HTMLButtonElement;

  constructor(parent: HTMLElement, callbacks: ResultCallbacks) {
    this.root = el('div', 'screen result', '', parent);
    this.title = el('div', 'result__title', '', this.root);
    this.sub = el('div', 'result__sub', '', this.root);
    const buttons = el('div', 'result__buttons', '', this.root);
    this.rematch = el('button', 'btn btn--primary', 'REMATCH', buttons);
    const menu = el('button', 'btn', 'MAIN MENU', buttons);
    el('div', 'menu__hint', 'Enter: rematch · Esc: menu', this.root);
    this.rematch.addEventListener('click', () => callbacks.onRematch());
    menu.addEventListener('click', () => callbacks.onMenu());
    window.addEventListener('keydown', (e) => {
      if (!this.root.classList.contains('screen--visible')) return;
      if (e.code === 'Enter') callbacks.onRematch();
      if (e.code === 'Escape') callbacks.onMenu();
    });
  }

  show(visible: boolean, title = '', sub = '', accent = '#f2c45a'): void {
    this.title.textContent = title;
    this.sub.textContent = sub;
    this.root.style.setProperty('--accent', accent);
    this.root.classList.toggle('screen--visible', visible);
    if (visible) this.rematch.focus({ preventScroll: true });
  }
}
