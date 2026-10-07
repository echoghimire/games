import type { ClipMap } from '../AnimationController';
import type { HurtboxSet, MovementStats } from '../FighterConfig';

/**
 * KayKit Adventurers share one rig and clip set, so their clip map and body
 * shapes are shared. Fighters override what makes them distinct.
 */
export const KAYKIT_CLIPS: ClipMap = {
  idle: { clip: 'Unarmed_Idle', loop: true, fallback: 'intro' },
  intro: { clip: 'Idle', loop: true },
  walkForward: { clip: 'Walking_A', loop: true, speed: 1.1 },
  walkBack: { clip: 'Walking_Backwards', loop: true, speed: 1.1 },
  run: { clip: 'Running_A', loop: true, speed: 1.1 },
  dashForward: { clip: 'Dodge_Forward', speed: 1 },
  dashBack: { clip: 'Dodge_Backward', speed: 1 },
  jumpStart: { clip: 'Jump_Start', speed: 2 },
  jumpAir: { clip: 'Jump_Idle', loop: true },
  land: { clip: 'Jump_Land', speed: 1.8 },
  // No crouch clip: a frozen frame of "sit on chair" reads as a squat.
  crouch: { clip: 'Sit_Chair_Down', pose: 0.55 },
  crouchBlock: { clip: 'Sit_Chair_Down', pose: 0.5 },
  block: { clip: 'Blocking', loop: true },
  blockHit: { clip: 'Block_Hit', speed: 1.4, fallback: 'block' },
  hitHigh: { clip: 'Hit_A', speed: 1.2 },
  hitLow: { clip: 'Hit_B', speed: 1.2 },
  knockdown: { clip: 'Death_A', speed: 1.1 },
  getUp: { clip: 'Lie_StandUp', speed: 1.7, start: 0.05 },
  grab: { clip: 'Throw', speed: 1.3 },
  grabbed: { clip: 'Hit_B', speed: 0.6 },
  victory: { clip: 'Cheer', loop: true },
  defeat: { clip: 'Death_B' },
  jab: { clip: 'Unarmed_Melee_Attack_Punch_A' },
  straight: { clip: 'Unarmed_Melee_Attack_Punch_B' },
  kick: { clip: 'Unarmed_Melee_Attack_Kick' },
  lowJab: { clip: 'Unarmed_Melee_Attack_Punch_A' },
  uppercut: { clip: '1H_Melee_Attack_Slice_Diagonal' },
  sweep: { clip: 'Unarmed_Melee_Attack_Kick' },
  jumpPunch: { clip: 'Unarmed_Melee_Attack_Punch_B' },
  jumpKick: { clip: 'Unarmed_Melee_Attack_Kick' },
  comboSlam: { clip: '2H_Melee_Attack_Chop' },
  comboSpin: { clip: '2H_Melee_Attack_Spinning', speed: 1 },
};

export const KAYKIT_HURTBOXES: HurtboxSet = {
  standing: [
    { kind: 'sphere', x: 0.05, y: 1.55, r: 0.3 },
    { kind: 'box', x: 0, y: 1.0, halfW: 0.32, halfH: 0.32 },
    { kind: 'box', x: 0, y: 0.38, halfW: 0.28, halfH: 0.38 },
  ],
  crouching: [
    { kind: 'sphere', x: 0.1, y: 1.12, r: 0.28 },
    { kind: 'box', x: 0, y: 0.6, halfW: 0.36, halfH: 0.32 },
    { kind: 'box', x: 0, y: 0.18, halfW: 0.32, halfH: 0.18 },
  ],
  airborne: [
    { kind: 'sphere', x: 0.05, y: 1.5, r: 0.3 },
    { kind: 'box', x: 0, y: 0.95, halfW: 0.32, halfH: 0.38 },
    { kind: 'box', x: 0, y: 0.45, halfW: 0.26, halfH: 0.3 },
  ],
};

export const BASE_MOVEMENT: MovementStats = {
  walkForward: 2.6,
  walkBack: 2.0,
  dashSpeed: 9,
  dashFrames: 16,
  runSpeed: 5.6,
  backdashSpeed: 8,
  backdashFrames: 16,
  backdashInvuln: 9,
  jumpVelocity: 9.6,
  jumpForward: 3.4,
  gravity: 27,
  jumpSquat: 3,
  landingLag: 4,
};
