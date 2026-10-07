import type { FighterConfig } from '../characters/FighterConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, PlayerIndex } from '../game/GameEvents';
import { CombatText, ComboCounter } from './CombatText';
import { el, replayClass } from './dom';
import { HealthBar } from './HealthBar';
import { MenuScreen, type MenuCallbacks } from './MenuScreen';
import { ResultScreen, type ResultCallbacks } from './ResultScreen';
import { RoundUI } from './RoundUI';

export type ScreenProjector = (x: number, y: number) => { x: number; y: number };

interface Side {
  readonly root: HTMLDivElement;
  readonly name: HTMLDivElement;
  readonly pips: HTMLDivElement;
  readonly bar: HealthBar;
  readonly combo: ComboCounter;
}

/** DOM overlay above the canvas: HUD, announcer, combat text and screens. */
export class GameUI {
  readonly menu: MenuScreen;
  readonly result: ResultScreen;
  readonly announcer: RoundUI;
  private readonly hud: HTMLDivElement;
  private readonly sides: [Side, Side];
  private readonly timer: HTMLDivElement;
  private readonly text: CombatText;
  private readonly loading: HTMLDivElement;
  private readonly loadingFill: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(
    root: HTMLElement,
    private readonly events: EventBus<GameEvents>,
    private readonly project: ScreenProjector,
    roster: readonly FighterConfig[],
    callbacks: MenuCallbacks & ResultCallbacks,
  ) {
    this.flash = el('div', 'screen-flash', '', root);
    this.hud = el('div', 'hud', '', root);
    const top = el('div', 'hud__top', '', this.hud);
    const left = this.buildSide(top, 'left');
    this.timer = el('div', 'hud__timer', '90', top);
    const right = this.buildSide(top, 'right');
    this.sides = [left, right];

    this.text = new CombatText(root);
    this.announcer = new RoundUI(root);
    this.menu = new MenuScreen(root, roster, callbacks);
    this.result = new ResultScreen(root, callbacks);

    this.loading = el('div', 'screen loading screen--visible', '', root);
    el('div', 'menu__logo menu__logo--small', 'IRON ARENA', this.loading);
    const bar = el('div', 'loading__bar', '', this.loading);
    this.loadingFill = el('div', 'loading__fill', '', bar);
    el('div', 'loading__label', 'Forging the arena…', this.loading);

    this.fps = el('div', 'fps', '', root);
    this.bindEvents();
  }

  private buildSide(parent: HTMLElement, side: 'left' | 'right'): Side {
    const root = el('div', `hud__side hud__side--${side}`, '', parent);
    const bar = new HealthBar(root, side);
    const info = el('div', 'hud__info', '', root);
    const name = el('div', 'hud__name', '', info);
    const pips = el('div', 'hud__pips', '', info);
    const combo = new ComboCounter(this.hud, side);
    return { root, name, pips, bar, combo };
  }

  private bindEvents(): void {
    const ev = this.events;
    ev.on('health', (e) => this.sides[e.fighter].bar.set(e.health / e.max));
    ev.on('timer', (e) => {
      this.timer.textContent = String(e.seconds);
      this.timer.classList.toggle('hud__timer--low', e.seconds <= 10);
    });
    ev.on('hit', (e) => {
      const p = this.project(e.point.x, e.point.y + 0.35);
      this.text.spawn(e.counter ? 'counter' : 'damage', e.counter ? `COUNTER ${e.damage}` : String(e.damage), p.x, p.y);
      this.attackerSide(e.attacker).combo.show(e.comboCount, e.finisherName);
      if (e.heavy) this.screenFlash(e.counter ? 'counter' : 'hit');
    });
    ev.on('block', (e) => {
      const p = this.project(e.point.x, e.point.y + 0.35);
      this.text.spawn('block', 'BLOCK', p.x, p.y);
    });
    ev.on('throw', (e) => {
      const p = this.project(e.point.x, e.point.y + 0.6);
      this.text.spawn('throw', `THROW ${e.damage}`, p.x, p.y);
      this.screenFlash('hit');
    });
    ev.on('grabTech', (e) => {
      const p = this.project(e.point.x, e.point.y + 0.5);
      this.text.spawn('block', 'BREAK', p.x, p.y);
    });
    ev.on('roundIntro', (e) => {
      for (const s of this.sides) s.combo.clear();
      this.announcer.show(`ROUND ${e.round}`, 'round', 1.6, 'VS');
    });
    ev.on('roundFight', () => this.announcer.show('FIGHT!', 'fight', 0.9));
    ev.on('ko', () => {
      this.announcer.show('KO!', 'ko', 2);
      this.screenFlash('ko');
    });
    ev.on('roundEnd', (e) => {
      if (e.reason === 'time') this.announcer.show('TIME!', 'time', 2, e.winner === null ? 'DRAW' : '');
    });
  }

  private attackerSide(i: PlayerIndex): Side {
    return this.sides[i];
  }

  screenFlash(kind: 'hit' | 'counter' | 'ko'): void {
    this.flash.dataset['kind'] = kind;
    replayClass(this.flash, 'screen-flash--on');
  }

  setLoading(ratio: number): void {
    this.loadingFill.style.transform = `scaleX(${ratio})`;
  }

  hideLoading(): void {
    this.loading.classList.remove('screen--visible');
  }

  /** Configure the HUD for a new match. */
  setupMatch(fighters: readonly [FighterConfig, FighterConfig], roundsToWin: number): void {
    fighters.forEach((cfg, i) => {
      const s = this.sides[i as PlayerIndex];
      s.name.textContent = cfg.name;
      s.root.style.setProperty('--accent', cfg.visual.accentColor);
      s.bar.set(1, true);
      s.pips.replaceChildren();
      for (let r = 0; r < roundsToWin; r++) el('span', 'pip', '', s.pips);
      s.combo.clear();
    });
  }

  setWins(wins: readonly [number, number]): void {
    wins.forEach((w, i) => {
      const pips = this.sides[i as PlayerIndex].pips.children;
      for (let p = 0; p < pips.length; p++) pips[p]?.classList.toggle('pip--won', p < w);
    });
  }

  showHud(visible: boolean): void {
    this.hud.classList.toggle('hud--visible', visible);
    if (visible) replayClass(this.hud, 'hud--enter');
  }

  showMenu(visible: boolean): void {
    this.menu.show(visible);
  }

  /** `labels` replaces "PLAYER 1/2" (online: "YOU" and "OPPONENT"). */
  showResult(
    winner: PlayerIndex | null,
    fighters: readonly [FighterConfig, FighterConfig],
    labels?: readonly [string, string],
  ): void {
    if (winner === null) {
      this.result.show(true, 'DRAW', 'Both warriors stand… for now.');
      return;
    }
    const cfg = fighters[winner];
    const who = labels ? labels[winner] : `PLAYER ${winner + 1}`;
    const title = who === 'YOU' ? 'YOU WIN' : `${who} WINS`;
    this.result.show(true, title, `${cfg.name} · ${cfg.title}`, cfg.visual.accentColor);
  }

  hideResult(): void {
    this.result.show(false);
  }

  update(dt: number): void {
    for (const s of this.sides) {
      s.bar.update(dt);
      s.combo.update(dt);
    }
    this.text.update(dt);
    this.announcer.update(dt);
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps.textContent = `${Math.round(this.fpsFrames / this.fpsAccum)} FPS`;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  }

  pulseTimer(): void {
    replayClass(this.timer, 'hud__timer--pulse');
  }
}
