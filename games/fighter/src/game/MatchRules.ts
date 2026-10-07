import { SIM_HZ } from './GameLoop';

/** Tunable match format. Best-of-3 is `roundsToWin: 2`. */
export interface MatchRules {
  readonly roundsToWin: number;
  readonly roundSeconds: number;
  /** Announcer timings, in ticks. */
  readonly introTicks: number;
  readonly fightBannerTicks: number;
  readonly koTicks: number;
  readonly outroTicks: number;
  /** Gameplay time scale right after a KO. */
  readonly koSlowMotion: number;
  readonly koSlowMotionTicks: number;
}

export const DEFAULT_RULES: MatchRules = {
  roundsToWin: 1,
  roundSeconds: 90,
  introTicks: Math.round(1.9 * SIM_HZ),
  fightBannerTicks: Math.round(0.9 * SIM_HZ),
  koTicks: Math.round(2.2 * SIM_HZ),
  outroTicks: Math.round(2.6 * SIM_HZ),
  koSlowMotion: 0.3,
  koSlowMotionTicks: Math.round(0.45 * SIM_HZ),
};
