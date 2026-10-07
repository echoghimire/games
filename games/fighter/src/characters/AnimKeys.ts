/**
 * Logical animation names used by gameplay. Each fighter maps them to clips
 * from its own model, so gameplay never references a specific asset's clip names.
 */
export const ANIM_KEYS = [
  'idle',
  'walkForward',
  'walkBack',
  'run',
  'dashForward',
  'dashBack',
  'jumpStart',
  'jumpAir',
  'land',
  'crouch',
  'block',
  'crouchBlock',
  'blockHit',
  'hitHigh',
  'hitLow',
  'knockdown',
  'getUp',
  'grab',
  'grabbed',
  'victory',
  'defeat',
  'intro',
  // Attacks
  'jab',
  'straight',
  'kick',
  'lowJab',
  'uppercut',
  'sweep',
  'jumpPunch',
  'jumpKick',
  'comboSlam',
  'comboSpin',
] as const;

export type AnimKey = (typeof ANIM_KEYS)[number];
