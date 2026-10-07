import type { FighterConfig } from '../FighterConfig';
import { BRAKK } from './brakk';
import { VESNA } from './vesna';

/** Character roster. Add new fighters here to make them selectable. */
export const ROSTER: readonly FighterConfig[] = [BRAKK, VESNA];

export function getFighter(id: string): FighterConfig {
  const cfg = ROSTER.find((f) => f.id === id);
  if (!cfg) throw new Error(`Unknown fighter: ${id}`);
  return cfg;
}
