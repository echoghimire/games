import type { FighterConfig } from '../characters/FighterConfig';
import { keyLabel, PLAYER1_KEYS, PLAYER2_KEYS, type KeyBinding } from '../input/KeyBindings';
import { el } from './dom';

export interface MenuCallbacks {
  onStart(p1: FighterConfig, p2: FighterConfig): void;
  onNavigate(): void;
  onHostOnline(): void;
  onJoinOnline(code: string): void;
}

/** Title screen with fighter cards (selectable from the roster) and START FIGHT. */
export class MenuScreen {
  readonly root: HTMLDivElement;
  private readonly picks: [number, number] = [0, 1];
  private readonly cards: HTMLDivElement[] = [];
  private readonly startButton: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly roster: readonly FighterConfig[],
    private readonly callbacks: MenuCallbacks,
  ) {
    this.root = el('div', 'screen menu', '', parent);
    const title = el('div', 'menu__title', '', this.root);
    el('div', 'menu__kicker', 'A BRUTAL ARCADE FIGHTER', title);
    el('h1', 'menu__logo', 'IRON ARENA', title);
    el('div', 'menu__heading', 'FIGHTERS', this.root);

    const versus = el('div', 'menu__versus', '', this.root);
    this.cards.push(this.buildCard(versus, 0));
    el('div', 'menu__vs', 'VS', versus);
    this.cards.push(this.buildCard(versus, 1));

    this.startButton = el('button', 'btn btn--primary', 'LOCAL VERSUS', this.root);
    this.startButton.addEventListener('click', () => this.start());

    // Online play: host a room or join one with its 6-letter code.
    const online = el('div', 'menu__online', '', this.root);
    const host = el('button', 'btn', 'HOST ONLINE MATCH', online);
    host.addEventListener('click', () => callbacks.onHostOnline());
    const join = el('form', 'menu__join', '', online);
    const code = el('input', 'menu__code', '', join);
    code.placeholder = 'CODE';
    code.maxLength = 6;
    code.autocomplete = 'off';
    code.spellcheck = false;
    el('button', 'btn', 'JOIN', join);
    join.addEventListener('submit', (e) => {
      e.preventDefault();
      if (code.value.trim()) callbacks.onJoinOnline(code.value);
    });

    const controls = el('div', 'menu__controls', '', this.root);
    this.buildControls(controls, 'PLAYER 1', PLAYER1_KEYS);
    this.buildControls(controls, 'PLAYER 2', PLAYER2_KEYS);
    el(
      'div',
      'menu__hint',
      'Double-tap forward/back to dash · Down + attack for low moves · Combos: Light, Light, Heavy/Kick · F1 hitboxes',
      this.root,
    );
    const back = el('a', 'menu__back', '← Back to the arena', this.root);
    back.href = '/';

    window.addEventListener('keydown', this.onKey);
    this.refresh();
  }

  private buildCard(parent: HTMLElement, slot: 0 | 1): HTMLDivElement {
    const card = el('div', `card card--p${slot + 1}`, '', parent);
    el('div', 'card__slot', `PLAYER ${slot + 1}`, card);
    el('div', 'card__name', '', card);
    el('div', 'card__title', '', card);
    const nav = el('div', 'card__nav', '', card);
    const prev = el('button', 'card__arrow', '◀', nav);
    const next = el('button', 'card__arrow', '▶', nav);
    const cycle = (d: number): void => {
      const n = this.roster.length;
      this.picks[slot] = (this.picks[slot] + d + n) % n;
      this.callbacks.onNavigate();
      this.refresh();
    };
    prev.addEventListener('click', () => cycle(-1));
    next.addEventListener('click', () => cycle(1));
    return card;
  }

  private buildControls(parent: HTMLElement, label: string, keys: KeyBinding): void {
    const box = el('div', 'controls', '', parent);
    el('div', 'controls__title', label, box);
    const rows: Array<[string, readonly string[]]> = [
      ['Move', [...keys.Left, ...keys.Right].slice(0, 2)],
      ['Jump / Crouch', [keys.Up[0] ?? '', keys.Down[0] ?? '']],
      ['Light · Heavy · Kick', [keys.Light[0] ?? '', keys.Heavy[0] ?? '', keys.Kick[0] ?? '']],
      ['Block · Grab', [keys.Block[0] ?? '', keys.Grab[0] ?? '']],
    ];
    for (const [name, codes] of rows) {
      const row = el('div', 'controls__row', '', box);
      el('span', 'controls__name', name, row);
      const k = el('span', 'controls__keys', '', row);
      for (const code of codes) el('kbd', '', keyLabel(code), k);
    }
  }

  private refresh(): void {
    this.cards.forEach((card, i) => {
      const cfg = this.roster[this.picks[i as 0 | 1]];
      if (!cfg) return;
      const name = card.querySelector('.card__name');
      const title = card.querySelector('.card__title');
      if (name) name.textContent = cfg.name;
      if (title) title.textContent = cfg.title;
      card.style.setProperty('--accent', cfg.visual.accentColor);
    });
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return; // typing a room code
    if (this.root.classList.contains('screen--visible') && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      this.start();
    }
  };

  private start(): void {
    const a = this.roster[this.picks[0]];
    const b = this.roster[this.picks[1]];
    if (a && b) this.callbacks.onStart(a, b);
  }

  show(visible: boolean): void {
    this.root.classList.toggle('screen--visible', visible);
    if (visible) this.startButton.focus({ preventScroll: true });
  }
}
