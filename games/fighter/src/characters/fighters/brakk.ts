import type { FighterConfig } from '../FighterConfig';
import { BASE_MOVEMENT, KAYKIT_CLIPS, KAYKIT_HURTBOXES } from './kaykitShared';

/** Brakk "the Anvil": slow, heavy hitter with big knockback. */
export const BRAKK: FighterConfig = {
  id: 'brakk',
  name: 'BRAKK',
  title: 'The Anvil of the North',
  maxHealth: 100,
  visual: {
    model: 'barbarian',
    height: 1.85,
    hiddenNodes: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug'],
    cameraYaw: 0.35,
    accentColor: '#e0482f',
  },
  animations: KAYKIT_CLIPS,
  movement: { ...BASE_MOVEMENT, walkForward: 2.4, walkBack: 1.8, dashSpeed: 8.5 },
  hurtboxes: KAYKIT_HURTBOXES,
  pushHalfWidth: 0.36,
  attacks: [
    {
      id: 'brakk.jab', name: 'Iron Jab', input: 'light', stance: 'standing', animation: 'jab', animationStart: 0.18,
      startup: 6, active: 3, recovery: 10, damage: 5, hitStun: 16, blockStun: 9, knockback: 1.4,
      height: 'high', hitbox: { kind: 'sphere', x: 0.9, y: 1.38, r: 0.32 }, hitStop: 4, shake: 0.12, sound: 'punch',
    },
    {
      id: 'brakk.straight', name: 'Hammer Fist', input: 'heavy', stance: 'standing', animation: 'straight', animationStart: 0.2,
      startup: 13, active: 4, recovery: 20, damage: 11, chipDamage: 1, hitStun: 22, blockStun: 14, knockback: 5.5,
      height: 'mid', hitbox: { kind: 'sphere', x: 0.95, y: 1.25, r: 0.36 }, hitStop: 8, shake: 0.38, sound: 'heavy', lunge: 2.6,
    },
    {
      id: 'brakk.kick', name: 'Boot', input: 'kick', stance: 'standing', animation: 'kick', animationStart: 0.12,
      startup: 9, active: 4, recovery: 16, damage: 8, hitStun: 18, blockStun: 11, knockback: 3.8,
      height: 'mid', hitbox: { kind: 'sphere', x: 1.02, y: 0.85, r: 0.36 }, hitStop: 6, shake: 0.22, sound: 'kick',
    },
    {
      id: 'brakk.lowJab', name: 'Gut Punch', input: 'light', stance: 'crouching', animation: 'lowJab', animationStart: 0.18,
      startup: 5, active: 3, recovery: 10, damage: 4, hitStun: 14, blockStun: 8, knockback: 1.8,
      height: 'mid', hitbox: { kind: 'sphere', x: 0.8, y: 0.7, r: 0.3 }, hitStop: 4, shake: 0.1, sound: 'punch',
    },
    {
      id: 'brakk.uppercut', name: 'Mountain Breaker', input: 'heavy', stance: 'crouching', animation: 'uppercut', animationStart: 0.15,
      startup: 11, active: 5, recovery: 26, damage: 13, chipDamage: 1, hitStun: 30, blockStun: 16, knockback: 2.5, launch: 8.5,
      knockdown: true, height: 'mid', hitbox: { kind: 'box', x: 0.75, y: 1.25, halfW: 0.38, halfH: 0.6 }, hitStop: 9, shake: 0.5,
      sound: 'heavy',
    },
    {
      id: 'brakk.sweep', name: 'Log Sweep', input: 'kick', stance: 'crouching', animation: 'sweep', animationStart: 0.12,
      startup: 10, active: 4, recovery: 22, damage: 8, hitStun: 26, blockStun: 12, knockback: 2, knockdown: true,
      height: 'low', hitbox: { kind: 'box', x: 0.95, y: 0.22, halfW: 0.45, halfH: 0.22 }, hitStop: 6, shake: 0.25, sound: 'kick',
    },
    {
      id: 'brakk.jumpPunch', name: 'Falling Fist', input: 'light', stance: 'air', animation: 'jumpPunch', animationStart: 0.2,
      startup: 5, active: 8, recovery: 8, damage: 6, hitStun: 18, blockStun: 10, knockback: 2.5,
      height: 'overhead', hitbox: { kind: 'sphere', x: 0.7, y: 0.95, r: 0.36 }, hitStop: 5, shake: 0.15, sound: 'punch',
    },
    {
      id: 'brakk.jumpSmash', name: 'Avalanche', input: 'heavy', stance: 'air', animation: 'comboSlam', animationStart: 0.25,
      startup: 8, active: 7, recovery: 10, damage: 11, hitStun: 22, blockStun: 14, knockback: 4,
      height: 'overhead', hitbox: { kind: 'box', x: 0.65, y: 0.75, halfW: 0.4, halfH: 0.45 }, hitStop: 8, shake: 0.4, sound: 'heavy',
    },
    {
      id: 'brakk.jumpKick', name: 'Drop Boot', input: 'kick', stance: 'air', animation: 'jumpKick', animationStart: 0.15,
      startup: 6, active: 9, recovery: 8, damage: 9, hitStun: 20, blockStun: 12, knockback: 3.5,
      height: 'overhead', hitbox: { kind: 'sphere', x: 0.85, y: 0.55, r: 0.4 }, hitStop: 6, shake: 0.25, sound: 'kick',
    },
    {
      id: 'brakk.comboSlam', name: 'Skull Splitter', input: 'heavy', stance: 'standing', animation: 'comboSlam', animationStart: 0.22,
      startup: 12, active: 4, recovery: 26, damage: 12, chipDamage: 2, hitStun: 30, blockStun: 16, knockback: 6.5,
      knockdown: true, height: 'overhead', hitbox: { kind: 'box', x: 0.9, y: 1.1, halfW: 0.42, halfH: 0.6 }, hitStop: 10,
      shake: 0.6, sound: 'heavy', lunge: 2,
    },
    {
      id: 'brakk.comboSpin', name: 'Whirlwind', input: 'kick', stance: 'standing', animation: 'comboSpin', animationStart: 0,
      startup: 9, active: 7, recovery: 20, damage: 9, hitStun: 24, blockStun: 14, knockback: 8,
      height: 'mid', hitbox: { kind: 'box', x: 0.55, y: 1.0, halfW: 0.65, halfH: 0.5 }, hitStop: 8, shake: 0.45, sound: 'kick',
    },
  ],
  grab: {
    id: 'brakk.grab', animation: 'grab', startup: 5, active: 3, whiffRecovery: 24, holdFrames: 26, damage: 13,
    range: { kind: 'box', x: 0.62, y: 1.0, halfW: 0.32, halfH: 0.5 }, throwSpeed: 7.5, throwLaunch: 6,
  },
  combos: [
    { id: 'brakk.c1', name: 'SKULL SPLITTER', inputs: ['light', 'light', 'heavy'], finisher: 'brakk.comboSlam', damageMultiplier: 1.2 },
    { id: 'brakk.c2', name: 'WHIRLWIND', inputs: ['light', 'light', 'kick'], finisher: 'brakk.comboSpin', damageMultiplier: 1.15 },
  ],
};
