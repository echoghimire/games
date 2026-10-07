import * as THREE from 'three';

/**
 * Trauma-based screen shake: intensity decays over time and the offset is
 * trauma^2 scaled, so small hits barely move the camera and big ones punch hard.
 */
export class ScreenShake {
  private trauma = 0;
  private time = 0;
  readonly offset = new THREE.Vector3();

  constructor(
    private readonly maxOffset = 0.35,
    private readonly decayPerSecond = 2.2,
    private readonly frequency = 28,
  ) {}

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - this.decayPerSecond * dt);
    const s = this.trauma * this.trauma * this.maxOffset;
    const t = this.time * this.frequency;
    // Sum of incommensurate sines: cheap, smooth pseudo noise without allocations.
    this.offset.set(
      s * (Math.sin(t * 1.0) + 0.5 * Math.sin(t * 2.3 + 1.7)),
      s * (Math.sin(t * 1.3 + 4.1) + 0.5 * Math.sin(t * 2.9 + 0.3)),
      0,
    );
  }

  reset(): void {
    this.trauma = 0;
    this.offset.set(0, 0, 0);
  }
}
