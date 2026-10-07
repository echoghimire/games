import * as THREE from 'three';
import type { Fighter } from '../characters/Fighter';
import type { WorldShape } from '../combat/Hitbox';

const MAX_SHAPES = 8;

/** Toggleable (F1) wireframe overlay of hurtboxes (green), hitboxes (red) and pushboxes (blue). */
export class HitboxDebug {
  readonly root = new THREE.Group();
  private readonly boxes: THREE.LineSegments[] = [];
  private readonly circles: THREE.LineLoop[] = [];
  private readonly hurtMat = new THREE.LineBasicMaterial({ color: 0x33ff66, depthTest: false });
  private readonly hitMat = new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false });
  private readonly pushMat = new THREE.LineBasicMaterial({ color: 0x3399ff, depthTest: false });
  private readonly boxGeo: THREE.BufferGeometry;
  private readonly circleGeo: THREE.BufferGeometry;
  private usedBoxes = 0;
  private usedCircles = 0;

  constructor() {
    this.boxGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(2, 2));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(t), Math.sin(t), 0));
    }
    this.circleGeo = new THREE.BufferGeometry().setFromPoints(pts);
    for (let i = 0; i < MAX_SHAPES * 2; i++) {
      const b = new THREE.LineSegments(this.boxGeo, this.hurtMat);
      const c = new THREE.LineLoop(this.circleGeo, this.hurtMat);
      b.renderOrder = c.renderOrder = 999;
      this.boxes.push(b);
      this.circles.push(c);
      this.root.add(b, c);
    }
    this.root.visible = false;
  }

  toggle(): void {
    this.root.visible = !this.root.visible;
  }

  update(fighters: readonly Fighter[]): void {
    if (!this.root.visible) return;
    this.usedBoxes = 0;
    this.usedCircles = 0;
    for (const f of fighters) {
      if (f.hurtbox.enabled) for (let i = 0; i < f.hurtbox.count; i++) this.draw(f.hurtbox.shapes[i], this.hurtMat);
      if (f.hitboxActive) this.draw(f.hitbox, this.hitMat);
      this.drawRaw('box', f.x, f.y + 0.9, f.config.pushHalfWidth, 0.9, this.pushMat);
    }
    for (let i = this.usedBoxes; i < this.boxes.length; i++) this.boxes[i]!.visible = false;
    for (let i = this.usedCircles; i < this.circles.length; i++) this.circles[i]!.visible = false;
  }

  private draw(s: WorldShape | undefined, mat: THREE.LineBasicMaterial): void {
    if (s) this.drawRaw(s.kind, s.x, s.y, s.halfW, s.halfH, mat);
  }

  private drawRaw(kind: 'box' | 'sphere', x: number, y: number, hw: number, hh: number, mat: THREE.LineBasicMaterial): void {
    const obj = kind === 'box' ? this.boxes[this.usedBoxes++] : this.circles[this.usedCircles++];
    if (!obj) return;
    obj.visible = true;
    obj.material = mat;
    obj.position.set(x, y, 0);
    obj.scale.set(hw, hh, 1);
  }
}
