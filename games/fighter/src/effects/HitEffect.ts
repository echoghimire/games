import * as THREE from 'three';

interface Slash {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  scale: number;
}

/**
 * Short-lived impact visuals that aren't point particles: camera-facing slash
 * arcs and a single pulsing impact light. Both are pooled and preallocated.
 */
export class HitEffect {
  readonly root = new THREE.Group();
  private readonly slashes: Slash[] = [];
  private next = 0;
  private readonly light = new THREE.PointLight(0xffb070, 0, 6, 2);
  private lightLife = 0;
  private lightPeak = 0;

  constructor(slashTexture: THREE.Texture, poolSize = 6) {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: slashTexture,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 30;
      this.root.add(mesh);
      this.slashes.push({ mesh, life: 0, maxLife: 1, scale: 1 });
    }
    // Always in the scene (intensity 0 when idle) so toggling it never recompiles shaders.
    this.root.add(this.light);
  }

  slash(x: number, y: number, facing: number, scale: number, color: number, tilt: number): void {
    const s = this.slashes[this.next];
    this.next = (this.next + 1) % this.slashes.length;
    if (!s) return;
    s.life = s.maxLife = 0.18;
    s.scale = scale;
    s.mesh.visible = true;
    s.mesh.position.set(x, y, 0.4);
    s.mesh.rotation.set(0, 0, tilt * facing);
    s.mesh.scale.set(scale * facing, scale, 1);
    s.mesh.material.color.setHex(color);
    s.mesh.material.opacity = 1;
  }

  flashLight(x: number, y: number, intensity: number, color: number): void {
    this.light.position.set(x, y, 1);
    this.light.color.setHex(color);
    this.lightPeak = intensity;
    this.lightLife = 0.14;
  }

  update(dt: number): void {
    for (const s of this.slashes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const t = 1 - Math.max(0, s.life) / s.maxLife;
      const grow = 0.7 + t * 0.6;
      s.mesh.scale.set(Math.sign(s.mesh.scale.x) * s.scale * grow, s.scale * grow, 1);
      s.mesh.material.opacity = 1 - t;
      if (s.life <= 0) s.mesh.visible = false;
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      this.light.intensity = Math.max(0, this.lightLife / 0.14) * this.lightPeak;
    } else {
      this.light.intensity = 0;
    }
  }

  clear(): void {
    for (const s of this.slashes) {
      s.life = 0;
      s.mesh.visible = false;
    }
    this.lightLife = 0;
    this.light.intensity = 0;
  }

  dispose(): void {
    for (const s of this.slashes) s.mesh.material.dispose();
    this.slashes[0]?.mesh.geometry.dispose();
  }
}
