/**
 * Every external file the game loads, keyed by a stable id. Adding a fighter,
 * arena or sound only requires a new entry here plus a reference in data configs.
 */
const BASE = `${import.meta.env.BASE_URL}assets/`;

export const MODELS = {
  barbarian: `${BASE}characters/Barbarian.glb`,
  rogueHooded: `${BASE}characters/Rogue_Hooded.glb`,
  torchLit: `${BASE}props/torch_lit.glb`,
  torchMounted: `${BASE}props/torch_mounted.glb`,
  pillarDecorated: `${BASE}props/pillar_decorated.glb`,
  column: `${BASE}props/column.glb`,
  barrelLarge: `${BASE}props/barrel_large.glb`,
} as const;

export const TEXTURES = {
  floorDiff: `${BASE}textures/floor_diff.jpg`,
  floorNormal: `${BASE}textures/floor_nor_gl.jpg`,
  floorArm: `${BASE}textures/floor_arm.jpg`,
  wallDiff: `${BASE}textures/wall_diff.jpg`,
  wallNormal: `${BASE}textures/wall_nor_gl.jpg`,
  wallArm: `${BASE}textures/wall_arm.jpg`,
  dot: `${BASE}vfx/dot.png`,
  star: `${BASE}vfx/star.png`,
  smoke: `${BASE}vfx/smoke.png`,
  flame: `${BASE}vfx/flame.png`,
  debris: `${BASE}vfx/debris.png`,
  slash: `${BASE}vfx/slash.png`,
} as const;

export const HDRIS = {
  night: `${BASE}hdri/night.hdr`,
} as const;

export const SOUNDS = {
  punch: `${BASE}audio/sfx/punch.mp3`,
  punch2: `${BASE}audio/sfx/punch2.mp3`,
  kick: `${BASE}audio/sfx/kick.mp3`,
  heavy: `${BASE}audio/sfx/heavy.mp3`,
  block: `${BASE}audio/sfx/block.mp3`,
  land: `${BASE}audio/sfx/land.mp3`,
  jump: `${BASE}audio/sfx/jump.mp3`,
  ko: `${BASE}audio/sfx/ko.mp3`,
  grab: `${BASE}audio/sfx/grab.mp3`,
  whoosh: `${BASE}audio/sfx/whoosh.mp3`,
  whooshHeavy: `${BASE}audio/sfx/whoosh_heavy.mp3`,
  uiSelect: `${BASE}audio/sfx/ui_select.mp3`,
  uiConfirm: `${BASE}audio/sfx/ui_confirm.mp3`,
  uiRound: `${BASE}audio/sfx/ui_round.mp3`,
  musicBattle: `${BASE}audio/music/battle.mp3`,
} as const;

export type ModelKey = keyof typeof MODELS;
export type TextureKey = keyof typeof TEXTURES;
export type HdriKey = keyof typeof HDRIS;
export type SoundKey = keyof typeof SOUNDS;
