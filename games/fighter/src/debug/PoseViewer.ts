import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';
import type { ModelKey } from '../assets/AssetManifest';
import { Renderer } from '../render/Renderer';

const HIDDEN_DEFAULT =
  '1H_Axe_Offhand,Barbarian_Round_Shield,1H_Axe,2H_Axe,Mug,Knife_Offhand,1H_Crossbow,2H_Crossbow,Knife,Throwable';

/**
 * Dev tool (open `/?poses=Clip@0.5,Other@1&model=barbarian`): shows a grid of
 * frozen poses, handy for picking clips and timings for a FighterConfig.
 */
export async function runPoseViewer(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const assets = new AssetManager();
  await assets.loadAll();
  const renderer = new Renderer({ canvas });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x303038);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.5));
  const dir = new THREE.DirectionalLight(0xffffff, 2);
  dir.position.set(3, 6, 8);
  scene.add(dir);

  const model = (params.get('model') ?? 'barbarian') as ModelKey;
  const clips = assets.getAnimations(model);
  const entries = (params.get('poses') ?? '')
    .split(',')
    .filter(Boolean)
    .map((e) => {
      const [name = '', t = '0.5'] = e.split('@');
      return { name, t: Number(t) };
    });
  const yaw = Number(params.get('yaw') ?? '1.2');

  const cols = Math.min(6, entries.length);
  const rows = Math.ceil(entries.length / cols);
  const labels = document.createElement('div');
  labels.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:12px monospace;color:#fff';
  document.body.appendChild(labels);

  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 100);
  renderer.attachCamera(camera);
  const spacing = 2.2;
  camera.position.set(((cols - 1) * spacing) / 2, (rows * 2.6) / 2, 8 + rows * 3.6);
  camera.lookAt(((cols - 1) * spacing) / 2, (rows * 2.6) / 2 - 0.4, 0);

  entries.forEach((e, i) => {
    const obj = assets.cloneModel(model);
    obj.scale.setScalar(0.75);
    const hidden = new Set((params.get('hide') ?? HIDDEN_DEFAULT).split(','));
    obj.traverse((o) => {
      if (hidden.has(o.name)) o.visible = false;
    });
    const col = i % cols;
    const row = Math.floor(i / cols);
    obj.position.set(col * spacing, (rows - 1 - row) * 2.6, 0);
    obj.rotation.y = yaw;
    scene.add(obj);
    const clip = clips.find((c) => c.name === e.name);
    const mixer = new THREE.AnimationMixer(obj);
    if (clip) {
      const a = mixer.clipAction(clip);
      a.play();
      a.time = e.t * clip.duration;
      a.paused = true;
      mixer.update(0);
    }
    scene.updateMatrixWorld();
    const p = obj.position.clone().setY(obj.position.y - 0.15).project(camera);
    const tag = document.createElement('div');
    tag.textContent = `${e.name}@${e.t}${clip ? '' : ' (missing)'}`;
    tag.style.cssText = `position:absolute;left:${((p.x + 1) / 2) * 100}%;top:${((1 - p.y) / 2) * 100}%;transform:translateX(-50%)`;
    labels.appendChild(tag);
  });

  renderer.render(scene, camera);
  console.log('clips:', clips.map((c) => c.name).join(','));
}
