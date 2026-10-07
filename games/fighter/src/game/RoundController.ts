import type { EventBus } from '../core/EventBus';
import type { GameEvents, PlayerIndex } from './GameEvents';
import { SIM_HZ } from './GameLoop';
import type { Match } from './Match';
import type { MatchRules } from './MatchRules';

export type RoundPhase = 'intro' | 'fight' | 'ko' | 'outro' | 'over';

/**
 * Round flow: ROUND N → FIGHT! → (KO | TIME) → winner pose → next round or
 * match end. Owns the timer and win counts; reads fighter state from Match.
 */
export class RoundController {
  phase: RoundPhase = 'intro';
  round = 1;
  readonly wins: [number, number] = [0, 0];
  private phaseTicks = 0;
  private remainingTicks = 0;
  private lastSecond = -1;
  private roundWinner: PlayerIndex | null = null;
  /** Gameplay time scale requested by the round flow (KO slow motion). */
  timeScale = 1;

  constructor(
    private readonly match: Match,
    private readonly rules: MatchRules,
    private readonly events: EventBus<GameEvents>,
  ) {}

  get secondsLeft(): number {
    return Math.ceil(this.remainingTicks / SIM_HZ);
  }

  get matchWinner(): PlayerIndex | null {
    if (this.wins[0] >= this.rules.roundsToWin) return 0;
    if (this.wins[1] >= this.rules.roundsToWin) return 1;
    return null;
  }

  start(): void {
    this.round = 1;
    this.wins[0] = this.wins[1] = 0;
    this.beginRound();
  }

  private beginRound(): void {
    this.match.resetPositions();
    this.match.setInputEnabled(false);
    this.remainingTicks = this.rules.roundSeconds * SIM_HZ;
    this.lastSecond = -1;
    this.roundWinner = null;
    this.timeScale = 1;
    this.setPhase('intro');
    this.emitTimer();
    for (const f of this.match.fighters) {
      this.events.emit('health', { fighter: f.index, health: f.health, max: f.config.maxHealth });
    }
    this.events.emit('roundIntro', { round: this.round });
  }

  private setPhase(phase: RoundPhase): void {
    this.phase = phase;
    this.phaseTicks = 0;
  }

  /** Advance one tick, after the match simulated it. */
  update(): void {
    this.phaseTicks++;
    const [a, b] = this.match.fighters;
    switch (this.phase) {
      case 'intro':
        if (this.phaseTicks === this.rules.introTicks) {
          for (const f of this.match.fighters) f.toNeutral();
          this.match.setInputEnabled(true);
          this.setPhase('fight');
          this.events.emit('roundFight', { round: this.round });
        }
        break;
      case 'fight': {
        if (a.isKO || b.isKO) {
          this.endRound(a.isKO && b.isKO ? null : a.isKO ? 1 : 0, 'ko');
          break;
        }
        this.remainingTicks--;
        this.emitTimer();
        if (this.remainingTicks <= 0) {
          const winner = a.health === b.health ? null : a.health > b.health ? 0 : 1;
          this.endRound(winner, 'time');
        }
        break;
      }
      case 'ko':
        if (this.phaseTicks === this.rules.koSlowMotionTicks) this.timeScale = 1;
        if (this.phaseTicks >= this.rules.koTicks) {
          this.setPhase('outro');
          const w = this.roundWinner;
          if (w !== null) this.match.fighters[w].win();
        }
        break;
      case 'outro':
        if (this.phaseTicks >= this.rules.outroTicks) {
          const winner = this.matchWinner;
          const draw = this.roundWinner === null && this.rules.roundsToWin === 1;
          if (winner !== null || draw) {
            this.setPhase('over');
            this.events.emit('matchEnd', { winner });
          } else {
            this.round++;
            this.beginRound();
          }
        }
        break;
      case 'over':
        break;
    }
  }

  private endRound(winner: PlayerIndex | null, reason: 'ko' | 'time'): void {
    this.roundWinner = winner;
    if (winner !== null) this.wins[winner]++;
    this.match.setInputEnabled(false);
    this.setPhase('ko');
    if (reason === 'ko') {
      this.timeScale = this.rules.koSlowMotion;
      const loser = this.match.fighters.find((f) => f.isKO);
      if (loser) this.events.emit('ko', { loser: loser.index, point: { x: loser.x, y: 1.2 } });
    } else {
      // Time over: the loser simply stays put; the winner celebrates in the outro.
      for (const f of this.match.fighters) if (!f.isKO && f.state !== 'knockdown') f.toNeutral();
    }
    this.events.emit('roundEnd', { winner, reason });
  }

  private emitTimer(): void {
    const s = this.secondsLeft;
    if (s !== this.lastSecond) {
      this.lastSecond = s;
      this.events.emit('timer', { seconds: s });
    }
  }
}
