import { attackPhase, MoveList, totalFrames, type AttackPhase } from '../combat/AttackSystem';
import { ComboSystem } from '../combat/ComboSystem';
import { WorldShape } from '../combat/Hitbox';
import { Hurtbox, type Posture } from '../combat/Hurtbox';
import type { AttackDefinition, AttackInput, AttackStance } from '../combat/types';
import type { EventBus } from '../core/EventBus';
import { Action, has, type InputFrame } from '../input/Actions';
import type { GameEvents, PlayerIndex } from '../game/GameEvents';
import { SIM_DT } from '../game/GameLoop';
import type { AnimKey } from './AnimKeys';
import type { FighterConfig } from './FighterConfig';

export type FighterState =
  | 'intro'
  | 'idle'
  | 'walk'
  | 'crouch'
  | 'jumpSquat'
  | 'air'
  | 'land'
  | 'dash'
  | 'run'
  | 'backdash'
  | 'block'
  | 'blockstun'
  | 'attack'
  | 'grab'
  | 'grabbing'
  | 'grabbed'
  | 'hitstun'
  | 'launched'
  | 'knockdown'
  | 'getup'
  | 'ko'
  | 'victory';

/** What the visual layer should be playing. Bumping `serial` restarts the clip. */
export interface AnimRequest {
  key: AnimKey;
  serial: number;
  duration: number;
  start: number;
  fade: number;
}

export interface FighterContext {
  readonly events: EventBus<GameEvents>;
  readonly stageHalfWidth: number;
}

const DASH_WINDOW = 12;
const INPUT_BUFFER = 8;
const COMBO_BUFFER = 18;
const KNOCKDOWN_FRAMES = 42;
const GETUP_FRAMES = 34;
const GROUND_FRICTION = 22;
const AIR_ATTACK_LANDING_LAG = 6;

const GRABBABLE_STATES: ReadonlySet<FighterState> = new Set<FighterState>([
  'idle',
  'walk',
  'crouch',
  'block',
  'land',
  'attack',
  'dash',
  'run',
  'grab',
]);

const ATTACK_BITS: ReadonlyArray<readonly [number, AttackInput]> = [
  [Action.Light, 'light'],
  [Action.Heavy, 'heavy'],
  [Action.Kick, 'kick'],
];

/**
 * Gameplay-side fighter: a deterministic state machine advanced once per
 * fixed tick from an InputFrame. It knows nothing about Three.js meshes.
 */
export class Fighter {
  readonly moves: MoveList;
  readonly hurtbox: Hurtbox;
  /** World-space active hitbox; valid when `hitboxActive` is true. */
  readonly hitbox = new WorldShape();
  hitboxActive = false;

  x = 0;
  y = 0;
  prevX = 0;
  prevY = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  health: number;

  state: FighterState = 'intro';
  stateFrame = 0;
  private stateDuration = 0;

  attack: AttackDefinition | null = null;
  attackFrame = 0;
  attackHasHit = false;
  damageMultiplier = 1;
  comboName: string | null = null;
  private readonly combo: ComboSystem;
  private bufferedAttack: AttackInput | null = null;
  private bufferedAge = 0;
  private airAttackUsed = false;

  hitStop = 0;
  /** Remaining strike invulnerability frames. */
  invulnerable = 0;
  lowBlock = false;
  /** Hits taken in the current combo (resets once the fighter recovers). */
  comboTaken = 0;
  /** Set by the CombatSystem while held in a grab. */
  heldBy: Fighter | null = null;
  grabSucceeded = false;

  inputEnabled = false;
  readonly anim: AnimRequest = { key: 'intro', serial: 0, duration: 0, start: 0, fade: 0.15 };
  /** Last hit flash time for the view (0..1). */
  flash = 0;

  private lastForwardPress = -100;
  private lastBackPress = -100;
  private tick = 0;
  private jumpDir = 0;
  private walkingBack = false;

  constructor(
    readonly index: PlayerIndex,
    readonly config: FighterConfig,
    private readonly ctx: FighterContext,
  ) {
    this.moves = new MoveList(config.attacks);
    this.combo = new ComboSystem(config.combos);
    this.hurtbox = new Hurtbox(config.hurtboxes);
    this.health = config.maxHealth;
  }

