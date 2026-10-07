import type { ShapeDefinition } from './types';

/**
 * World-space 2D collision shape. Instances are preallocated and rewritten
 * every tick, so collision checks don't allocate.
 */
export class WorldShape {
  kind: 'box' | 'sphere' = 'box';
  /** Center. */
  x = 0;
  y = 0;
  /** Box half extents (box) or radius in `halfW` (sphere). */
  halfW = 0;
  halfH = 0;

  /** Place a fighter-local definition into world space. `facing` is +1 (right) or -1 (left). */
  set(def: ShapeDefinition, originX: number, originY: number, facing: number): this {
    this.kind = def.kind;
    this.x = originX + def.x * facing;
    this.y = originY + def.y;
    if (def.kind === 'box') {
      this.halfW = def.halfW;
      this.halfH = def.halfH;
    } else {
      this.halfW = def.r;
      this.halfH = def.r;
    }
    return this;
  }

  get radius(): number {
    return this.halfW;
  }
}

function boxBox(a: WorldShape, b: WorldShape): boolean {
  return Math.abs(a.x - b.x) <= a.halfW + b.halfW && Math.abs(a.y - b.y) <= a.halfH + b.halfH;
}

function sphereSphere(a: WorldShape, b: WorldShape): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.radius + b.radius;
  return dx * dx + dy * dy <= r * r;
}

function sphereBox(s: WorldShape, b: WorldShape): boolean {
  const cx = Math.max(b.x - b.halfW, Math.min(s.x, b.x + b.halfW));
  const cy = Math.max(b.y - b.halfH, Math.min(s.y, b.y + b.halfH));
  const dx = s.x - cx;
  const dy = s.y - cy;
  return dx * dx + dy * dy <= s.radius * s.radius;
}

export function overlaps(a: WorldShape, b: WorldShape): boolean {
  if (a.kind === 'box' && b.kind === 'box') return boxBox(a, b);
  if (a.kind === 'sphere' && b.kind === 'sphere') return sphereSphere(a, b);
  return a.kind === 'sphere' ? sphereBox(a, b) : sphereBox(b, a);
}

/** Midpoint of two overlapping shapes, used as the impact point for effects. */
export function contactPoint(a: WorldShape, b: WorldShape, out: { x: number; y: number }): void {
  out.x = (a.x + b.x) * 0.5;
  out.y = (a.y + b.y) * 0.5;
}
