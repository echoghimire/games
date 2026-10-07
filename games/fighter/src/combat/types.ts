import type { AnimKey } from '../characters/AnimKeys';

/**
 * Shapes live in fighter-local 2D space: +x is "forward" (towards the facing
 * direction), +y is up, origin at the feet. Depth (z) is irrelevant in 2.5D.
 */
export type ShapeDefinition =
  | { readonly kind: 'box'; readonly x: number; readonly y: number; readonly halfW: number; readonly halfH: number }
  | { readonly kind: 'sphere'; readonly x: number; readonly y: number; readonly r: number };

export type HitboxDefinition = ShapeDefinition;

/** Which guard stops the attack: lows must be crouch-blocked, overheads stand-blocked. */
export type AttackHeight = 'high' | 'mid' | 'low' | 'overhead';

/** Basic attack buttons. Combos are sequences of these. */
export type AttackInput = 'light' | 'heavy' | 'kick';

/** Which posture an attack is performed from. */
export type AttackStance = 'standing' | 'crouching' | 'air';

export type ImpactSound = 'punch' | 'kick' | 'heavy';

export interface AttackDefinition {
  readonly id: string;
  readonly name: string;
  readonly input: AttackInput;
  readonly stance: AttackStance;
  readonly animation: AnimKey;
  /** Skip the first fraction of the clip (wind-up that doesn't fit the frame data). */
  readonly animationStart?: number;
  /** Frame data at 60 ticks/s. */
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  readonly damage: number;
  /** Damage taken by a blocking opponent. */
  readonly chipDamage?: number;
  readonly hitStun: number;
  readonly blockStun: number;
  /** Horizontal push speed (m/s) applied to the victim. */
  readonly knockback: number;
  /** Vertical launch speed (m/s); > 0 pops the victim into the air. */
  readonly launch?: number;
  /** Sends the victim to the ground (knockdown + get up). */
  readonly knockdown?: boolean;
  readonly height: AttackHeight;
  readonly hitbox: HitboxDefinition;
  /** Freeze frames on impact for both fighters. */
  readonly hitStop: number;
  /** Camera shake trauma on hit (0..1). */
  readonly shake: number;
  readonly sound: ImpactSound;
  /** Forward lunge speed during startup + active frames. */
  readonly lunge?: number;
}

/** A grab: short range, unblockable, beaten by being airborne or in hit/block stun. */
export interface GrabDefinition {
  readonly id: string;
  readonly animation: AnimKey;
  readonly startup: number;
  readonly active: number;
  readonly whiffRecovery: number;
  /** Frames the victim is held before being thrown. */
  readonly holdFrames: number;
  readonly damage: number;
  readonly range: HitboxDefinition;
  readonly throwSpeed: number;
  readonly throwLaunch: number;
}

/**
 * A chain: pressing `inputs` in order, each within the cancel window of the
 * previous attack. Intermediate steps use the fighter's basic attacks; the last
 * step is replaced by `finisher` with its damage multiplied.
 */
export interface ComboDefinition {
  readonly id: string;
  readonly name: string;
  readonly inputs: readonly AttackInput[];
  readonly finisher: string;
  readonly damageMultiplier: number;
}