  // ---------------------------------------------------------------- queries

  get grounded(): boolean {
    return this.y <= 0 && this.vy <= 0;
  }

  get posture(): Posture {
    if (this.y > 0.05) return 'airborne';
    if (this.state === 'crouch' || (this.state === 'attack' && this.attack?.stance === 'crouching')) return 'crouching';
    if ((this.state === 'block' || this.state === 'blockstun') && this.lowBlock) return 'crouching';
    return 'standing';
  }

  get attackPhase(): AttackPhase | null {
    return this.attack ? attackPhase(this.attack, this.attackFrame) : null;
  }

  get isBlocking(): boolean {
    return this.state === 'block' || this.state === 'blockstun';
  }

  get isKO(): boolean {
    return this.state === 'ko';
  }

  /** Can be hit by strikes. */
  get strikeable(): boolean {
    return this.invulnerable <= 0 && this.state !== 'knockdown' && this.state !== 'getup' && this.state !== 'grabbed' && this.state !== 'intro';
  }

  /** Can be grabbed. */
  get grabbable(): boolean {
    return (
      this.grounded &&
      GRABBABLE_STATES.has(this.state) &&
      !(this.state === 'attack' && this.attack?.stance === 'air')
    );
  }

  // ---------------------------------------------------------------- lifecycle

  reset(x: number, facing: 1 | -1): void {
    this.x = this.prevX = x;
    this.y = this.prevY = 0;
    this.vx = this.vy = 0;
    this.facing = facing;
    this.health = this.config.maxHealth;
    this.attack = null;
    this.hitboxActive = false;
    this.hitStop = 0;
    this.invulnerable = 0;
    this.comboTaken = 0;
    this.heldBy = null;
    this.flash = 0;
    this.inputEnabled = false;
    this.combo.reset();
    this.bufferedAttack = null;
    this.setState('intro');
    this.playAnim('intro', { fade: 0 });
  }

