import type { ArenaConfig, FireLightPlacement, PropPlacement } from '../ArenaConfig';

/** Props are authored in KayKit units; 0.75 matches the fighter scale (~1.85m). */
const S = 0.75;

const pillarXs = [-10.5, -5.25, 0, 5.25, 10.5];
const wallZ = -5.2;

const pillars: PropPlacement[] = pillarXs.map((x) => ({
  model: 'pillarDecorated',
  position: { x, y: 0, z: wallZ + 0.55 },
  scale: S * 1.15,
  castShadow: true,
}));

const wallTorches: PropPlacement[] = [-7.9, -2.6, 2.6, 7.9].map((x) => ({
  model: 'torchMounted',
  position: { x, y: 2.6, z: wallZ },
  scale: S,
}));

const braziers: PropPlacement[] = [-9.2, 9.2].map((x) => ({
  model: 'torchLit',
  position: { x, y: 0.3, z: -2.4 },
  scale: S * 1.6,
  castShadow: true,
}));

const debris: PropPlacement[] = [
  { model: 'barrelLarge', position: { x: -11.5, y: 0, z: -3.2 }, rotationY: 0.4, scale: S * 0.7, castShadow: true },
  { model: 'barrelLarge', position: { x: 12, y: 0, z: -3.6 }, rotationY: -0.8, scale: S * 0.6, castShadow: true },
  { model: 'column', position: { x: -12.4, y: 0, z: -1.2 }, scale: S * 1.4, castShadow: true },
  { model: 'column', position: { x: 12.6, y: 0, z: -1 }, rotationY: 0.6, scale: S * 1.1, castShadow: true },
];

const fireLights: FireLightPlacement[] = [
  ...[-7.9, -2.6, 2.6, 7.9].map((x) => ({
    position: { x, y: 3.25, z: wallZ + 0.45 },
    intensity: 9,
    distance: 9,
    emitFlames: true,
  })),
  ...[-9.2, 9.2].map((x) => ({
    position: { x, y: 1.35, z: -2.4 },
    intensity: 14,
    distance: 11,
    emitFlames: true,
  })),
];

export const EMBER_KEEP: ArenaConfig = {
  id: 'ember-keep',
  name: 'Ember Keep',
  halfWidth: 8.5,
  floor: {
    diffuse: 'floorDiff',
    normal: 'floorNormal',
    arm: 'floorArm',
    width: 34,
    depth: 18,
    repeatX: 12,
    repeatY: 6.3,
  },
  backWall: {
    diffuse: 'wallDiff',
    normal: 'wallNormal',
    arm: 'wallArm',
    z: wallZ,
    height: 7.5,
    width: 34,
    repeatX: 7,
    repeatY: 1.6,
  },
  hdri: 'night',
  fog: { color: 0x120a0a, near: 14, far: 34 },
  ambient: { sky: 0x5a6a9a, ground: 0x2a1408, intensity: 0.55 },
  keyLight: { color: 0xb8c6ff, intensity: 1.6, position: { x: -6, y: 12, z: 9 } },
  props: [...pillars, ...wallTorches, ...braziers, ...debris],
  fireLights,
};
