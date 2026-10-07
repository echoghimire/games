import type { AttackDefinition } from '../combat/types';

/** A fighter is identified by its slot (0 = player 1, 1 = player 2). */
export type PlayerIndex = 0 | 1;

export interface ImpactPoint {
  x: number;
  y: number;
}

export interface GameEvents {
  hit: {
    attacker: PlayerIndex;
    victim: PlayerIndex;
    attack: AttackDefinition;
    damage: number;
    point: ImpactPoint;
    counter: boolean;
    comboCount: number;
    heavy: boolean;
    finisherName: string | null;
    /** Attacker facing: +1 right, -1 left. */
    direction: 1 | -1;
  };
  block: { attacker: PlayerIndex; victim: PlayerIndex; attack: AttackDefinition; point: ImpactPoint };
  attackStart: { fighter: PlayerIndex; attack: AttackDefinition };
  grabStart: { fighter: PlayerIndex };
  grabConnect: { attacker: PlayerIndex; victim: PlayerIndex; point: ImpactPoint };
  grabTech: { point: ImpactPoint };
  throw: { attacker: PlayerIndex; victim: PlayerIndex; damage: number; point: ImpactPoint; direction: 1 | -1 };
  jump: { fighter: PlayerIndex; x: number };
  land: { fighter: PlayerIndex; x: number; hard: boolean };
  dash: { fighter: PlayerIndex; x: number; back: boolean };
  knockdown: { fighter: PlayerIndex; x: number };
  health: { fighter: PlayerIndex; health: number; max: number };
  ko: { loser: PlayerIndex; point: ImpactPoint };

  roundIntro: { round: number };
  roundFight: { round: number };
  roundEnd: { winner: PlayerIndex | null; reason: 'ko' | 'time' };
  matchEnd: { winner: PlayerIndex | null };
  timer: { seconds: number };
}
