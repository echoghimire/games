import * as THREE from 'three';
import type { AssetManager } from '../assets/AssetManager';
import { AnimationController } from './AnimationController';
import type { Fighter } from './Fighter';

const TURN_RATE = 14;
const HIT_FLASH = new THREE.Color(0xff3020);

/**
 * Visual representation of a Fighter: skinned model + animations. It reads
 * the fighter's state every frame and never changes gameplay data.
 */
export class Character {
  readonly root = new THREE.Group();
  readonly animation: AnimationController;
  private readonly model: THREE.Object3D;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private lastSerial = -1;
  private yaw = 0;
  /** World-space bones for effects (e.g. hit sparks on the fist). */
  readonly bones: { readonly head: THREE.Object3D | null; readonly handR: THREE.Object3D | null };

  constructor(
    private readonly fighter: Fighter,
    assets: AssetManager,
  ) {
    const visual = fighter.config.visual;
    this.model = assets.cloneModel(visual.model);
    const hidden = new Set(visual.hiddenNodes);
    this.model.traverse((obj) => {
      if (hidden.has(obj.name)) obj.visible = false;
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = false;
        // Own the materials so the hit flash only affects this instance.
        const mats: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
        const cloned = mats.map((m) => {
          const c = m.clone();
          if (c instanceof THREE.MeshStandardMaterial) this.materials.push(c);
          return c;
        });
        obj.material = Array.isArray(obj.material) ? cloned : (cloned[0] ?? obj.material);
        obj.frustumCulled = false;
      }
    });

    const box = new THREE.Box3().setFromObject(this.model);
    const height = Math.max(0.01, box.max.y - box.min.y);
    this.model.scale.setScalar(visual.height / height);
    this.root.add(this.model);
    this.root.name = `fighter:${fighter.config.id}`;

    this.animation = new AnimationController(this.model, assets.getAnimations(visual.model), fighter.config.animations);
    this.bones = {
      head: this.model.getObjectByName('head') ?? null,
      handR: this.model.getObjectByName('hand.r') ?? null,
    };
    this.yaw = this.targetYaw();
    this.sync(0, 1);
  }

  private targetYaw(): number {
    const v = this.fighter.config.visual;
    // Facing +x is a +90° turn from the model's +z forward; tilt towards the camera.
    return this.fighter.facing > 0 ? Math.PI / 2 - v.cameraYaw : -Math.PI / 2 + v.cameraYaw;
  }

  /** Called every rendered frame. */
  sync(frameDt: number, alpha: number): void {
    const f = this.fighter;
    this.root.position.set(f.prevX + (f.x - f.prevX) * alpha, f.prevY + (f.y - f.prevY) * alpha, 0);

    const target = this.targetYaw();
    const k = 1 - Math.exp(-TURN_RATE * frameDt);
    let diff = target - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * k;
    this.root.rotation.y = this.yaw;

    if (f.anim.serial !== this.lastSerial) {
      this.lastSerial = f.anim.serial;
      this.animation.play(f.anim.key, { duration: f.anim.duration, start: f.anim.start, fade: f.anim.fade });
    }
    // Hit-stop freezes the pose for a crunchy impact.
    this.animation.update(f.hitStop > 0 ? 0 : frameDt);

    const flash = f.flash;
    for (const m of this.materials) {
      m.emissive.copy(HIT_FLASH).multiplyScalar(flash * flash * 0.45);
    }
  }

  dispose(): void {
    this.animation.dispose();
    for (const m of this.materials) m.dispose();
    // Cloned skeletons own their bone textures; geometries stay shared with the asset cache.
    const skeletons = new Set<THREE.Skeleton>();
    this.model.traverse((obj) => {
      if (obj instanceof THREE.SkinnedMesh) skeletons.add(obj.skeleton);
    });
    for (const s of skeletons) s.dispose();
    this.root.removeFromParent();
  }
}
