import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  HDRIS,
  MODELS,
  SOUNDS,
  TEXTURES,
  type HdriKey,
  type ModelKey,
  type SoundKey,
  type TextureKey,
} from './AssetManifest';

export type ProgressListener = (loaded: number, total: number) => void;

/**
 * Loads and caches every asset up-front. Gameplay and rendering code asks for
 * assets by key and never deals with URLs or loaders directly.
 */
export class AssetManager {
  private readonly manager = new THREE.LoadingManager();
  private readonly gltfLoader: GLTFLoader;
  private readonly textureLoader: THREE.TextureLoader;
  private readonly hdrLoader: HDRLoader;
  private readonly draco: DRACOLoader;

  private readonly models = new Map<ModelKey, GLTF>();
  private readonly textures = new Map<TextureKey, THREE.Texture>();
  private readonly hdris = new Map<HdriKey, THREE.DataTexture>();
  private readonly sounds = new Map<SoundKey, ArrayBuffer>();

  constructor() {
    this.draco = new DRACOLoader(this.manager);
    this.gltfLoader = new GLTFLoader(this.manager);
    this.gltfLoader.setDRACOLoader(this.draco);
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.hdrLoader = new HDRLoader(this.manager);
  }

  async loadAll(onProgress?: ProgressListener): Promise<void> {
    const jobs: Promise<void>[] = [];
    const total =
      Object.keys(MODELS).length + Object.keys(TEXTURES).length + Object.keys(HDRIS).length + Object.keys(SOUNDS).length;
    let loaded = 0;
    const done = (): void => {
      loaded++;
      onProgress?.(loaded, total);
    };

    for (const key of Object.keys(MODELS) as ModelKey[]) {
      jobs.push(this.gltfLoader.loadAsync(MODELS[key]).then((gltf) => void this.models.set(key, gltf)).then(done));
    }
    for (const key of Object.keys(TEXTURES) as TextureKey[]) {
      jobs.push(
        this.textureLoader.loadAsync(TEXTURES[key]).then((tex) => void this.textures.set(key, tex)).then(done),
      );
    }
    for (const key of Object.keys(HDRIS) as HdriKey[]) {
      jobs.push(this.hdrLoader.loadAsync(HDRIS[key]).then((tex) => void this.hdris.set(key, tex)).then(done));
    }
    for (const key of Object.keys(SOUNDS) as SoundKey[]) {
      jobs.push(
        fetch(SOUNDS[key])
          .then((res) => {
            if (!res.ok) throw new Error(`Failed to load sound ${key}: ${res.status}`);
            return res.arrayBuffer();
          })
          .then((buf) => void this.sounds.set(key, buf))
          .then(done),
      );
    }
    await Promise.all(jobs);
  }

  getModel(key: ModelKey): GLTF {
    const gltf = this.models.get(key);
    if (!gltf) throw new Error(`Model not loaded: ${key}`);
    return gltf;
  }

  /** Returns an independent copy of a model's scene (skinned meshes get their own skeleton). */
  cloneModel(key: ModelKey): THREE.Object3D {
    return SkeletonUtils.clone(this.getModel(key).scene);
  }

  getAnimations(key: ModelKey): readonly THREE.AnimationClip[] {
    return this.getModel(key).animations;
  }

  getTexture(key: TextureKey): THREE.Texture {
    const tex = this.textures.get(key);
    if (!tex) throw new Error(`Texture not loaded: ${key}`);
    return tex;
  }

  getHdri(key: HdriKey): THREE.DataTexture {
    const tex = this.hdris.get(key);
    if (!tex) throw new Error(`HDRI not loaded: ${key}`);
    return tex;
  }

  /** Raw encoded audio. Ownership moves to the caller (decodeAudioData detaches it). */
  takeSound(key: SoundKey): ArrayBuffer {
    const buf = this.sounds.get(key);
    if (!buf) throw new Error(`Sound not loaded: ${key}`);
    this.sounds.delete(key);
    return buf;
  }

  soundKeys(): SoundKey[] {
    return [...this.sounds.keys()];
  }

  dispose(): void {
    for (const tex of this.textures.values()) tex.dispose();
    for (const tex of this.hdris.values()) tex.dispose();
    for (const gltf of this.models.values()) {
      gltf.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    }
    this.draco.dispose();
    this.models.clear();
    this.textures.clear();
    this.hdris.clear();
    this.sounds.clear();
  }
}
