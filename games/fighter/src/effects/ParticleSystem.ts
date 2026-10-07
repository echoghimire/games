import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aRotation;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  varying float vRotation;
  void main() {
    vColor = aColor;
    vRotation = aRotation;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uIntensity;
  varying vec4 vColor;
  varying float vRotation;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float s = sin(vRotation);
    float co = cos(vRotation);
    vec2 uv = vec2(co * c.x - s * c.y, s * c.x + co * c.y) + 0.5;
    vec4 tex = texture2D(uMap, uv);
    gl_FragColor = vec4(vColor.rgb * tex.rgb * uIntensity, vColor.a * tex.a);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

const tmpColor = new THREE.Color();

/**
 * Pooled, allocation-free point-sprite particles: one draw call per system.
 * Data lives in typed arrays (struct of arrays); dead slots are recycled.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly rotations: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly spin: Float32Array;
  private cursor = 0;
  private alive = 0;

  constructor(
    private readonly capacity: number,
    map: THREE.Texture,
    blending: THREE.Blending,
    intensity = 1,
  ) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 4);
    this.sizes = new Float32Array(capacity);
    this.rotations = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aRotation', new THREE.BufferAttribute(this.rotations, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 40);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 400 }, uIntensity: { value: intensity } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 20 : 10;
  }

  /** Pixel scale for point sizes: half the viewport height times the projection's y focal length. */
  setViewport(heightPx: number, camera: THREE.PerspectiveCamera): void {
    const uScale = this.material.uniforms['uScale'];
    if (uScale) uScale.value = heightPx * 0.5 * camera.projectionMatrix.elements[5]!;
  }

  /**
   * Spawn one particle. Positional parameters avoid allocating spawn objects.
   * `size` is in world units at spawn, interpolated to `sizeEnd` over its life.
   */
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    sizeEnd: number,
    color: number,
    alpha: number,
    gravity = 0,
    drag = 0,
    spin = 0,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.life[i]! <= 0) this.alive++;
    const i3 = i * 3;
    const i4 = i * 4;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size1[i] = sizeEnd;
    this.sizes[i] = size;
    tmpColor.setHex(color);
    this.colors[i4] = tmpColor.r;
    this.colors[i4 + 1] = tmpColor.g;
    this.colors[i4 + 2] = tmpColor.b;
    this.colors[i4 + 3] = alpha;
    this.alpha0[i] = alpha;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.rotations[i] = Math.random() * Math.PI * 2;
    this.spin[i] = spin;
  }

  update(dt: number): void {
    if (this.alive <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      let l = this.life[i]!;
      if (l <= 0) continue;
      l -= dt;
      const i3 = i * 3;
      if (l <= 0) {
        this.life[i] = 0;
        this.sizes[i] = 0;
        this.colors[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      this.life[i] = l;
      const t = 1 - l / this.maxLife[i]!;
      const d = Math.max(0, 1 - this.drag[i]! * dt);
      let vx = this.vel[i3]! * d;
      let vy = this.vel[i3 + 1]! * d - this.gravity[i]! * dt;
      let vz = this.vel[i3 + 2]! * d;
      this.positions[i3] = this.positions[i3]! + vx * dt;
      this.positions[i3 + 1] = this.positions[i3 + 1]! + vy * dt;
      this.positions[i3 + 2] = this.positions[i3 + 2]! + vz * dt;
      // Simple floor bounce for heavy droplets.
      if (this.positions[i3 + 1]! < 0.02 && this.gravity[i]! > 0) {
        this.positions[i3 + 1] = 0.02;
        vy *= -0.2;
        vx *= 0.5;
        vz *= 0.5;
      }
      this.vel[i3] = vx;
      this.vel[i3 + 1] = vy;
      this.vel[i3 + 2] = vz;
      this.sizes[i] = this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t;
      // Fade in quickly, fade out over the second half of the life.
      const fade = t < 0.1 ? t / 0.1 : t > 0.5 ? 1 - (t - 0.5) / 0.5 : 1;
      this.colors[i * 4 + 3] = this.alpha0[i]! * fade;
      this.rotations[i] = this.rotations[i]! + this.spin[i]! * dt;
    }
    this.alive = alive;
    const g = this.geometry.attributes;
    g['position']!.needsUpdate = true;
    g['aColor']!.needsUpdate = true;
    g['aSize']!.needsUpdate = true;
    g['aRotation']!.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.sizes.fill(0);
    this.alive = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
