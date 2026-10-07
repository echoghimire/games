import type { FighterConfig } from '../characters/FighterConfig';
import { el } from './dom';

export interface OnlineScreenCallbacks {
  onPick(delta: number): void;
  onReady(): void;
  onLeave(): void;
}

/** Online lobby: room code + invite link, both players' fighters and ready state. */
export class OnlineScreen {
  readonly root: HTMLDivElement;
  private readonly code: HTMLDivElement;
  private readonly copy: HTMLButtonElement;
  private readonly status: HTMLDivElement;
  private readonly cards: [HTMLDivElement, HTMLDivElement];
  private readonly arrows: HTMLDivElement;
  private readonly readyButton: HTMLButtonElement;
  private link = '';

  constructor(parent: HTMLElement, callbacks: OnlineScreenCallbacks) {
    this.root = el('div', 'screen online', '', parent);
    const title = el('div', 'menu__title', '', this.root);
    el('div', 'menu__kicker', 'ONLINE MATCH', title);
    const codeRow = el('div', 'online__coderow', '', title);
    el('span', 'online__label', 'ROOM', codeRow);
    this.code = el('div', 'online__code', '', codeRow);
    this.copy = el('button', 'btn btn--small', 'COPY INVITE LINK', codeRow);
    this.copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.link).then(() => {
        this.copy.textContent = 'COPIED';
        setTimeout(() => (this.copy.textContent = 'COPY INVITE LINK'), 1500);
      });
    });

    const versus = el('div', 'menu__versus', '', this.root);
    const mine = el('div', 'card card--p1', '', versus);
    el('div', 'card__slot', 'YOU', mine);
    el('div', 'card__name', '', mine);
    el('div', 'card__title', '', mine);
    this.arrows = el('div', 'card__nav', '', mine);
    const prev = el('button', 'card__arrow', '◀', this.arrows);
    const next = el('button', 'card__arrow', '▶', this.arrows);
    prev.addEventListener('click', () => callbacks.onPick(-1));
    next.addEventListener('click', () => callbacks.onPick(1));
    el('div', 'card__ready', '', mine);
    el('div', 'menu__vs', 'VS', versus);
    const theirs = el('div', 'card card--p2', '', versus);
    el('div', 'card__slot', 'OPPONENT', theirs);
    el('div', 'card__name', '', theirs);
    el('div', 'card__title', '', theirs);
    el('div', 'card__ready', '', theirs);
    this.cards = [mine, theirs];

    this.status = el('div', 'online__status', '', this.root);
    const buttons = el('div', 'result__buttons', '', this.root);
    this.readyButton = el('button', 'btn btn--primary', 'READY', buttons);
    this.readyButton.addEventListener('click', () => callbacks.onReady());
    const leave = el('button', 'btn', 'LEAVE', buttons);
    leave.addEventListener('click', () => callbacks.onLeave());
    el(
      'div',
      'menu__hint',
      'Online you control your fighter with either key set: A/D/W/S + J K L I U, or arrows + 1 2 3 5 4.',
      this.root,
    );
  }

  setRoom(code: string, link: string): void {
    this.code.textContent = code;
    this.link = link;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  /** `slot` 0 is you, 1 is your opponent. A null fighter shows an empty card. */
  setCard(slot: 0 | 1, cfg: FighterConfig | null, name: string, ready: boolean): void {
    const card = this.cards[slot];
    card.querySelector('.card__slot')!.textContent = name;
    card.querySelector('.card__name')!.textContent = cfg ? cfg.name : '…';
    card.querySelector('.card__title')!.textContent = cfg ? cfg.title : 'Waiting for a challenger';
    card.querySelector('.card__ready')!.textContent = ready ? 'READY' : '';
    card.classList.toggle('card--ready', ready);
    if (cfg) card.style.setProperty('--accent', cfg.visual.accentColor);
  }

  setReadyButton(label: string, enabled: boolean): void {
    this.readyButton.textContent = label;
    this.readyButton.disabled = !enabled;
  }

  setPickEnabled(enabled: boolean): void {
    this.arrows.style.visibility = enabled ? 'visible' : 'hidden';
  }

  show(visible: boolean): void {
    this.root.classList.toggle('screen--visible', visible);
  }
}
