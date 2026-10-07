import * as THREE from 'three';
import type { AssetManager } from '../assets/AssetManager';
import type { ArenaConfig, PbrSet } from './ArenaConfig';

interface FlickerLight {
  light: THREE.PointLight;
  base: number;
  seed: number;
}

/** Builds an arena (geometry, materials, lights, fog) from an ArenaConfig. */
export class Arena {
  readonly root = new THREE.Group();
  readonly flameEmitters: THREE.Vector3[] = [];
  private readonly flickers: FlickerLight[] = [];
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private time = 0;

  constructor(
    readonly config: ArenaConfig,
    private readonly assets: AssetManager,
  ) {}

  get halfWidth(): number {
    return this.config.halfWidth;
  }

  build(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    const c = this.config;
    this.root.name = `arena:${c.id}`;

    // Environment: HDRI for subtle reflections, darkened background + fog for mood.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const hdri = this.assets.getHdri(c.hdri);
    hdri.mapping = THREE.EquirectangularReflectionMapping;
    this.envTarget = pmrem.fromEquirectangular(hdri);
    pmrem.dispose();
    scene.environment = this.envTarget.texture;
    scene.environmentIntensity = 0.25;
    scene.background = hdri;
    scene.backgroundIntensity = 0.35;
    scene.backgroundBlurriness = 0.15;
    scene.fog = new THREE.Fog(c.fog.color, c.fog.near, c.fog.far);

    this.buildFloor();
    this.buildBackWall();
    this.buildLights();
    this.buildProps();
    scene.add(this.root);
  }

  private pbrMaterial(set: PbrSet, tint = 0xffffff): THREE.MeshStandardMaterial {
    const prepare = (tex: THREE.Texture, srgb: boolean): THREE.Texture => {
      const t = tex.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(set.repeatX, set.repeatY);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    };
    const arm = prepare(this.assets.getTexture(set.arm), false);
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      map: prepare(this.assets.getTexture(set.diffuse), true),
      normalMap: prepare(this.assets.getTexture(set.normal), false),
      aoMap: arm,
      roughnessMap: arm,
      metalnessMap: arm,
      metalness: 0,
      roughness: 1,
    });
    this.ownedMaterials.push(mat);
    return mat;
  }

  private buildFloor(): void {
    const f = this.config.floor;
    const geo = new THREE.PlaneGeometry(f.width, f.depth);
    geo.rotateX(-Math.PI / 2);
    this.ownedGeometries.push(geo);
    const floor = new THREE.Mesh(geo, this.pbrMaterial(f, 0x8a8686));
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.root.add(floor);

    // Raised fighting platform rim: a dark inset ring that reads like a pit edge.
    const ringGeo = new THREE.RingGeometry(this.config.halfWidth + 0.6, this.config.halfWidth + 0.9, 64, 1);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.scale(1, 1, 0.32);
    this.ownedGeometries.push(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x8a1c10, transparent: true, opacity: 0.35, depthWrite: false });
    this.ownedMaterials.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, 0.01, 0);
    this.root.add(ring);
  }

  private buildBackWall(): void {
    const w = this.config.backWall;
    const geo = new THREE.PlaneGeometry(w.width, w.height);
    this.ownedGeometries.push(geo);
    const wall = new THREE.Mesh(geo, this.pbrMaterial(w, 0x7a6e68));
    wall.position.set(0, w.height / 2, w.z);
    wall.receiveShadow = true;
    wall.name = 'backWall';
    this.root.add(wall);

    // Angled side walls close the stage off at the edges of the frame.
    for (const side of [-1, 1]) {
      const sideGeo = new THREE.PlaneGeometry(10, w.height);
      this.ownedGeometries.push(sideGeo);
      const sideWall = new THREE.Mesh(sideGeo, wall.material);
      sideWall.position.set(side * (w.width / 2 - 1.5), w.height / 2, w.z + 4);
      sideWall.rotation.y = -side * Math.PI * 0.42;
      sideWall.receiveShadow = true;
      this.root.add(sideWall);
    }
  }

  private buildLights(): void {
    const c = this.config;
    const hemi = new THREE.HemisphereLight(c.ambient.sky, c.ambient.ground, c.ambient.intensity);
    this.root.add(hemi);

    // Single shadow caster with a tight frustum around the fighting area.
    const key = new THREE.DirectionalLight(c.keyLight.color, c.keyLight.intensity);
    key.position.set(c.keyLight.position.x, c.keyLight.position.y, c.keyLight.position.z);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 1024);
    const cam = key.shadow.camera;
    cam.left = -c.halfWidth - 4;
    cam.right = c.halfWidth + 4;
    cam.top = 8;
    cam.bottom = -4;
    cam.near = 1;
    cam.far = 40;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    this.root.add(key, key.target);

    // Warm rim light from behind the fighters for silhouette separation.
    const rim = new THREE.DirectionalLight(0xff6a2a, 0.9);
    rim.position.set(4, 6, -10);
    this.root.add(rim);

    for (const fl of c.fireLights) {
      const light = new THREE.PointLight(0xff7a2e, fl.intensity, fl.distance, 1.6);
      light.position.set(fl.position.x, fl.position.y, fl.position.z);
      this.root.add(light);
      this.flickers.push({ light, base: fl.intensity, seed: Math.random() * 100 });
      if (fl.emitFlames) this.flameEmitters.push(light.position.clone());
    }
  }

  private buildProps(): void {
    for (const p of this.config.props) {
      const obj = this.assets.cloneModel(p.model);
      obj.position.set(p.position.x, p.position.y, p.position.z);
      obj.rotation.y = p.rotationY ?? 0;
      obj.scale.setScalar(p.scale ?? 1);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = p.castShadow ?? false;
          child.receiveShadow = true;
        }
      });
      this.root.add(obj);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (const f of this.flickers) {
      const n = Math.sin(t * 11 + f.seed) * 0.5 + Math.sin(t * 23.7 + f.seed * 1.3) * 0.3 + Math.sin(t * 5.1 + f.seed) * 0.2;
      f.light.intensity = f.base * (0.85 + n * 0.15);
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.map?.dispose();
        m.normalMap?.dispose();
        m.aoMap?.dispose();
      }
      m.dispose();
    }
    this.envTarget?.dispose();
    scene.environment = null;
    scene.background = null;
  }
}
