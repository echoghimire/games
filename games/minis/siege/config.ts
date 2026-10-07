/** Ghost Siege tuning: the map, tower and enemy stats, and the endless wave recipe. */

export const COLS = 16;
export const ROWS = 10;
export const START_GOLD = 120;
export const START_LIVES = 20;
export const SELL_REFUND = 0.7;
export const FIRST_WAVE_DELAY = 25; // seconds of build time before wave 1
export const MAX_SCORE = 10_000_000; // the server's cap

/** Path corners in grid cells (col, row); col -1 is the portal just off the board. */
export const WAYPOINTS: [number, number][] = [
  [-1, 1],
  [2, 1],
  [2, 8],
  [6, 8],
  [6, 2],
  [10, 2],
  [10, 7],
  [13, 7],
  [13, 4],
  [15, 4],
];

/** World position of a cell centre (1 world unit per cell, board centred on the origin). */
export const cellX = (col: number): number => col - COLS / 2 + 0.5;
export const cellZ = (row: number): number => row - ROWS / 2 + 0.5;

export type TowerKind = 'blaster' | 'cannon' | 'rocket';

export interface TowerLevel {
  cost: number;
  damage: number;
  rate: number; // shots per second
  range: number; // cells
  splash: number; // splash radius in cells (0 = single target)
}

export interface TowerDef {
  kind: TowerKind;
  name: string;
  blurb: string;
  model: 1 | 2 | 3;
  levels: [TowerLevel, TowerLevel, TowerLevel];
}

export const TOWERS: Record<TowerKind, TowerDef> = {
  blaster: {
    kind: 'blaster',
    name: 'Blaster',
    blurb: 'Fast plasma bolts',
    model: 1,
    levels: [
      { cost: 50, damage: 8, rate: 3, range: 2.4, splash: 0 },
      { cost: 60, damage: 14, rate: 3.6, range: 2.7, splash: 0 },
      { cost: 110, damage: 24, rate: 4.5, range: 3, splash: 0 },
    ],
  },
  cannon: {
    kind: 'cannon',
    name: 'Cannon',
    blurb: 'Lobbed shells, splash',
    model: 2,
    levels: [
      { cost: 85, damage: 26, rate: 0.75, range: 2.7, splash: 1 },
      { cost: 95, damage: 46, rate: 0.85, range: 3, splash: 1.15 },
      { cost: 170, damage: 80, rate: 0.95, range: 3.3, splash: 1.3 },
    ],
  },
  rocket: {
    kind: 'rocket',
    name: 'Rocket',
    blurb: 'Long range homing',
    model: 3,
    levels: [
      { cost: 130, damage: 95, rate: 0.45, range: 4.2, splash: 0.6 },
      { cost: 140, damage: 170, rate: 0.5, range: 4.6, splash: 0.7 },
      { cost: 230, damage: 300, rate: 0.58, range: 5, splash: 0.8 },
    ],
  },
};
export const TOWER_KINDS: TowerKind[] = ['blaster', 'cannon', 'rocket'];

export type EnemyKind = 'ghost' | 'wisp' | 'ufo' | 'boss';

export interface EnemyDef {
  hp: number;
  speed: number; // cells per second
  bounty: number; // gold
  points: number; // score
  lives: number; // lives lost when it reaches the base
  height: number; // hover height of its centre
  radius: number; // hit radius
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  ghost: { hp: 34, speed: 1.5, bounty: 4, points: 10, lives: 1, height: 0.42, radius: 0.3 },
  wisp: { hp: 22, speed: 2.5, bounty: 3, points: 12, lives: 1, height: 0.42, radius: 0.28 },
  ufo: { hp: 120, speed: 0.85, bounty: 9, points: 30, lives: 1, height: 0.5, radius: 0.38 },
  boss: { hp: 1100, speed: 0.55, bounty: 80, points: 400, lives: 5, height: 0.85, radius: 0.8 },
};

/** Enemy HP grows ~13% a wave (plus a little), so the siege always wins in the end. */
export const hpScale = (wave: number): number => Math.pow(1.13, wave - 1) * (1 + (wave - 1) * 0.02);
export const bountyScale = (wave: number): number => 1 + (wave - 1) * 0.05;
export const pointScale = (wave: number): number => 1 + (wave - 1) * 0.1;
export const clearBonus = (wave: number): number => 20 + wave * 4;
/** Seconds between the end of one wave's spawning and the next wave. */
export const waveGap = (wave: number): number => Math.max(9, 15 - wave * 0.3);

export interface Spawn {
  kind: EnemyKind;
  at: number; // seconds after the wave starts
}

/** The spawn list for a wave: ghosts first, then UFOs, fast wisps, and a boss every 5th wave. */
export function waveSpawns(wave: number): Spawn[] {
  const out: Spawn[] = [];
  const pace = Math.max(0.55, 1 - wave * 0.015);
  let t = 0;
  const add = (kind: EnemyKind, n: number, gap: number): void => {
    for (let i = 0; i < n; i++) {
      out.push({ kind, at: t });
      t += gap * pace;
    }
  };
  const ghosts = 6 + Math.floor(wave * 1.2) + (wave === 1 ? 2 : 0);
  const ufos = wave >= 3 ? Math.floor((wave - 1) / 2) + (wave >= 12 ? Math.floor(wave / 4) : 0) : 0;
  const wisps = wave >= 6 ? 3 + Math.floor(wave / 2) : 0;
  const boss = wave % 5 === 0;
  add('ghost', Math.ceil(ghosts / 2), 0.75);
  if (ufos) add('ufo', Math.ceil(ufos / 2), 1.4);
  add('ghost', Math.floor(ghosts / 2), 0.7);
  if (wisps) {
    t += 1;
    add('wisp', wisps, 0.35);
  }
  if (ufos > 1) add('ufo', Math.floor(ufos / 2), 1.3);
  if (boss) {
    t += 1.5;
    add('boss', 1 + Math.floor(wave / 20), 3);
  }
  return out;
}

/** Short "12 Ghosts · 2 UFOs" style summary for the next-wave preview. */
export function waveSummary(wave: number): string {
  const counts: Partial<Record<EnemyKind, number>> = {};
  for (const s of waveSpawns(wave)) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  const names: Record<EnemyKind, string> = { ghost: 'Ghost', wisp: 'Wisp', ufo: 'UFO', boss: 'BOSS' };
  return (Object.keys(counts) as EnemyKind[]).map((k) => `${counts[k]} ${names[k]}${counts[k]! > 1 && k !== 'boss' ? 's' : ''}`).join(' · ');
}
