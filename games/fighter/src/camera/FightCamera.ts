import * as THREE from 'three';
import { ScreenShake } from '../effects/ScreenShake';

export interface FightCameraConfig {
  fov: number;
  /** Camera distance on Z when fighters are close / far apart. */
  minDistance: number;
  maxDistance: number;
  /** Horizontal fighter gap that maps to min / max distance. */
  minGap: number;
  maxGap: number;
  height: number;
  lookHeight: number;
  /** Horizontal clamp of the camera focus (keeps the frame inside the arena). */
  focusLimitX: number;
  /** Exponential smoothing rate (1/s). */
  followRate: number;
  /** Small parallax swing so the view feels alive. */
  swayAmount: number;
}

export const DEFAULT_CAMERA: FightCameraConfig = {
  fov: 38,
  minDistance: 6.6,
  maxDistance: 11.5,
  minGap: 2,
  maxGap: 12,
  height: 2.3,
  lookHeight: 1.3,
  focusLimitX: 5.5,
  followRate: 5,
  swayAmount: 0.25,
};

/**
 * Side-on fighting game camera: frames the midpoint between fighters,
 * zooms with their distance (clamped), adds sway and screen shake.
 * It is not free-roaming: the only inputs are the fighters' positions.
 */
export class FightCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly shake = new ScreenShake();
  private readonly focus = new THREE.Vector3();
  private readonly targetFocus = new THREE.Vector3();
  private distance: number;
  private time = 0;
  private readonly lookAt = new THREE.Vector3();

  constructor(private readonly config: FightCameraConfig = DEFAULT_CAMERA) {
    this.camera = new THREE.PerspectiveCamera(config.fov, 16 / 9, 0.1, 200);
    this.distance = config.minDistance;
    this.camera.position.set(0, config.height, this.distance);
  }

  /** Instantly frame the given fighter positions (round start). */
  snap(a: THREE.Vector3, b: THREE.Vector3): void {
    this.computeTarget(a, b);
    this.focus.copy(this.targetFocus);
    this.distance = this.targetDistance(a, b);
    this.shake.reset();
    this.apply();
  }

  update(dt: number, a: THREE.Vector3, b: THREE.Vector3): void {
    this.time += dt;
    this.computeTarget(a, b);
    const k = 1 - Math.exp(-this.config.followRate * dt);
    this.focus.lerp(this.targetFocus, k);
    this.distance += (this.targetDistance(a, b) - this.distance) * k;
    this.shake.update(dt);
    this.apply();
  }

  private computeTarget(a: THREE.Vector3, b: THREE.Vector3): void {
    const c = this.config;
    const midX = THREE.MathUtils.clamp((a.x + b.x) * 0.5, -c.focusLimitX, c.focusLimitX);
    // Follow jumps only partially so the horizon doesn't bob too much.
    const midY = Math.max(a.y, b.y) * 0.35;
    this.targetFocus.set(midX, midY, 0);
  }

  private targetDistance(a: THREE.Vector3, b: THREE.Vector3): number {
    const c = this.config;
    const gap = Math.abs(a.x - b.x);
    const t = THREE.MathUtils.smoothstep(gap, c.minGap, c.maxGap);
    return THREE.MathUtils.lerp(c.minDistance, c.maxDistance, t);
  }

  private apply(): void {
    const c = this.config;
    const sway = Math.sin(this.time * 0.35) * c.swayAmount;
    const s = this.shake.offset;
    this.camera.position.set(this.focus.x + sway + s.x, c.height + this.focus.y + s.y, this.distance);
    this.lookAt.set(this.focus.x + s.x * 0.5, c.lookHeight + this.focus.y + s.y * 0.5, 0);
    this.camera.lookAt(this.lookAt);
  }
}
