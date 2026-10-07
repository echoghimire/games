/**
 * Logical actions as bit flags: an input frame is two integers (held + pressed),
 * cheap to store in history buffers, compare, or send over the network later.
 */
export const Action = {
  Left: 1 << 0,
  Right: 1 << 1,
  Up: 1 << 2,
  Down: 1 << 3,
  Light: 1 << 4,
  Heavy: 1 << 5,
  Kick: 1 << 6,
  Block: 1 << 7,
  Grab: 1 << 8,
} as const;

export type ActionName = keyof typeof Action;
export type ActionBit = (typeof Action)[ActionName];

export interface InputFrame {
  /** Actions currently held down. */
  held: number;
  /** Actions that went down during this tick. */
  pressed: number;
}

export const has = (mask: number, bit: ActionBit): boolean => (mask & bit) !== 0;

export const emptyFrame = (): InputFrame => ({ held: 0, pressed: 0 });
