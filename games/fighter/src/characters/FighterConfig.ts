import type { ModelKey } from '../assets/AssetManifest';
import type { AttackDefinition, ComboDefinition, GrabDefinition, ShapeDefinition } from '../combat/types';
import type { ClipMap } from './AnimationController';

export interface MovementStats {
  walkForward: number;
  walkBack: number;
  dashSpeed: number;
  dashFrames: number;
  /** Speed while holding forward after a dash. */
  runSpeed: number;
  backdashSpeed: number;
  backdashFrames: number;
  /** Strike-invulnerable frames at the start of a backdash (the dodge). */
  backdashInvuln: number;
  jumpVelocity: number;
  jumpForward: number;
  gravity: number;
  jumpSquat: number;
  landingLag: number;
}

export interface HurtboxSet {
  readonly standing: readonly ShapeDefinition[];
  readonly crouching: readonly ShapeDefinition[];
  readonly airborne: readonly ShapeDefinition[];
}

export interface FighterVisual {
  readonly model: ModelKey;
  /** Target standing height in meters (the model is scaled to it). */
  readonly height: number;
  /** Mesh/node names to hide (props baked into the model). */
  readonly hiddenNodes: readonly string[];
  /** Turn slightly towards the camera so faces are readable (radians). */
  readonly cameraYaw: number;
  readonly accentColor: string;
}

/**
 * Everything that defines a character. Adding a new fighter is a matter of
 * writing one of these (see ./fighters) and registering it in the roster.
 */
export interface FighterConfig {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly maxHealth: number;
  readonly visual: FighterVisual;
  readonly animations: ClipMap;
  readonly movement: MovementStats;
  readonly hurtboxes: HurtboxSet;
  /** Body collision half width (fighters can't overlap). */
  readonly pushHalfWidth: number;
  readonly attacks: readonly AttackDefinition[];
  readonly grab: GrabDefinition;
  readonly combos: readonly ComboDefinition[];
}
