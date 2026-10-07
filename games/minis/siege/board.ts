/**
 * The static battlefield: grid cells, the winding path (with rounded corners),
 * the painted ground texture, scenery, the spawn portal and the core to defend.
 */
import * as THREE from 'three';
import { cellX, cellZ, COLS, ROWS, WAYPOINTS } from './config';

export const enum Cell {
  Free = 0,
  Path = 1,
  Deco = 2,
  Base = 3,
}

const STEP = 0.05; // path lookup table resolution in cells
const PX = 80; // ground texture pixels per cell

export class Board {
  readonly group = new THREE.Group();
  readonly cells: Cell[] = new Array(COLS * ROWS).fill(Cell.Free);
  /** Path samples every STEP cells: x, z pairs. */
  private readonly lut: number[] = [];
  readonly length: number;
  readonly basePos: THREE.Vector3;
  readonly portalPos: THREE.Vector3;
  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.MeshLambertMaterial;
  private readonly ring: THREE.Mesh;
  private readonly portalRing: THREE.Mesh;
  private readonly portalDisc: THREE.Mesh;
  private readonly portalMat: THREE.MeshBasicMaterial;
  private readonly corners: THREE.Vector2[];

  constructor(grass: HTMLImageElement, maxAniso: number) {
    // Mark path cells along the straight runs between waypoints.
    for (let i = 1; i < WAYPOINTS.length; i++) {
      const [c0, r0] = WAYPOINTS[i - 1]!;
      const [c1, r1] = WAYPOINTS[i]!;
      const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
      for (let k = 0; k <= n; k++) {
        const c = c0 + Math.sign(c1 - c0) * k;
        const r = r0 + Math.sign(r1 - r0) * k;
        if (this.inside(c, r)) this.cells[r * COLS + c] = Cell.Path;
      }
    }
    const [bc, br] = WAYPOINTS[WAYPOINTS.length - 1]!;
    this.cells[br * COLS + bc] = Cell.Base;

    this.corners = this.roundedPath();
    // Resample the polyline so every lookup step is exactly STEP long.
    const segLen = this.corners.slice(1).map((p, i) => p.distanceTo(this.corners[i]!));
    const total = segLen.reduce((a, b) => a + b, 0);
    let seg = 0;
    let segStart = 0;
    for (let d = 0; d <= total; d += STEP) {
      while (seg < segLen.length - 1 && d > segStart + segLen[seg]!) segStart += segLen[seg++]!;
      const a = this.corners[seg]!;
      const b = this.corners[seg + 1]!;
      const k = Math.min(1, (d - segStart) / segLen[seg]!);
      this.lut.push(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    }
    this.length = (this.lut.length / 2 - 1) * STEP;

    this.scatterDecor();
    this.basePos = new THREE.Vector3(cellX(bc), 0, cellZ(br));
    this.portalPos = new THREE.Vector3(cellX(WAYPOINTS[0]![0]) + 0.45, 0, cellZ(WAYPOINTS[0]![1]));

    // Ground: one plane with everything painted into a canvas texture.
    const groundTex = new THREE.CanvasTexture(this.paintGround(grass));
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = maxAniso;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(COLS, ROWS), new THREE.MeshLambertMaterial({ map: groundTex }));
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);
    // The board is a slab of earth floating in the dark.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(COLS + 0.3, 0.7, ROWS + 0.3),
      new THREE.MeshLambertMaterial({ color: 0x3a2c22 }),
    );
    slab.position.y = -0.36;
    this.group.add(slab);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(COLS + 0.5, 0.12, ROWS + 0.5), new THREE.MeshLambertMaterial({ color: 0x5b6474 }));
    rim.position.y = -0.68;
    this.group.add(rim);

    this.addScenery();

    // Spawn portal: a violet ring with a swirling disc, standing at the board edge.
    this.portalMat = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.portalDisc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), this.portalMat);
    this.portalRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.07, 10, 40), new THREE.MeshLambertMaterial({ color: 0x2e1065, emissive: 0x9333ea, emissiveIntensity: 0.9 }));
    for (const m of [this.portalDisc, this.portalRing]) {
      m.position.copy(this.portalPos).setY(0.5);
      m.rotation.y = Math.PI / 2;
      this.group.add(m);
    }

    // The core: a floating crystal over a stone plinth with a spinning ring.
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.46, 0.22, 6), new THREE.MeshLambertMaterial({ color: 0x6b7280 }));
    plinth.position.copy(this.basePos).setY(0.11);
    this.group.add(plinth);
    this.coreMat = new THREE.MeshLambertMaterial({ color: 0x67e8f9, emissive: 0x0891b2, emissiveIntensity: 1 });
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), this.coreMat);
    this.core.scale.y = 1.5;
    this.group.add(this.core);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 8, 40), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
    this.group.add(this.ring);
  }

  inside(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < COLS && r < ROWS;
  }

  cell(c: number, r: number): Cell {
    return this.inside(c, r) ? this.cells[r * COLS + c]! : Cell.Deco;
  }

  /** Position along the path at distance `d` (cells) into `out` (x, z). */
  sample(d: number, out: THREE.Vector3): THREE.Vector3 {
    const f = Math.max(0, Math.min(d / STEP, this.lut.length / 2 - 1.001));
    const i = Math.floor(f);
    const k = f - i;
    out.x = this.lut[i * 2]! + (this.lut[i * 2 + 2]! - this.lut[i * 2]!) * k;
    out.z = this.lut[i * 2 + 1]! + (this.lut[i * 2 + 3]! - this.lut[i * 2 + 1]!) * k;
    return out;
  }

  /** Animate the portal and core. `health` 0..1 tints the core red; `hit` 0..1 flashes it. */
  update(t: number, health: number, hit: number): void {
    this.portalDisc.scale.setScalar(0.85 + Math.sin(t * 3) * 0.08);
    this.portalMat.opacity = 0.45 + Math.sin(t * 5) * 0.12;
    this.portalRing.rotation.x = t * 0.8;
    this.core.position.copy(this.basePos).setY(0.72 + Math.sin(t * 2) * 0.06);
    this.core.rotation.y = t * 1.4;
    const c = new THREE.Color(0xef4444).lerp(new THREE.Color(0x22d3ee), health);
    this.coreMat.emissive.copy(c).lerp(new THREE.Color(0xffffff), hit);
    this.coreMat.emissiveIntensity = 0.8 + hit * 1.5;
    this.ring.position.copy(this.basePos).setY(0.72);
    this.ring.rotation.set(Math.PI / 2 + Math.sin(t) * 0.4, t * 2, 0);
    this.ring.scale.setScalar(1 + hit * 0.6);
    (this.ring.material as THREE.MeshBasicMaterial).color.copy(c);
  }

  /** Waypoints in world space with each corner replaced by a quarter circle. */
  private roundedPath(): THREE.Vector2[] {
    const pts = WAYPOINTS.map(([c, r]) => new THREE.Vector2(cellX(c), cellZ(r)));
    pts[0]!.x += 0.45; // start inside the portal
    const out: THREE.Vector2[] = [pts[0]!.clone()];
    const R = 0.5;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const a = pts[i - 1]!.clone().sub(p).normalize();
      const b = pts[i + 1]!.clone().sub(p).normalize();
      const from = p.clone().addScaledVector(a, R);
      const to = p.clone().addScaledVector(b, R);
      // Quadratic Bezier through the corner, close enough to an arc.
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        out.push(new THREE.Vector2(
          (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * p.x + t * t * to.x,
          (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * p.y + t * t * to.y,
        ));
      }
    }
    out.push(pts[pts.length - 1]!.clone());
    return out;
  }

  private scatterDecor(): void {
    // A few trees and rocks on cells far from the path (not worth a tower anyway).
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.cell(c, r) !== Cell.Free) continue;
        let near = 9;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
          const k = this.cell(c + dc, r + dr);
          if ((k === Cell.Path || k === Cell.Base) && this.inside(c + dc, r + dr)) near = Math.min(near, Math.max(Math.abs(dc), Math.abs(dr)));
        }
        if (near >= 2 && rnd() < 0.55) this.cells[r * COLS + c] = Cell.Deco;
      }
    }
  }

  private addScenery(): void {
    const trees: THREE.Matrix4[] = [];
    const rocks: THREE.Matrix4[] = [];
    let seed = 99;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.cells[r * COLS + c] !== Cell.Deco) continue;
        const n = 1 + Math.floor(rnd() * 2);
        for (let i = 0; i < n; i++) {
          const x = cellX(c) + (rnd() - 0.5) * 0.6;
          const z = cellZ(r) + (rnd() - 0.5) * 0.6;
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6.28);
          if (rnd() < 0.7) {
            const s = 0.7 + rnd() * 0.6;
            trees.push(m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.9 + rnd() * 0.5), s)).clone());
          } else {
            const s = 0.12 + rnd() * 0.14;
            rocks.push(m.compose(new THREE.Vector3(x, s * 0.4, z), q, new THREE.Vector3(s * 1.3, s, s)).clone());
          }
        }
      }
    }
    // Low-poly pine: a stack of cones on a trunk, merged into one instanced mesh.
    const parts: THREE.BufferGeometry[] = [];
    parts.push(new THREE.CylinderGeometry(0.04, 0.06, 0.2, 5).translate(0, 0.1, 0).toNonIndexed());
    [0.32, 0.26, 0.19].forEach((rad, i) => parts.push(new THREE.ConeGeometry(rad, 0.36, 7).translate(0, 0.32 + i * 0.17, 0).toNonIndexed()));
    const colors: number[] = [];
    parts.forEach((g, i) => {
      const col = new THREE.Color(i === 0 ? 0x5b3a1e : [0x1f5f3a, 0x237046, 0x2c8a55][i - 1]!);
      for (let k = 0; k < g.getAttribute('position').count; k++) colors.push(col.r, col.g, col.b);
    });
    const treeGeo = mergeSimple(parts);
    treeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const treeMesh = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), trees.length);
    trees.forEach((t, i) => treeMesh.setMatrixAt(i, t));
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x8b8f99, flatShading: true }), rocks.length);
    rocks.forEach((t, i) => rockMesh.setMatrixAt(i, t));
    this.group.add(treeMesh, rockMesh);
  }

  private paintGround(grass: HTMLImageElement): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = COLS * PX;
    cv.height = ROWS * PX;
    const g = cv.getContext('2d')!;
    // Grass, tiled at 8 cells per image.
    const tile = 8 * PX;
    for (let y = 0; y < cv.height; y += tile) for (let x = 0; x < cv.width; x += tile) g.drawImage(grass, x, y, tile, tile);
    g.fillStyle = 'rgba(20,40,30,0.18)';
    g.fillRect(0, 0, cv.width, cv.height);
    const toPx = (v: THREE.Vector2): [number, number] => [(v.x + COLS / 2) * PX, (v.y + ROWS / 2) * PX];
    const trace = (): void => {
      g.beginPath();
      this.corners.forEach((p, i) => (i ? g.lineTo(...toPx(p)) : g.moveTo(...toPx(p))));
    };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // Path: dark border, packed dirt, worn lighter middle, then pebbles.
    trace();
    g.strokeStyle = 'rgba(30,20,10,0.55)';
    g.lineWidth = PX * 1.0;
    g.stroke();
    trace();
    g.strokeStyle = '#8c6a44';
    g.lineWidth = PX * 0.84;
    g.stroke();
    trace();
    g.strokeStyle = 'rgba(214,180,130,0.35)';
    g.lineWidth = PX * 0.42;
    g.stroke();
    let seed = 3;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < this.corners.length - 1; i++) {
      const a = this.corners[i]!;
      const b = this.corners[i + 1]!;
      const n = Math.ceil(a.distanceTo(b) * 26);
      for (let k = 0; k < n; k++) {
        const p = a.clone().lerp(b, rnd());
        const [px, py] = toPx(p);
        const ox = (rnd() - 0.5) * PX * 0.8;
        const oy = (rnd() - 0.5) * PX * 0.8;
        g.fillStyle = rnd() < 0.5 ? 'rgba(60,40,20,0.35)' : 'rgba(235,210,170,0.3)';
        g.beginPath();
        g.arc(px + ox, py + oy, 1 + rnd() * 2.4, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Faint build-slot outlines on free cells.
    g.strokeStyle = 'rgba(255,255,255,0.11)';
    g.lineWidth = 2;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.cells[r * COLS + c] !== Cell.Free) continue;
        g.beginPath();
        g.roundRect(c * PX + 5, r * PX + 5, PX - 10, PX - 10, 10);
        g.stroke();
      }
    }
    // A glowing pad under the core.
    const [bx, by] = toPx(new THREE.Vector2(this.basePos.x, this.basePos.z));
    const glow = g.createRadialGradient(bx, by, 0, bx, by, PX * 0.9);
    glow.addColorStop(0, 'rgba(103,232,249,0.55)');
    glow.addColorStop(1, 'rgba(103,232,249,0)');
    g.fillStyle = glow;
    g.fillRect(bx - PX, by - PX, PX * 2, PX * 2);
    // Vignette towards the edges.
    const v = g.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.35, cv.width / 2, cv.height / 2, cv.width * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = v;
    g.fillRect(0, 0, cv.width, cv.height);
    return cv;
  }
}

/** Concatenate non-indexed primitives (position + normal only). */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of parts) {
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
