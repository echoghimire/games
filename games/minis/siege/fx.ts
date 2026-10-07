/**
 * Cheap effects, one draw call each: point-sprite particle systems (projectiles,
 * sparks, smoke) and instanced quads (blob shadows, HP bars, ground splats).
 */
import * as THREE from 'three';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  a: number;
  grav: number;
  drag: number;
}

export interface EmitOpts {
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  color: number;
  alpha?: number;
  grav?: number;
  drag?: number;
}

const tmpColor = new THREE.Color();

/**
 * A pool of camera-facing sprites drawn as GL points. Particles live for `life`
 * seconds and fade out; `put()` adds a one-frame sprite (used for projectiles).
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private live: Particle[] = [];
  private free: Particle[] = [];
  private immediate = 0;

  constructor(
    texture: THREE.Texture,
    additive: boolean,
    private readonly cap = 1500,
  ) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, uScale: { value: 400 } },
      vertexShader: `
        attribute float size;
        attribute vec4 color;
        varying vec4 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = t * vColor;
          if (gl_FragColor.a < 0.01) discard;
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  /** Pixels per world unit at distance 1 (call on resize). */
  setScale(s: number): void {
    this.mat.uniforms.uScale!.value = s;
  }

  emit(x: number, y: number, z: number, o: EmitOpts): void {
    if (this.live.length >= this.cap - 200) return; // keep room for projectiles
    const p = this.free.pop() ?? ({} as Particle);
    tmpColor.setHex(o.color);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.vz = o.vz ?? 0;
    p.life = p.max = o.life;
    p.size0 = o.size;
    p.size1 = o.sizeEnd ?? o.size;
    p.r = tmpColor.r;
    p.g = tmpColor.g;
    p.b = tmpColor.b;
    p.a = o.alpha ?? 1;
    p.grav = o.grav ?? 0;
    p.drag = o.drag ?? 0;
    this.live.push(p);
  }

  /** Radial burst of `n` particles. */
  burst(x: number, y: number, z: number, n: number, speed: number, o: EmitOpts): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 2 - 0.4;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(x, y, z, { ...o, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: up * s * 0.7 + (o.vy ?? 0), life: o.life * (0.6 + Math.random() * 0.6) });
    }
  }

  update(dt: number): void {
    const keep: Particle[] = [];
    for (const p of this.live) {
      p.life -= dt;
      if (p.life <= 0) {
        this.free.push(p);
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k - p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      keep.push(p);
    }
    this.live = keep;
  }

  /** Write live particles into the buffers; follow with put() calls, then flush(). */
  begin(): void {
    let i = 0;
    for (const p of this.live) {
      const t = p.life / p.max;
      this.write(i++, p.x, p.y, p.z, p.size1 + (p.size0 - p.size1) * t, p.r, p.g, p.b, p.a * Math.min(1, t * 2));
    }
    this.immediate = i;
  }

  put(x: number, y: number, z: number, size: number, color: number, alpha = 1): void {
    if (this.immediate >= this.cap) return;
    tmpColor.setHex(color);
    this.write(this.immediate++, x, y, z, size, tmpColor.r, tmpColor.g, tmpColor.b, alpha);
  }

  flush(): void {
    this.geo.setDrawRange(0, this.immediate);
    for (const name of ['position', 'color', 'size']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.free.push(...this.live);
    this.live = [];
  }

  private write(i: number, x: number, y: number, z: number, s: number, r: number, g: number, b: number, a: number): void {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
    this.size[i] = s;
  }
}

/** Soft round sprite drawn on a canvas (glows, shadows). */
export function radialTexture(stops: [number, string][], size = 64): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s = new THREE.Vector3();
const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/**
 * A batch of textured quads rebuilt every frame: either lying flat on the
 * ground (shadows, splats) or facing the camera (HP bars).
 */
export class Quads {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly c = new THREE.Color();

  constructor(material: THREE.Material, cap: number) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.c.set(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  begin(): void {
    this.n = 0;
  }

  /** Flat on the ground at height y, rotated by `yaw`, colour times `bright`. */
  ground(x: number, y: number, z: number, sx: number, sz: number, color: number, yaw = 0, bright = 1): void {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).multiply(flat);
    this.add(x, y, z, sx, sz, color, bright);
  }

  /** Facing the camera (`camQ` = camera quaternion), with a brightness multiplier. */
  billboard(camQ: THREE.Quaternion, x: number, y: number, z: number, sx: number, sy: number, color: number, bright = 1): void {
    q.copy(camQ);
    this.add(x, y, z, sx, sy, color, bright);
  }

  private add(x: number, y: number, z: number, sx: number, sy: number, color: number, bright: number): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    m4.compose(v.set(x, y, z), q, s.set(sx, sy, 1));
    this.mesh.setMatrixAt(this.n, m4);
    this.mesh.setColorAt(this.n, this.c.setHex(color).multiplyScalar(bright));
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
