import type { AttackDefinition, AttackInput, AttackStance } from './types';

export type AttackPhase = 'startup' | 'active' | 'recovery' | 'done';

export function totalFrames(a: AttackDefinition): number {
  return a.startup + a.active + a.recovery;
}

/** `frame` counts from 1 on the first tick of the attack. */
export function attackPhase(a: AttackDefinition, frame: number): AttackPhase {
  if (frame <= a.startup) return 'startup';
  if (frame <= a.startup + a.active) return 'active';
  if (frame <= totalFrames(a)) return 'recovery';
  return 'done';
}

/** Lookup table of a fighter's move list by stance + button. */
export class MoveList {
  private readonly byId = new Map<string, AttackDefinition>();
  private readonly byStanceInput = new Map<string, AttackDefinition>();

  constructor(attacks: readonly AttackDefinition[]) {
    for (const a of attacks) {
      this.byId.set(a.id, a);
      const key = `${a.stance}:${a.input}`;
      // The first declared move wins for a stance/button pair; others are combo-only.
      if (!this.byStanceInput.has(key)) this.byStanceInput.set(key, a);
    }
  }

  get(id: string): AttackDefinition | undefined {
    return this.byId.get(id);
  }

  find(stance: AttackStance, input: AttackInput): AttackDefinition | undefined {
    return this.byStanceInput.get(`${stance}:${input}`) ?? (stance === 'crouching' ? this.find('standing', input) : undefined);
  }
}
