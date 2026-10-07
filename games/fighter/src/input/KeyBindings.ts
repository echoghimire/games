import type { ActionName } from './Actions';

/** Maps each logical action to one or more `KeyboardEvent.code` values. */
export type KeyBinding = Readonly<Record<ActionName, readonly string[]>>;

export const PLAYER1_KEYS: KeyBinding = {
  Left: ['KeyA'],
  Right: ['KeyD'],
  Up: ['KeyW'],
  Down: ['KeyS'],
  Light: ['KeyJ'],
  Heavy: ['KeyK'],
  Kick: ['KeyL'],
  Block: ['KeyI'],
  Grab: ['KeyU'],
};

export const PLAYER2_KEYS: KeyBinding = {
  Left: ['ArrowLeft'],
  Right: ['ArrowRight'],
  Up: ['ArrowUp'],
  Down: ['ArrowDown'],
  // Number-row fallbacks for keyboards without a numpad (e.g. laptops).
  Light: ['Numpad1', 'Digit1'],
  Heavy: ['Numpad2', 'Digit2'],
  Kick: ['Numpad3', 'Digit3'],
  Block: ['Numpad5', 'Digit5'],
  Grab: ['Numpad4', 'Digit4'],
};

export const DEFAULT_BINDINGS: readonly KeyBinding[] = [PLAYER1_KEYS, PLAYER2_KEYS];

/** Human-readable key name for UI hints, e.g. "KeyJ" becomes "J". */
export function keyLabel(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ')
    .replace(/^Arrow/, '')
    .replace('Left', '←')
    .replace('Right', '→')
    .replace('Up', '↑')
    .replace('Down', '↓');
}
