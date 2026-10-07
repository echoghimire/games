import type { AttackInput, ComboDefinition } from './types';

export interface ComboStep {
  /** Attack id to perform, or null for the basic attack of that input. */
  readonly finisherId: string | null;
  readonly damageMultiplier: number;
  readonly comboName: string | null;
}

const BASIC_STEP: ComboStep = { finisherId: null, damageMultiplier: 1, comboName: null };

/**
 * Tracks the chain of inputs a fighter performed in the current string and
 * matches it against the fighter's ComboDefinitions (a "dial-a-combo" system).
 * Combos are pure data; this class never needs to change to support new ones.
 */
export class ComboSystem {
  private readonly chain: AttackInput[] = [];

  constructor(private readonly combos: readonly ComboDefinition[]) {}

  /** A new string starts (attack from neutral). */
  begin(input: AttackInput): void {
    this.chain.length = 0;
    this.chain.push(input);
  }

  reset(): void {
    this.chain.length = 0;
  }

  get length(): number {
    return this.chain.length;
  }

  /**
   * Returns the step to perform if `next` continues a known combo, or null if
   * the chain can't continue with that input.
   */
  tryContinue(next: AttackInput): ComboStep | null {
    const len = this.chain.length;
    if (len === 0) return null;
    let continues = false;
    for (const combo of this.combos) {
      if (combo.inputs.length <= len) continue;
      if (!this.prefixMatches(combo, len) || combo.inputs[len] !== next) continue;
      if (combo.inputs.length === len + 1) {
        this.chain.push(next);
        return { finisherId: combo.finisher, damageMultiplier: combo.damageMultiplier, comboName: combo.name };
      }
      continues = true;
    }
    if (!continues) return null;
    this.chain.push(next);
    return BASIC_STEP;
  }

  private prefixMatches(combo: ComboDefinition, len: number): boolean {
    for (let i = 0; i < len; i++) if (combo.inputs[i] !== this.chain[i]) return false;
    return true;
  }
}
