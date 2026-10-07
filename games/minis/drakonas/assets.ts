/**
 * Loads the Drakonas models (OBJ + JPG, MIT, Fellicht.nl and authors) once
 * and hands out shared geometries and materials. A model that fails to load
 * falls back to a simple shape so the game stays playable.
 */
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export const ASSETS = '/play/drakonas-assets/';

export interface Model {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshLambertMaterial;
  /** Same texture, blown out to white: swapped in for a frame when hit. */
  flash: THREE.MeshLambertMaterial;
}

export interface Tile {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

export interface Assets {
  player: Model;
  scout: Model;
  scoutAlt: Model;
  fighter: Model;
  ufo: Model;
  ufoAlt: Model;
  mine: Model;
  boss: Model;
  missile: Model;
  tiles: { island: Tile; water: Tile; hills: Tile; river: Tile; swamp: Tile };
}

const objLoader = new OBJLoader();
const texLoader = new THREE.TextureLoader();
const textures = new Map<string, Promise<THREE.Texture | null>>();

function texture(name: string): Promise<THREE.Texture | null> {
  let p = textures.get(name);
  if (!p) {
    p = texLoader
      .loadAsync(`${ASSETS}${name}.jpg`)
      .then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })
      .catch(() => null);
    textures.set(name, p);
  }
  return p;
}

/** First mesh geometry in an OBJ file, with normals (the files ship without). */
async function geometry(name: string): Promise<THREE.BufferGeometry | null> {
  try {
    const group = await objLoader.loadAsync(`${ASSETS}${name}.obj`);
    let geo: THREE.BufferGeometry | null = null;
    group.traverse((o) => {
      if (!geo && (o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry;
    });
    if (!geo) return null;
    const g = geo as THREE.BufferGeometry;
    g.computeVertexNormals();
    return g;
  } catch {
    return null;
  }
}

async function model(obj: string, tex: string, fallback: () => THREE.BufferGeometry, tint = 0xffffff): Promise<Model> {
  const [geo, map] = await Promise.all([geometry(obj), texture(tex)]);
  const mat = new THREE.MeshLambertMaterial({ map, color: map ? tint : 0x8892a6 });
  const flash = new THREE.MeshLambertMaterial({ map, color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.85 });
  return { geo: geo ?? fallback(), mat, flash };
}

async function tile(name: string, water = false): Promise<Tile> {
  const [geo, map] = await Promise.all([geometry(name), texture(name)]);
  const g = geo ?? new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2).translate(0, 0, -100);
  // Keep border UVs off the texture edge (and, for the island, inside its water patch)
  // so mipmapping does not bleed white seams between tiles.
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  const pos = g.attributes.position as THREE.BufferAttribute;
  if (uv) {
    for (let i = 0; i < uv.count; i++) {
      const edge = Math.abs(Math.abs(pos.getX(i)) - 100) < 0.5;
      const [u0, u1, v0, v1] = water && edge ? [0.03, 0.55, 0.45, 0.97] : [0.012, 0.988, 0.012, 0.988];
      uv.setXY(i, Math.min(u1, Math.max(u0, uv.getX(i))), Math.min(v1, Math.max(v0, uv.getY(i))));
    }
  }
  g.translate(0, 0, 100); // tiles are anchored at a corner edge; centre them so they can turn
  return { geo: g, mat: new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : 0x2d5a27, side: THREE.DoubleSide }) };
}

const dart = (): THREE.BufferGeometry => new THREE.ConeGeometry(1.6, 4.5, 4).rotateX(-Math.PI / 2);

export async function loadAssets(): Promise<Assets> {
  const [player, scout, scoutAlt, fighter, ufo, ufoAlt, mine, boss, missile] = await Promise.all([
    model('player', 'player', () => dart().rotateY(Math.PI)),
    model('scout-001', 'scout-001', dart),
    model('scout-001', 'scout-001c', dart),
    model('fighter-001', 'fighter-001', dart, 0xff9a7a),
    model('ufo', 'ufo-glow-pink', () => new THREE.CylinderGeometry(3.9, 3.9, 1.2, 20)),
    model('ufo', 'ufo-glow-orange', () => new THREE.CylinderGeometry(3.9, 3.9, 1.2, 20)),
    model('mine-001', 'mine-001', () => new THREE.IcosahedronGeometry(0.5)),
    model('boss-001', 'boss-001', () => new THREE.BoxGeometry(7, 2, 10)),
    model('missile', 'missile', () => new THREE.CylinderGeometry(0.1, 0.1, 0.8).rotateX(Math.PI / 2)),
  ]);
  const [island, hills, river, swamp] = await Promise.all([
    tile('tile-island-001', true),
    tile('tile-hills-002'),
    tile('tile-river-grass-n-z-001'),
    tile('tile-swamp-001'),
  ]);
  // Open sea: a flat tile that samples the water corner of the island texture.
  const waterGeo = new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2).translate(0, -1.5, 0);
  const uv = waterGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.04 + uv.getX(i) * 0.5, 0.46 + uv.getY(i) * 0.5);
  const water = { geo: waterGeo, mat: island.mat };
  return { player, scout, scoutAlt, fighter, ufo, ufoAlt, mine, boss, missile, tiles: { island, water, hills, river, swamp } };
}
