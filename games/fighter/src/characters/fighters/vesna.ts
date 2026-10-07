import type { FighterConfig } from '../FighterConfig';
import { BASE_MOVEMENT, KAYKIT_CLIPS, KAYKIT_HURTBOXES } from './kaykitShared';

/** Vesna "the Ashen Viper": fast, mobile, long kicks, lighter damage. */
export const VESNA: FighterConfig = {
  id: 'vesna',
  name: 'VESNA',
  title: 'The Ashen Viper',
  maxHealth: 100,
  visual: {
    model: 'rogueHooded',
    height: 1.78,
    hiddenNodes: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
    cameraYaw: 0.35,
    accentColor: '#3f8fd6',
  },
  animations: {
    ...KAYKIT_CLIPS,
    walkForward: { clip: 'Walking_B', loop: true, speed: 1.2 },
    comboSlam: { clip: 'Dualwield_Melee_Attack_Chop' },
  },
  movement: { ...BASE_MOVEMENT, walkForward: 3.0, walkBack: 2.4, dashSpeed: 10, backdashSpeed: 9, jumpForward: 3.8 },
  hurtboxes: KAYKIT_HURTBOXES,
  pushHalfWidth: 0.32,
  attacks: [
    {
      id: 'vesna.jab', name: 'Viper Jab', input: 'light', stance: 'standing', animation: 'jab', animationStart: 0.2,
      startup: 5, active: 3, recovery: 9, damage: 4, hitStun: 15, blockStun: 8, knockback: 1.2,
      height: 'high', hitbox: { kind: 'sphere', x: 0.9, y: 1.35, r: 0.3 }, hitStop: 4, shake: 0.1, sound: 'punch',
    },
    {
      id: 'vesna.straight', name: 'Fang Strike', input: 'heavy', stance: 'standing', animation: 'straight', animationStart: 0.22,
      startup: 11, active: 4, recovery: 18, damage: 9, chipDamage: 1, hitStun: 21, blockStun: 13, knockback: 4.5,
      height: 'mid', hitbox: { kind: 'sphere', x: 0.92, y: 1.25, r: 0.34 }, hitStop: 7, shake: 0.3, sound: 'heavy', lunge: 3.2,
    },
    {
      id: 'vesna.kick', name: 'Ash Kick', input: 'kick', stance: 'standing', animation: 'kick', animationStart: 0.12,
      startup: 8, active: 4, recovery: 14, damage: 7, hitStun: 18, blockStun: 10, knockback: 3.4,
      height: 'mid', hitbox: { kind: 'sphere', x: 1.12, y: 0.9, r: 0.34 }, hitStop: 5, shake: 0.18, sound: 'kick',
    },
    {
      id: 'vesna.lowJab', name: 'Low Bite', input: 'light', stance: 'crouching', animation: 'lowJab', animationStart: 0.2,
      startup: 4, active: 3, recovery: 9, damage: 3, hitStun: 13, blockStun: 7, knockback: 1.6,
      height: 'mid', hitbox: { kind: 'sphere', x: 0.78, y: 0.68, r: 0.28 }, hitStop: 4, shake: 0.08, sound: 'punch',
    },
    {
      id: 'vesna.uppercut', name: 'Rising Ash', input: 'heavy', stance: 'crouching', animation: 'uppercut', animationStart: 0.15,
      startup: 9, active: 5, recovery: 24, damage: 11, chipDamage: 1, hitStun: 30, blockStun: 15, knockback: 2.2, launch: 9,
      knockdown: true, height: 'mid', hitbox: { kind: 'box', x: 0.72, y: 1.25, halfW: 0.36, halfH: 0.6 }, hitStop: 8, shake: 0.45,
      sound: 'heavy',
    },
    {
      id: 'vesna.sweep', name: 'Tail Sweep', input: 'kick', stance: 'crouching', animation: 'sweep', animationStart: 0.12,
      startup: 9, active: 4, recovery: 20, damage: 7, hitStun: 26, blockStun: 11, knockback: 2, knockdown: true,
      height: 'low', hitbox: { kind: 'box', x: 1.05, y: 0.22, halfW: 0.48, halfH: 0.22 }, hitStop: 6, shake: 0.22, sound: 'kick',
    },
    {
      id: 'vesna.jumpPunch', name: 'Diving Claw', input: 'light', stance: 'air', animation: 'jumpPunch', animationStart: 0.2,
      startup: 4, active: 8, recovery: 7, damage: 5, hitStun: 17, blockStun: 9, knockback: 2.2,
      height: 'overhead', hitbox: { kind: 'sphere', x: 0.7, y: 0.95, r: 0.34 }, hitStop: 4, shake: 0.12, sound: 'punch',
    },
    {
      id: 'vesna.jumpSmash', name: 'Raven Drop', input: 'heavy', stance: 'air', animation: 'comboSlam', animationStart: 0.25,
      startup: 7, active: 7, recovery: 9, damage: 9, hitStun: 21, blockStun: 13, knockback: 3.6,
      height: 'overhead', hitbox: { kind: 'box', x: 0.65, y: 0.75, halfW: 0.4, halfH: 0.45 }, hitStop: 7, shake: 0.35, sound: 'heavy',
    },
    {
      id: 'vesna.jumpKick', name: 'Falling Ash', input: 'kick', stance: 'air', animation: 'jumpKick', animationStart: 0.15,
      startup: 5, active: 10, recovery: 7, damage: 8, hitStun: 20, blockStun: 11, knockback: 3.4,
      height: 'overhead', hitbox: { kind: 'sphere', x: 0.9, y: 0.55, r: 0.4 }, hitStop: 6, shake: 0.22, sound: 'kick',
    },
    {
      id: 'vesna.comboSpin', name: 'Viper Spin', input: 'kick', stance: 'standing', animation: 'comboSpin', animationStart: 0,
      startup: 8, active: 8, recovery: 18, damage: 8, hitStun: 24, blockStun: 13, knockback: 7.5,
      height: 'mid', hitbox: { kind: 'box', x: 0.6, y: 1.0, halfW: 0.7, halfH: 0.5 }, hitStop: 7, shake: 0.4, sound: 'kick',
    },
    {
      id: 'vesna.comboSlam', name: 'Ashfall', input: 'heavy', stance: 'standing', animation: 'comboSlam', animationStart: 0.2,
      startup: 11, active: 4, recovery: 24, damage: 11, chipDamage: 2, hitStun: 30, blockStun: 15, knockback: 6,
      knockdown: true, height: 'overhead', hitbox: { kind: 'box', x: 0.88, y: 1.1, halfW: 0.42, halfH: 0.6 }, hitStop: 9,
      shake: 0.55, sound: 'heavy', lunge: 2.4,
    },
  ],
  grab: {
    id: 'vesna.grab', animation: 'grab', startup: 4, active: 3, whiffRecovery: 22, holdFrames: 24, damage: 11,
    range: { kind: 'box', x: 0.6, y: 1.0, halfW: 0.32, halfH: 0.5 }, throwSpeed: 8, throwLaunch: 6.5,
  },
  combos: [
    { id: 'vesna.c1', name: 'VIPER SPIN', inputs: ['light', 'light', 'kick'], finisher: 'vesna.comboSpin', damageMultiplier: 1.15 },
    { id: 'vesna.c2', name: 'ASHFALL', inputs: ['light', 'kick', 'heavy'], finisher: 'vesna.comboSlam', damageMultiplier: 1.2 },
  ],
};
