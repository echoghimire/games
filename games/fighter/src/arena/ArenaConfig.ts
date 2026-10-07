import type { HdriKey, ModelKey, TextureKey } from '../assets/AssetManifest';

export interface Vec3Tuple {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PropPlacement {
  readonly model: ModelKey;
  readonly position: Vec3Tuple;
  readonly rotationY?: number;
  readonly scale?: number;
  readonly castShadow?: boolean;
}

export interface FireLightPlacement {
  readonly position: Vec3Tuple;
  readonly intensity: number;
  readonly distance: number;
  /** Spawn fire particles at this point. */
  readonly emitFlames: boolean;
}

export interface PbrSet {
  readonly diffuse: TextureKey;
  readonly normal: TextureKey;
  readonly arm: TextureKey;
  readonly repeatX: number;
  readonly repeatY: number;
}

/** Data description of an arena: the Arena class builds any stage from this. */
export interface ArenaConfig {
  readonly id: string;
  readonly name: string;
  /** Fighters are clamped to [-halfWidth, halfWidth] on X. */
  readonly halfWidth: number;
  readonly floor: PbrSet & { readonly width: number; readonly depth: number };
  readonly backWall: PbrSet & { readonly z: number; readonly height: number; readonly width: number };
  readonly hdri: HdriKey;
  readonly fog: { readonly color: number; readonly near: number; readonly far: number };
  readonly ambient: { readonly sky: number; readonly ground: number; readonly intensity: number };
  readonly keyLight: { readonly color: number; readonly intensity: number; readonly position: Vec3Tuple };
  readonly props: readonly PropPlacement[];
  readonly fireLights: readonly FireLightPlacement[];
}
