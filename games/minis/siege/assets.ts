/**
 * Loads the tower and enemy models (OBJ, z-up, no normals) and textures from
 * /play/siege-assets/ (MIT, Mathieu "Casmo", github.com/Casmo/tower-defense).
 */
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const ASSET_URL = '/play/siege-assets/';

export interface Assets {
  towers: THREE.BufferGeometry[]; // index 0..2 = tower-01..03, base at y=0
  towerTex: THREE.Texture[];
  ghost: THREE.BufferGeometry;
  ghostTex: THREE.Texture;
  ufo: THREE.BufferGeometry;
  ufoTex: THREE.Texture;
  grass: HTMLImageElement;
  ball: THREE.Texture;
  flare: THREE.Texture;
  smoke: THREE.Texture;
  splat: THREE.Texture;
}

const texLoader = new THREE.TextureLoader();
const objLoader = new OBJLoader();

function tex(name: string, srgb = true): Promise<THREE.Texture> {
  return texLoader.loadAsync(ASSET_URL + name).then((t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}

function image(name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = ASSET_URL + name;
  });
}

/**
 * One merged, y-up geometry with smooth-ish normals, centred on x/z with its
 * base at y=0, scaled so its widest side is `width` (or its height is `height`).
 */
async function model(name: string, fit: { width?: number; height?: number }): Promise<THREE.BufferGeometry> {
  const group = await objLoader.loadAsync(ASSET_URL + name);
  const parts: THREE.BufferGeometry[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = (o.geometry as THREE.BufferGeometry).clone();
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'uv') g.deleteAttribute(key);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    parts.push(g);
  });
  let geo = parts.length > 1 ? mergeGeometries(parts)! : parts[0]!;
  geo.rotateX(-Math.PI / 2); // the models are z-up
  geo = toCreasedNormals(geo, 0.6);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  geo.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const k = fit.height ? fit.height / size.y : fit.width! / Math.max(size.x, size.z);
  geo.scale(k, k, k);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export async function loadAssets(): Promise<Assets> {
  const [t1, t2, t3, tt1, tt2, tt3, ghost, ghostTex, ufo, ufoTex, grass, ball, flare, smoke, splat] = await Promise.all([
    model('tower-01.obj', { width: 0.86 }),
    model('tower-02.obj', { width: 0.8 }),
    model('tower-03.obj', { width: 0.8 }),
    tex('tower-01.jpg'),
    tex('tower-02.jpg'),
    tex('tower-03.jpg'),
    model('ghost.obj', { height: 0.72 }),
    tex('ghost.png'),
    model('ufo.obj', { width: 0.8 }),
    tex('ufo-yellow.jpg'),
    image('grass.jpg'),
    tex('bullet-01.png', false),
    tex('bullet-02.png', false),
    tex('smoke-particle.png', false),
    tex('splat.png', false),
  ]);
  return { towers: [t1, t2, t3], towerTex: [tt1, tt2, tt3], ghost, ghostTex, ufo, ufoTex, grass, ball, flare, smoke, splat };
}
