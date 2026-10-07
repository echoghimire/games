import type { Fighter } from '../characters/Fighter';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, ImpactPoint } from '../game/GameEvents';
import { contactPoint, overlaps, WorldShape } from './Hitbox';
import type { AttackDefinition, AttackHeight } from './types';

export interface CombatConfig {
  /** Max horizontal distance between fighters (keeps both on screen). */
  maxSeparation: number;
  counterDamageBonus: number;
  /** Per-hit damage reduction inside a combo, and its floor. */
  comboScalingStep: number;
  comboScalingMin: number;
}

export const DEFAULT_COMBAT: CombatConfig = {
  maxSeparation: 11,
  counterDamageBonus: 1.2,
  comboScalingStep: 0.08,
  comboScalingMin: 0.55,
};

interface PendingHit {
  attacker: Fighter;
  victim: Fighter;
  attack: AttackDefinition;
  point: ImpactPoint;
}

/**
 * Resolves fighter interactions once per tick, after both fighters have
 * advanced: body pushing, grabs and hitbox vs hurtbox strikes.
 */
export class CombatSystem {
  private readonly grabShape = new WorldShape();
  private readonly bodyShape = new WorldShape();
  private readonly pending: PendingHit[] = [];
  private readonly tmpPoint = { x: 0, y: 0 };

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly stageHalfWidth: () => number,
    private readonly config: CombatConfig = DEFAULT_COMBAT,
  ) {}

  step(a: Fighter, b: Fighter): void {
    this.resolveBodies(a, b);
    this.resolveGrabs(a, b);
    this.resolveStrikes(a, b);
  }

  // ------------------------------------------------------------- bodies

  private resolveBodies(a: Fighter, b: Fighter): void {
    if (a.state === 'grabbed' || b.state === 'grabbed') return;
    const hw = this.stageHalfWidth();
    const minDist = a.config.pushHalfWidth + b.config.pushHalfWidth;
    const dx = b.x - a.x;
    const verticalOverlap = Math.abs(a.y - b.y) < 1.25;
    if (verticalOverlap && Math.abs(dx) < minDist) {
      // Equal split; if one side is pinned to a wall, the other takes the push.
      const dir = dx !== 0 ? Math.sign(dx) : a.facing;
      const push = (minDist - Math.abs(dx)) / 2;
      a.x -= dir * push;
      b.x += dir * push;
      if (a.x < -hw || a.x > hw) {
        const over = a.x < -hw ? -hw - a.x : hw - a.x;
        a.x += over;
        b.x += over;
      }
      if (b.x < -hw || b.x > hw) {
        const over = b.x < -hw ? -hw - b.x : hw - b.x;
        b.x += over;
        a.x += over;
      }
    }
    const gap = b.x - a.x;
    const max = this.config.maxSeparation;
    if (Math.abs(gap) > max) {
      // Whoever moved away last is held back.
      const excess = Math.abs(gap) - max;
      const aMoving = Math.abs(a.x - a.prevX) >= Math.abs(b.x - b.prevX);
      const sign = Math.sign(gap);
      if (aMoving) a.x += sign * excess;
      else b.x -= sign * excess;
    }
  }

  // ------------------------------------------------------------- grabs

  private resolveGrabs(a: Fighter, b: Fighter): void {
    const aCatches = a.grabActive && !a.grabSucceeded && this.grabReaches(a, b);
    const bCatches = b.grabActive && !b.grabSucceeded && this.grabReaches(b, a);
    if (aCatches && bCatches) {
      a.grabTeched();
      b.grabTeched();
      this.events.emit('grabTech', { point: { x: (a.x + b.x) / 2, y: 1.2 } });
    } else if (aCatches) {
      this.connectGrab(a, b);
    } else if (bCatches) {
      this.connectGrab(b, a);
    }
    this.progressHold(a, b);
    this.progressHold(b, a);
  }

  private grabReaches(attacker: Fighter, victim: Fighter): boolean {
    if (!victim.grabbable || victim.invulnerable > 0) return false;
    this.grabShape.set(attacker.config.grab.range, attacker.x, attacker.y, attacker.facing);
    this.bodyShape.set(
      { kind: 'box', x: 0, y: 0.9, halfW: victim.config.pushHalfWidth, halfH: 0.9 },
      victim.x,
      victim.y,
      victim.facing,
    );
    return overlaps(this.grabShape, this.bodyShape);
  }

  private connectGrab(attacker: Fighter, victim: Fighter): void {
    attacker.beginHold(victim);
    this.events.emit('grabConnect', {
      attacker: attacker.index,
      victim: victim.index,
      point: { x: (attacker.x + victim.x) / 2, y: 1.2 },
    });
  }

  private progressHold(attacker: Fighter, victim: Fighter): void {
    if (attacker.state !== 'grabbing') return;
    const g = attacker.config.grab;
    if (attacker.stateFrame < g.holdFrames) return;
    attacker.toNeutral();
    if (victim.heldBy !== attacker) return;
    victim.thrown(attacker, g.damage);
    this.events.emit('throw', {
      attacker: attacker.index,
      victim: victim.index,
      damage: g.damage,
      point: { x: victim.x, y: 1.1 },
      direction: attacker.facing,
    });
  }

  // ------------------------------------------------------------- strikes

  private resolveStrikes(a: Fighter, b: Fighter): void {
    this.pending.length = 0;
    this.checkStrike(a, b);
    this.checkStrike(b, a);
    // Both checks happen before applying, so simultaneous hits trade.
    for (const hit of this.pending) this.applyStrike(hit);
  }

  private checkStrike(attacker: Fighter, victim: Fighter): void {
    if (!attacker.hitboxActive || attacker.attackHasHit || !attacker.attack) return;
    if (!victim.hurtbox.enabled || victim.isKO) return;
    const hb = attacker.hitbox;
    const hurt = victim.hurtbox;
    for (let i = 0; i < hurt.count; i++) {
      const shape = hurt.shapes[i];
      if (shape && overlaps(hb, shape)) {
        contactPoint(hb, shape, this.tmpPoint);
        this.pending.push({
          attacker,
          victim,
          attack: attacker.attack,
          point: { x: this.tmpPoint.x, y: this.tmpPoint.y },
        });
        attacker.attackHasHit = true;
        attacker.hitboxActive = false;
        return;
      }
    }
  }

  private applyStrike({ attacker, victim, attack, point }: PendingHit): void {
    const hw = this.stageHalfWidth();
    if (this.blocks(victim, attacker, attack.height)) {
      victim.receiveBlock(attack, attacker);
      attacker.hitStop = Math.max(2, attack.hitStop - 2);
      this.events.emit('block', { attacker: attacker.index, victim: victim.index, attack, point });
    } else {
      const counter = victim.state === 'attack' && victim.attackPhase !== 'recovery';
      const scaling = Math.max(this.config.comboScalingMin, 1 - this.config.comboScalingStep * victim.comboTaken);
      const raw = attack.damage * attacker.damageMultiplier * scaling * (counter ? this.config.counterDamageBonus : 1);
      const damage = Math.max(1, Math.round(raw));
      victim.receiveHit(attack, attacker, damage, counter);
      attacker.hitStop = attack.hitStop;
      this.events.emit('hit', {
        attacker: attacker.index,
        victim: victim.index,
        attack,
        damage,
        point,
        counter,
        comboCount: victim.comboTaken,
        heavy: attack.shake >= 0.3,
        finisherName: attacker.comboName,
        direction: attacker.facing,
      });
    }
    // Cornered victims can't be pushed further: the attacker recoils instead.
    if (Math.abs(victim.x) >= hw - 0.15 && Math.sign(victim.x) === attacker.facing) {
      attacker.vx = -attacker.facing * attack.knockback * 0.75;
    }
  }

  private blocks(victim: Fighter, attacker: Fighter, height: AttackHeight): boolean {
    if (!victim.isBlocking) return false;
    // Must face the attacker (cross-ups beat a guard facing the wrong way).
    const attackerSide = Math.sign(attacker.x - victim.x) || attacker.facing * -1;
    if (attackerSide !== victim.facing) return false;
    if (height === 'low') return victim.lowBlock;
    if (height === 'overhead') return !victim.lowBlock;
    return true;
  }
}