  /** One fixed simulation tick. */
  update(input: InputFrame, opponent: Fighter): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.tick++;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - SIM_DT * 5);

    const frame = this.inputEnabled ? input : NO_INPUT;
    // Buffer before hit-stop so presses during the freeze (hit-confirms) count.
    this.bufferAttack(frame);

    if (this.hitStop > 0) {
      this.hitStop--;
      return;
    }

    if (this.invulnerable > 0) this.invulnerable--;
    this.stateFrame++;

    switch (this.state) {
      case 'intro':
      case 'victory':
        this.vx = 0;
        break;
      case 'idle':
      case 'walk':
      case 'crouch':
      case 'block':
        this.faceOpponent(opponent);
        this.neutral(frame);
        break;
      case 'land':
        if (this.stateFrame >= this.stateDuration) this.neutral(frame);
        break;
      case 'jumpSquat':
        if (this.stateFrame >= this.stateDuration) this.takeOff();
        break;
      case 'air':
        this.updateAir();
        break;
      case 'dash':
        if (this.stateFrame >= this.stateDuration) {
          if (has(frame.held, this.facing > 0 ? Action.Right : Action.Left)) {
            this.setState('run');
            this.playAnim('run', { fade: 0.12 });
          } else {
            this.vx = 0;
            this.toNeutral();
          }
        }
        break;
      case 'run':
        this.updateRun(frame, opponent);
        break;
      case 'backdash':
        if (this.stateFrame >= this.stateDuration) {
          this.vx = 0;
          this.toNeutral();
        }
        break;
      case 'attack':
        this.updateAttack(frame);
        break;
      case 'grab':
        if (this.stateFrame >= this.stateDuration) this.toNeutral();
        break;
      case 'grabbing':
      case 'grabbed':
        // Driven by the CombatSystem.
        break;
      case 'blockstun':
        if (this.stateFrame >= this.stateDuration) {
          if (has(frame.held, Action.Block)) this.enterBlock(has(frame.held, Action.Down), false);
          else this.toNeutral();
        }
        break;
      case 'hitstun':
        if (this.stateFrame >= this.stateDuration) this.toNeutral();
        break;
      case 'launched':
        break;
      case 'knockdown':
        if (this.stateFrame >= this.stateDuration) {
          this.setState('getup', GETUP_FRAMES);
          this.playAnim('getUp', { duration: GETUP_FRAMES * SIM_DT, fade: 0.05 });
        }
        break;
      case 'getup':
        if (this.stateFrame >= this.stateDuration) {
          this.invulnerable = 6;
          this.toNeutral();
        }
        break;
      case 'ko':
        break;
    }

    this.recordDirectionTaps(frame);
    this.integrate();
    this.updateBoxes();
  }

  // ---------------------------------------------------------------- neutral

  private neutral(input: InputFrame): void {
    const fwdBit = this.facing > 0 ? Action.Right : Action.Left;
    const backBit = this.facing > 0 ? Action.Left : Action.Right;
    const down = has(input.held, Action.Down);

    if (has(input.pressed, Action.Grab)) {
      this.startGrab();
      return;
    }
    const buffered = this.consumeBuffered(INPUT_BUFFER);
    if (buffered) {
      if (this.startAttack(down ? 'crouching' : 'standing', buffered)) return;
    }
    if (has(input.held, Action.Up)) {
      this.jumpDir = has(input.held, fwdBit) ? this.facing : has(input.held, backBit) ? -this.facing : 0;
      this.setState('jumpSquat', this.config.movement.jumpSquat);
      this.vx = 0;
      this.playAnim('jumpStart', { fade: 0.05 });
      return;
    }
    if (has(input.pressed, fwdBit) && this.tick - this.lastForwardPress <= DASH_WINDOW) {
      this.startDash(false);
      return;
    }
    if (has(input.pressed, backBit) && this.tick - this.lastBackPress <= DASH_WINDOW) {
      this.startDash(true);
      return;
    }
    if (has(input.held, Action.Block)) {
      this.enterBlock(down, this.state !== 'block' || this.lowBlock !== down);
      return;
    }
    if (down) {
      if (this.state !== 'crouch') {
        this.setState('crouch');
        this.playAnim('crouch', { fade: 0.08 });
      }
      this.vx = 0;
      return;
    }
    const m = this.config.movement;
    if (has(input.held, fwdBit) !== has(input.held, backBit)) {
      const back = has(input.held, backBit);
      this.vx = back ? -this.facing * m.walkBack : this.facing * m.walkForward;
      if (this.state !== 'walk' || this.walkingBack !== back) {
        this.walkingBack = back;
        this.setState('walk');
        this.playAnim(back ? 'walkBack' : 'walkForward', { fade: 0.15 });
      }
      return;
    }
    this.vx = 0;
    if (this.state !== 'idle') {
      this.setState('idle');
      this.playAnim('idle', { fade: 0.15 });
    }
  }

  /** Return to the appropriate neutral state right away. */
  toNeutral(): void {
    this.attack = null;
    this.hitboxActive = false;
    this.comboTaken = 0;
    this.combo.reset();
    this.setState('idle');
    this.playAnim('idle', { fade: 0.15 });
  }

  private enterBlock(low: boolean, restartAnim: boolean): void {
    this.vx = 0;
    this.lowBlock = low;
    this.setState('block');
    if (restartAnim) this.playAnim(low ? 'crouchBlock' : 'block', { fade: 0.06 });
  }

  private startDash(back: boolean): void {
    const m = this.config.movement;
    const frames = back ? m.backdashFrames : m.dashFrames;
    this.setState(back ? 'backdash' : 'dash', frames);
    this.vx = (back ? -m.backdashSpeed : m.dashSpeed) * this.facing;
    if (back) this.invulnerable = m.backdashInvuln;
    this.playAnim(back ? 'dashBack' : 'dashForward', { duration: frames * SIM_DT, fade: 0.05 });
    this.ctx.events.emit('dash', { fighter: this.index, x: this.x, back });
  }

  /** Running: holding forward after a dash. Any other input drops back to neutral handling. */
  private updateRun(input: InputFrame, opponent: Fighter): void {
    const fwdBit = this.facing > 0 ? Action.Right : Action.Left;
    const otherInput =
      input.pressed & (Action.Light | Action.Heavy | Action.Kick | Action.Grab | Action.Up | Action.Block | Action.Down);
    if (!has(input.held, fwdBit) || otherInput !== 0 || has(input.held, Action.Down) || has(input.held, Action.Up)) {
      this.vx = 0;
      this.setState('idle');
      this.neutral(input);
      return;
    }
    this.vx = this.facing * this.config.movement.runSpeed;
    // Stop when running into the opponent's body.
    if (Math.abs(opponent.x - this.x) < this.config.pushHalfWidth + opponent.config.pushHalfWidth + 0.05) {
      this.vx = 0;
      this.toNeutral();
    }
  }

  private takeOff(): void {
    const m = this.config.movement;
    this.vy = m.jumpVelocity;
    this.vx = this.jumpDir * m.jumpForward;
    this.y = 0.001;
    this.airAttackUsed = false;
    this.setState('air');
    this.playAnim('jumpAir', { fade: 0.1 });
    this.ctx.events.emit('jump', { fighter: this.index, x: this.x });
  }

  private updateAir(): void {
    if (this.airAttackUsed) return;
    const buffered = this.consumeBuffered(INPUT_BUFFER);
    if (buffered && this.startAttack('air', buffered)) this.airAttackUsed = true;
  }

  // ---------------------------------------------------------------- attacks

  private startAttack(stance: AttackStance, input: AttackInput): boolean {
    const def = this.moves.find(stance, input);
    if (!def) return false;
    this.combo.begin(input);
    this.performAttack(def, 1, null);
    return true;
  }

  private performAttack(def: AttackDefinition, multiplier: number, comboName: string | null): void {
    this.attack = def;
    this.attackFrame = 0;
    this.attackHasHit = false;
    this.damageMultiplier = multiplier;
    this.comboName = comboName;
    this.hitboxActive = false;
    if (def.stance !== 'air') this.vx = 0;
    this.setState('attack', totalFrames(def));
    const durationFrames = def.stance === 'air' ? def.startup + def.active + def.recovery + 6 : totalFrames(def);
    this.playAnim(def.animation, { duration: durationFrames * SIM_DT, start: def.animationStart ?? 0, fade: 0.06 });
    this.ctx.events.emit('attackStart', { fighter: this.index, attack: def });
  }

  private updateAttack(input: InputFrame): void {
    const def = this.attack;
    if (!def) {
      this.toNeutral();
      return;
    }
    this.attackFrame++;
    const phase = attackPhase(def, this.attackFrame);
    this.hitboxActive = phase === 'active' && !this.attackHasHit;

    if (def.lunge && (phase === 'startup' || phase === 'active')) this.vx = this.facing * def.lunge;
    else if (def.stance !== 'air') this.vx = approach(this.vx, 0, GROUND_FRICTION * SIM_DT);

    // Combo chaining: cancel into the next step from the end of the active
    // window, or immediately after the hit lands.
    const cancelable = def.stance === 'standing' && (phase === 'recovery' || (this.attackHasHit && phase === 'active'));
    if (cancelable && this.bufferedAttack) {
      const step = this.combo.tryContinue(this.bufferedAttack);
      if (step) {
        const nextInput = this.bufferedAttack;
        this.bufferedAttack = null;
        const next = step.finisherId ? this.moves.get(step.finisherId) : this.moves.find('standing', nextInput);
        if (next) {
          this.performAttack(next, step.damageMultiplier, step.comboName);
          return;
        }
      }
    }

    if (def.stance === 'air') {
      // Air attacks last until landing; the hitbox simply expires.
      return;
    }
    if (phase === 'done') {
      this.attack = null;
      this.hitboxActive = false;
      if (has(input.held, Action.Down)) {
        this.setState('crouch');
        this.playAnim('crouch', { fade: 0.1 });
      } else {
        this.toNeutral();
      }
    }
  }

  private startGrab(): void {
    const g = this.config.grab;
    this.attack = null;
    this.grabSucceeded = false;
    this.vx = 0;
    this.setState('grab', g.startup + g.active + g.whiffRecovery);
    this.playAnim('grab', { duration: (g.startup + g.active + g.whiffRecovery) * SIM_DT, fade: 0.05 });
    this.ctx.events.emit('grabStart', { fighter: this.index });
  }

  /** True while the grab can catch the opponent. */
  get grabActive(): boolean {
    const g = this.config.grab;
    return this.state === 'grab' && this.stateFrame > g.startup && this.stateFrame <= g.startup + g.active;
  }

  // ---------------------------------------------------------------- reactions (called by CombatSystem)

  receiveHit(attack: AttackDefinition, attacker: Fighter, damage: number, counter: boolean): void {
    this.applyDamage(damage);
    this.attack = null;
    this.hitboxActive = false;
    this.combo.reset();
    this.bufferedAttack = null;
    this.comboTaken++;
    this.flash = 1;
    const dir = attacker.facing;
    this.vx = dir * attack.knockback;
    this.hitStop = attack.hitStop;

    if (this.health <= 0) {
      this.enterKO(dir, attack.launch ?? 4.5);
      return;
    }
    const airborne = this.y > 0.05;
    if (attack.launch || airborne || attack.knockdown) {
      this.vy = attack.launch ?? (airborne ? 4 : 2.5);
      this.y = Math.max(this.y, 0.001);
      this.setState('launched');
      this.playAnim('knockdown', { duration: 0.75, fade: 0.05 });
      return;
    }
    const stun = attack.hitStun + (counter ? 6 : 0);
    this.setState('hitstun', stun);
    this.playAnim(attack.height === 'low' || this.comboTaken % 2 === 0 ? 'hitLow' : 'hitHigh', {
      duration: Math.max(stun, 14) * SIM_DT,
      fade: 0.04,
    });
  }

  receiveBlock(attack: AttackDefinition, attacker: Fighter): void {
    this.applyDamage(attack.chipDamage ?? 0);
    this.vx = attacker.facing * attack.knockback * 0.8;
    this.hitStop = Math.max(2, attack.hitStop - 2);
    this.setState('blockstun', attack.blockStun);
    this.playAnim(this.lowBlock ? 'crouchBlock' : 'blockHit', { duration: attack.blockStun * SIM_DT, fade: 0.03 });
    if (this.health <= 0) this.enterKO(attacker.facing, 3);
  }

  /** Grab connected: the victim is held in front of the attacker. */
  beginHold(victim: Fighter): void {
    const g = this.config.grab;
    this.grabSucceeded = true;
    this.setState('grabbing', g.holdFrames);
    this.vx = 0;
    victim.attack = null;
    victim.hitboxActive = false;
    victim.heldBy = this;
    victim.vx = victim.vy = 0;
    victim.y = 0;
    victim.combo.reset();
    victim.setState('grabbed', g.holdFrames);
    victim.facing = this.facing === 1 ? -1 : 1;
    victim.playAnim('grabbed', { duration: g.holdFrames * SIM_DT, fade: 0.05 });
  }

  /** Called on the victim at the end of the hold. */
  thrown(by: Fighter, damage: number): void {
    const g = by.config.grab;
    this.heldBy = null;
    this.applyDamage(damage);
    this.flash = 1;
    this.comboTaken++;
    this.vx = by.facing * g.throwSpeed;
    if (this.health <= 0) {
      this.enterKO(by.facing, g.throwLaunch);
      return;
    }
    this.vy = g.throwLaunch;
    this.y = 0.001;
    this.setState('launched');
    this.playAnim('knockdown', { duration: 0.8, fade: 0.05 });
  }

  /** Pushes both fighters apart after a grab clash. */
  grabTeched(): void {
    this.vx = -this.facing * 5;
    this.setState('hitstun', 14);
    this.playAnim('hitHigh', { duration: 14 * SIM_DT, fade: 0.04 });
  }

  private applyDamage(amount: number): void {
    if (amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.ctx.events.emit('health', { fighter: this.index, health: this.health, max: this.config.maxHealth });
  }

  private enterKO(dir: number, launch: number): void {
    this.attack = null;
    this.hitboxActive = false;
    this.heldBy = null;
    this.inputEnabled = false;
    this.vx = dir * 4;
    this.vy = launch;
    this.y = Math.max(this.y, 0.001);
    this.setState('ko');
    this.playAnim('defeat', { fade: 0.05 });
  }

  win(): void {
    this.inputEnabled = false;
    this.attack = null;
    this.hitboxActive = false;
    this.vx = 0;
    this.setState('victory');
    this.playAnim('victory', { fade: 0.3 });
  }

  // ---------------------------------------------------------------- physics

  private integrate(): void {
    const dt = SIM_DT;
    const airborne = this.y > 0 || this.vy > 0;
    if (this.state === 'grabbed') {
      const holder = this.heldBy;
      if (holder) {
        this.x = holder.x + holder.facing * 0.72;
        this.y = 0;
      }
      return;
    }
    if (airborne) {
      this.vy -= this.config.movement.gravity * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.onLanded();
      }
    } else {
      this.x += this.vx * dt;
      const sliding =
        this.state === 'hitstun' || this.state === 'blockstun' || this.state === 'knockdown' || this.state === 'ko' || this.state === 'land';
      if (sliding) this.vx = approach(this.vx, 0, GROUND_FRICTION * dt);
    }
    const hw = this.ctx.stageHalfWidth;
    if (this.x < -hw) {
      this.x = -hw;
      if (this.vx < 0) this.vx = 0;
    } else if (this.x > hw) {
      this.x = hw;
      if (this.vx > 0) this.vx = 0;
    }
  }

  private onLanded(): void {
    switch (this.state) {
      case 'air':
        this.landNormally(this.config.movement.landingLag);
        break;
      case 'attack':
        this.attack = null;
        this.hitboxActive = false;
        this.landNormally(AIR_ATTACK_LANDING_LAG);
        break;
      case 'launched':
        this.vx *= 0.4;
        this.setState('knockdown', KNOCKDOWN_FRAMES);
        this.ctx.events.emit('knockdown', { fighter: this.index, x: this.x });
        this.ctx.events.emit('land', { fighter: this.index, x: this.x, hard: true });
        break;
      case 'ko':
        this.vx *= 0.3;
        this.ctx.events.emit('land', { fighter: this.index, x: this.x, hard: true });
        break;
      default:
        break;
    }
  }

  private landNormally(lag: number): void {
    this.vx = 0;
    this.setState('land', lag);
    this.playAnim('land', { duration: Math.max(lag, 8) * SIM_DT, fade: 0.05 });
    this.ctx.events.emit('land', { fighter: this.index, x: this.x, hard: false });
  }

  private updateBoxes(): void {
    this.hurtbox.enabled = this.strikeable;
    this.hurtbox.update(this.posture, this.x, this.y, this.facing);
    if (this.hitboxActive && this.attack) this.hitbox.set(this.attack.hitbox, this.x, this.y, this.facing);
  }

  faceOpponent(opponent: Fighter): void {
    const dx = opponent.x - this.x;
    if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
  }

  // ---------------------------------------------------------------- input helpers

  /** Remember direction taps (after neutral() compared them with the previous tap) for dash detection. */
  private recordDirectionTaps(input: InputFrame): void {
    const fwdBit = this.facing > 0 ? Action.Right : Action.Left;
    const backBit = this.facing > 0 ? Action.Left : Action.Right;
    if (has(input.pressed, fwdBit)) this.lastForwardPress = this.tick;
    if (has(input.pressed, backBit)) this.lastBackPress = this.tick;
  }

  private bufferAttack(input: InputFrame): void {
    for (const [bit, name] of ATTACK_BITS) {
      if (has(input.pressed, bit)) {
        this.bufferedAttack = name;
        this.bufferedAge = 0;
      }
    }
    if (this.bufferedAttack) {
      this.bufferedAge++;
      if (this.bufferedAge > COMBO_BUFFER) this.bufferedAttack = null;
    }
  }

  private consumeBuffered(maxAge: number): AttackInput | null {
    const b = this.bufferedAttack;
    if (!b || this.bufferedAge > maxAge) return null;
    this.bufferedAttack = null;
    return b;
  }

  // ---------------------------------------------------------------- state/anim helpers

  private setState(state: FighterState, duration = 0): void {
    this.state = state;
    this.stateFrame = 0;
    this.stateDuration = duration;
  }

  playAnim(key: AnimKey, opts: { duration?: number; start?: number; fade?: number } = {}): void {
    this.anim.key = key;
    this.anim.serial++;
    this.anim.duration = opts.duration ?? 0;
    this.anim.start = opts.start ?? 0;
    this.anim.fade = opts.fade ?? 0.15;
  }
}

const NO_INPUT: InputFrame = { held: 0, pressed: 0 };

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}
