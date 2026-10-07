import type { HurtboxSet } from '../characters/FighterConfig';
import { WorldShape } from './Hitbox';
import type { ShapeDefinition } from './types';

export type Posture = keyof HurtboxSet;

/**
 * The vulnerable volume of a fighter, independent from the visual mesh.
 * It switches shape set with posture (standing / crouching / airborne).
 */
export class Hurtbox {
  readonly shapes: WorldShape[];
  private active: readonly ShapeDefinition[];
  count = 0;
  /** Disabled during knockdown/invulnerable frames. */
  enabled = true;

  constructor(private readonly set: HurtboxSet) {
    const max = Math.max(set.standing.length, set.crouching.length, set.airborne.length);
    this.shapes = Array.from({ length: max }, () => new WorldShape());
    this.active = set.standing;
  }

  update(posture: Posture, x: number, y: number, facing: number): void {
    this.active = this.set[posture];
    this.count = this.active.length;
    for (let i = 0; i < this.count; i++) {
      const def = this.active[i];
      const shape = this.shapes[i];
      if (def && shape) shape.set(def, x, y, facing);
    }
  }
}
