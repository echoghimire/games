import { getBoard, getMe, submitScore, type Board, type Me } from './api';
import './style.css';

/** Top bar (back to the arena, game name, live HUD) and the overlay card. */
export class GameUI {
  readonly hud: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private toastTimer = 0;
  me: Me | null = null;

  constructor(
    readonly gameId: string,
    readonly title: string,
  ) {
    const bar = el('header', 'bar', document.body);
    const back = el('a', 'bar__back', bar);
    back.href = '/';
    back.innerHTML = '<img src="/logo.svg" alt="" /><span>Arena</span>';
    el('div', 'bar__title', bar).textContent = title;
    this.hud = el('div', 'bar__hud', bar);
    this.overlay = el('div', 'overlay', document.body);
    this.card = el('div', 'card', this.overlay);
    this.toastEl = el('div', 'toast', document.body);
    getMe()
      .then((m) => (this.me = m))
      .catch(() => {});
  }

  /** Show a card. `body` is trusted HTML built by the game (never user text). */
  show(opts: { kicker?: string; title: string; body?: string | HTMLElement; buttons: Button[] }): void {
    this.card.replaceChildren();
    if (opts.kicker) el('div', 'card__kicker', this.card).textContent = opts.kicker;
    el('h1', 'card__title', this.card).textContent = opts.title;
    if (typeof opts.body === 'string') el('div', 'card__body', this.card).innerHTML = opts.body;
    else if (opts.body) this.card.append(opts.body);
    const row = el('div', 'card__buttons', this.card);
    for (const b of opts.buttons) {
      const btn = el('button', b.primary ? 'btn btn--primary' : 'btn', row);
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
    }
    this.overlay.classList.add('overlay--on');
    (row.querySelector('.btn--primary') as HTMLButtonElement | null)?.focus();
  }

  hide(): void {
    this.overlay.classList.remove('overlay--on');
  }

  get visible(): boolean {
    return this.overlay.classList.contains('overlay--on');
  }

  toast(text: string, ms = 2500): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('toast--on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('toast--on'), ms);
  }

  /** Game-over card: submits the score and shows best, rank and the top 10. */
  async gameOver(score: number, opts: { title?: string; unit?: string; onRetry: () => void }): Promise<void> {
    const body = document.createElement('div');
    const big = el('div', 'score', body);
    big.textContent = String(score);
    el('div', 'score__unit', body).textContent = opts.unit ?? 'points';
    const stats = el('div', 'stats', body);
    stats.textContent = 'Saving score…';
    const list = el('ol', 'board', body);
    this.show({
      kicker: 'GAME OVER',
      title: opts.title ?? 'Nice run!',
      body,
      buttons: [
        { label: 'Play again', primary: true, onClick: opts.onRetry },
        { label: 'Back to arena', onClick: () => (location.href = '/') },
      ],
    });
    try {
      const board = await submitScore(this.gameId, score);
      renderBoard(board, stats, list, this.me?.name);
    } catch (err) {
      stats.textContent = `Could not save your score (${errorText(err)}).`;
    }
  }

  async boardInto(target: HTMLElement): Promise<void> {
    const stats = el('div', 'stats', target);
    const list = el('ol', 'board', target);
    try {
      renderBoard(await getBoard(this.gameId), stats, list, this.me?.name);
    } catch (err) {
      stats.textContent = `Leaderboard unavailable (${errorText(err)}).`;
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'network error';
}

export interface Button {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

function renderBoard(board: Board, stats: HTMLElement, list: HTMLElement, myName?: string): void {
  stats.textContent = board.me ? `Your best: ${board.me.best} · Rank #${board.me.rank}` : 'No score yet. Be the first!';
  list.replaceChildren();
  board.top.slice(0, 10).forEach((row, i) => {
    const li = el('li', row.name === myName ? 'board__me' : '', list);
    el('span', 'board__rank', li).textContent = `#${i + 1}`;
    el('span', 'board__name', li).textContent = row.name;
    el('span', 'board__score', li).textContent = String(row.best);
  });
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  parent?.append(n);
  return n;
}

/** Escape text for the few places games build HTML strings. */
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
