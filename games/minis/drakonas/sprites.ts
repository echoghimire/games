/**
 * Flat glowing quads drawn in batches (one InstancedMesh, one draw call each)
 * plus the small canvas textures they use. Bullets, sparks, fire, pickups and
 * blob shadows are all sprites lying on the XZ plane.
 */
import * as THREE from 'three';

const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export class SpriteBatch {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly mat: Float32Array;
  private readonly col: Float32Array;

  constructor(
    scene: THREE.Scene,
    readonly cap: number,
    map: THREE.Texture,
    opts: { additive?: boolean; opacity?: number; order?: number; top?: boolean } = {},
  ) {
    const material = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      opacity: opts.opacity ?? 1,
      blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
      depthTest: !opts.top, // `top` batches (enemy bullets) always draw over everything
    });
    this.mesh = new THREE.InstancedMesh(quad, material, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.order ?? 1;
    this.mesh.count = 0;
    this.mat = this.mesh.instanceMatrix.array as Float32Array;
    this.col = this.mesh.instanceColor.array as Float32Array;
    scene.add(this.mesh);
  }

  begin(): void {
    this.n = 0;
  }

  /** Quad centred at (x, y, z), `w` wide (x) and `h` long (z), turned `rot` about Y. */
  add(x: number, y: number, z: number, w: number, h: number, rot = 0, r = 1, g = 1, b = 1): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const m = this.mat;
    const o = i * 16;
    // T * Ry(rot) * S(w, 1, h), column-major.
    m[o] = c * w;
    m[o + 1] = 0;
    m[o + 2] = -s * w;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = 1;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s * h;
    m[o + 9] = 0;
    m[o + 10] = c * h;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round glow: white core fading out. Tinted per instance. */
export const glowTex = (): THREE.Texture =>
  canvasTexture(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    r.addColorStop(0.55, 'rgba(255,255,255,0.25)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });

/** Enemy bullet core: white disc with a dark rim so it reads on bright ground too. */
export const bulletTex = (): THREE.Texture =>
  canvasTexture(64, 64, (g) => {
    g.beginPath();
    g.arc(32, 32, 27, 0, Math.PI * 2);
    g.fillStyle = 'rgba(30,0,20,0.75)';
    g.fill();
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 22);
    r.addColorStop(0, '#ffffff');
    r.addColorStop(0.55, '#ffffff');
    r.addColorStop(0.8, '#d8d8d8');
    r.addColorStop(1, '#9a9a9a');
    g.beginPath();
    g.arc(32, 32, 22, 0, Math.PI * 2);
    g.fillStyle = r;
    g.fill();
  });

/** Lumpy fire puff for explosions. */
export const puffTex = (): THREE.Texture =>
  canvasTexture(64, 64, (g) => {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const x = 32 + Math.cos(a) * 9;
      const y = 32 + Math.sin(a) * 9;
      const r = g.createRadialGradient(x, y, 0, x, y, 20);
      r.addColorStop(0, 'rgba(255,255,255,0.55)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    }
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 26);
    r.addColorStop(0, 'rgba(255,255,255,0.9)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });

/** Thin glowing ring (shockwaves, shield). */
export const ringTex = (): THREE.Texture =>
  canvasTexture(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 40, 64, 64, 62);
    r.addColorStop(0, 'rgba(255,255,255,0)');
    r.addColorStop(0.6, 'rgba(255,255,255,0.9)');
    r.addColorStop(0.75, 'rgba(255,255,255,0.5)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });

/** Elongated tracer for the player's cannon. */
export const tracerTex = (): THREE.Texture =>
  canvasTexture(32, 128, (g) => {
    g.translate(16, 64);
    g.scale(1, 4);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 16);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(-16, -16, 32, 32);
  });

/** Soft cumulus cloud from a cluster of overlapping puffs. */
export const cloudTex = (): THREE.Texture =>
  canvasTexture(256, 128, (g) => {
    const blobs = [
      [70, 74, 44],
      [120, 58, 52],
      [176, 72, 42],
      [100, 86, 36],
      [150, 88, 38],
      [210, 84, 28],
      [42, 86, 26],
    ];
    for (const [x, y, r] of blobs) {
      const grad = g.createRadialGradient(x!, y!, 0, x!, y!, r!);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.6)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
    }
  });

/** Dark blob for fake shadows on the ground. */
export const shadowTex = (): THREE.Texture =>
  canvasTexture(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(0,0,0,0.9)');
    r.addColorStop(0.5, 'rgba(0,0,0,0.6)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });

/** Pickup capsule: glowing coloured badge with a glyph. */
export const badgeTex = (color: string, glyph: string): THREE.Texture =>
  canvasTexture(128, 128, (g) => {
    const halo = g.createRadialGradient(64, 64, 30, 64, 64, 64);
    halo.addColorStop(0, color);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 128, 128);
    g.beginPath();
    g.arc(64, 64, 38, 0, Math.PI * 2);
    const body = g.createLinearGradient(0, 26, 0, 102);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.35, color);
    body.addColorStop(1, '#101018');
    g.fillStyle = body;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 6;
    g.font = '700 50px "Chakra Petch", Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeText(glyph, 64, 67);
    g.fillText(glyph, 64, 67);
  });

/** Spinning credit coin (drawn face-on; spin is faked by squashing the quad). */
export const coinTex = (): THREE.Texture =>
  canvasTexture(64, 64, (g) => {
    const halo = g.createRadialGradient(32, 32, 14, 32, 32, 32);
    halo.addColorStop(0, 'rgba(255,200,60,0.8)');
    halo.addColorStop(1, 'rgba(255,200,60,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 64, 64);
    g.beginPath();
    g.arc(32, 32, 17, 0, Math.PI * 2);
    const body = g.createLinearGradient(0, 15, 0, 49);
    body.addColorStop(0, '#fff6c8');
    body.addColorStop(0.5, '#ffc93c');
    body.addColorStop(1, '#b86b00');
    g.fillStyle = body;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#fff3b0';
    g.stroke();
    g.fillStyle = '#8a4b00';
    g.font = '700 22px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('C', 32, 34);
  });
