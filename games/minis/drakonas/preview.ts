import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
const A = '/play/drakonas-assets/';
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement });
r.setSize(innerWidth, innerHeight);
const s = new THREE.Scene(); s.background = new THREE.Color(0x333333);
s.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
const mode = location.hash.slice(1);
const cam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 5000);
const tl = new THREE.TextureLoader(); const ol = new OBJLoader();
async function load(name: string, tex: string, x: number, z: number, sc = 1) {
  const g = await ol.loadAsync(A + name + '.obj');
  const t = await tl.loadAsync(A + tex + '.jpg'); t.colorSpace = THREE.SRGBColorSpace;
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { const m = o as THREE.Mesh; m.geometry.computeVertexNormals(); m.material = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }); } });
  g.position.set(x, 0, z); g.scale.setScalar(sc); s.add(g);
}
if (mode === 'tiles') {
  const ts = ['tile-island-001', 'tile-hills-002', 'tile-river-grass-n-z-001', 'tile-swamp-001', 'tile-water-s-grass-n-001'];
  await Promise.all(ts.map((t, i) => load(t, t, (i - 2) * 220, 100)));
  cam.position.set(0, 900, 0); cam.lookAt(0, 0, 0);
} else {
  const ms: [string, string][] = [['player', 'player'], ['scout-001', 'scout-001'], ['fighter-001', 'fighter-001'], ['fighter-002', 'fighter-002'], ['ufo', 'ufo-glow-pink'], ['mine-001', 'mine-001'], ['boss-001', 'boss-001'], ['missile', 'missile']];
  await Promise.all(ms.map(([m, t], i) => load(m, t, ((i % 4) - 1.5) * 12, (Math.floor(i / 4) - 0.5) * 14, m === 'missile' ? 5 : 1)));
  // arrow marking -z (screen up)
  s.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-40, 0, 0), 8, 0xff0000));
  cam.position.set(0, 40, mode === 'side' ? 30 : 0.01); cam.lookAt(0, 0, 0);
}
r.render(s, cam);
(window as any).done = true;
