import { el, replayClass } from './dom';

export type BannerStyle = 'round' | 'fight' | 'ko' | 'win' | 'time';

/** Center-screen announcer text (ROUND 1 / FIGHT! / KO! / PLAYER 1 WINS). */
export class RoundUI {
  private readonly banner: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private hideAt = 0;
  private time = 0;

  constructor(parent: HTMLElement) {
    const wrap = el('div', 'announcer', '', parent);
    this.banner = el('div', 'announcer__text', '', wrap);
    this.sub = el('div', 'announcer__sub', '', wrap);
  }

  show(text: string, style: BannerStyle, seconds: number, sub = ''): void {
    this.banner.textContent = text;
    this.banner.dataset['style'] = style;
    this.sub.textContent = sub;
    replayClass(this.banner, 'announcer__text--in');
    this.banner.classList.remove('announcer__text--out');
    this.sub.classList.toggle('announcer__sub--in', sub !== '');
    this.hideAt = this.time + seconds;
  }

  hide(): void {
    this.banner.classList.remove('announcer__text--in');
    this.banner.classList.add('announcer__text--out');
    this.sub.classList.remove('announcer__sub--in');
    this.hideAt = 0;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.hideAt > 0 && this.time >= this.hideAt) this.hide();
  }
}
