/**
 * Tower Smash: a ball bounces on a spinning tower of rings. Hold to smash
 * down through them. Coloured segments shatter; touching a dark red one
 * while smashing ends the run. Smash 8 rings in a row for Fever (invincible).
 */
import * as THREE from 'three';
import { Hold } from '../shared/input';
import { el, GameUI } from '../shared/ui';

const SEGMENTS = 12;
const SEG_ANGLE = (Math.PI * 2) / SEGMENTS;
const SPACING = 1.7;
const RING_R = 2.5;
const RING_H = 0.36;
const BALL_R = 0.3;
const BALL_Z = 1.75; // ball sits over the front of the rings (theta = 0)
const GRAVITY = 26;
const BOUNCE = 8.2;
const SMASH_SPEED = 13;
const FEVER_AFTER = 8;
const FEVER_TIME = 2.6;

type Seg = 'gap' | 'solid' | 'danger';
interface Ring {
  y: number;
  segs: Seg[];
  group: THREE.Group;
  meshes: (THREE.Mesh | null)[];
  finish: boolean;
}
interface Shard {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: number;
  life: number;
}

const PALETTES = [
  { solid: 0x22d3ee, bg: 0x0b1a2e, pole: 0xe2e8f0 },
  { solid: 0xa3e635, bg: 0x15210b, pole: 0xf1f5f9 },
  { solid: 0xf472b6, bg: 0x220b1c, pole: 0xfdf2f8 },
  { solid: 0xfbbf24, bg: 0x241808, pole: 0xfffbeb },
  { solid: 0x818cf8, bg: 0x10112a, pole: 0xeef2ff },
];

const ui = new GameUI('smash', 'Tower Smash');
const scoreChip = el('div', 'chip', ui.hud);
const levelChip = el('div', 'chip', ui.hud);
const feverChip = el('div', 'chip', ui.hud);
feverChip.hidden = true;
feverChip.style.background = 'linear-gradient(135deg,#ff5a1f,#ffc93c)';
feverChip.style.color = '#1a0700';
feverChip.textContent = 'FEVER!';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(4, 8, 6);
scene.add(sun);

const tower = new THREE.Group();
scene.add(tower);
const poleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1, 24), poleMat);
tower.add(pole);
const solidMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.35, metalness: 0.1 });
const dangerMat = new THREE.MeshStandardMaterial({ color: 0x2a0508, emissive: 0x7a0010, emissiveIntensity: 0.6, roughness: 0.5 });
const finishMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffc93c, emissiveIntensity: 0.5 });
const segGeo = new THREE.CylinderGeometry(RING_R, RING_R, RING_H, 4, 1, false, 0, SEG_ANGLE * 0.985);

const ballMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, emissive: 0xff3a00, emissiveIntensity: 0.35, roughness: 0.3 });
const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), ballMat);
scene.add(ball);

let rings: Ring[] = [];
let shards: Shard[] = [];
let level = 1;
let score = 0;
let streak = 0;
let fever = 0;
let ballY = 0;
let vy = 0;
let rot = 0;
let spin = 1.2;
let camY = 0;
let state: 'title' | 'play' | 'dead' = 'title';
let nextRing = 0;
let squash = 0;

const hold = new Hold(document.body);

function buildLevel(): void {
  for (const r of rings) tower.remove(r.group);
  rings = [];
  nextRing = 0;
  const pal = PALETTES[(level - 1) % PALETTES.length]!;
  solidMat.color.setHex(pal.solid);
  poleMat.color.setHex(pal.pole);
  scene.background = new THREE.Color(pal.bg);
  scene.fog = new THREE.Fog(pal.bg, 10, 30);
  const count = 16 + level * 4;
  const dangerChance = Math.min(0.12 + level * 0.035, 0.38);
  for (let i = 0; i < count; i++) {
    const finish = i === count - 1;
    const segs: Seg[] = new Array(SEGMENTS).fill('solid');
    if (!finish) {
      const gapLen = 2 + (Math.random() < 0.4 ? 1 : 0);
      const gapStart = Math.floor(Math.random() * SEGMENTS);
      for (let g = 0; g < gapLen; g++) segs[(gapStart + g) % SEGMENTS] = 'gap';
      if (i > 2) {
        for (let s = 0; s < SEGMENTS; s++) if (segs[s] === 'solid' && Math.random() < dangerChance) segs[s] = 'danger';
        // Never a fully deadly ring: keep at least 3 breakable segments.
        if (segs.filter((x) => x === 'solid').length < 3) for (let s = 0; s < SEGMENTS; s += 3) if (segs[s] === 'danger') segs[s] = 'solid';
      }
    }
    const group = new THREE.Group();
    group.position.y = -i * SPACING;
    group.rotation.y = i * 0.35 + Math.random() * 0.4; // twist the tower
    const meshes = segs.map((type, s) => {
      if (type === 'gap') return null;
      const m = new THREE.Mesh(segGeo, finish ? finishMat : type === 'danger' ? dangerMat : solidMat);
      m.rotation.y = s * SEG_ANGLE;
      group.add(m);
      return m;
    });
    tower.add(group);
    rings.push({ y: -i * SPACING, segs, group, meshes, finish });
  }
  pole.scale.y = count * SPACING + 6;
  pole.position.y = -(count * SPACING) / 2 + 2;
  ballY = 1.6;
  vy = 0;
  camY = ballY;
  spin = (0.9 + level * 0.12) * (level % 2 ? 1 : -1);
}

/** Which segment of `ring` is under the ball right now. */
function segmentUnderBall(ring: Ring): Seg {
  // The ball sits at world angle 0; segment s covers local angles [s, s+1) * SEG_ANGLE.
  const local = -(rot + ring.group.rotation.y);
  const a = ((local % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return ring.segs[Math.floor(a / SEG_ANGLE) % SEGMENTS]!;
}

function shatter(ring: Ring): void {
  ring.meshes.forEach((m) => {
    if (!m) return;
    const world = new THREE.Vector3();
    m.getWorldPosition(world);
    const q = new THREE.Quaternion();
    m.getWorldQuaternion(q);
    ring.group.remove(m);
    scene.add(m);
    m.position.copy(world);
    m.quaternion.copy(q);
    const dir = new THREE.Vector3(Math.sin(m.rotation.y + rot), 0, Math.cos(m.rotation.y + rot));
    shards.push({ mesh: m, vel: dir.multiplyScalar(4 + Math.random() * 4).setY(2 + Math.random() * 3), spin: (Math.random() - 0.5) * 8, life: 0.9 });
  });
  tower.remove(ring.group);
}

function die(): void {
  state = 'dead';
  ballMat.emissiveIntensity = 2;
  setTimeout(() => {
    void ui.gameOver(score, { title: `Level ${level}`, onRetry: start });
  }, 450);
}

function start(): void {
  level = 1;
  score = 0;
  streak = 0;
  fever = 0;
  ballMat.emissiveIntensity = 0.35;
  buildLevel();
  ui.hide();
  state = 'play';
}

function update(dt: number): void {
  rot += spin * dt;
  tower.rotation.y = rot;

  for (const s of shards) {
    s.life -= dt;
    s.vel.y -= GRAVITY * 0.6 * dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    s.mesh.rotation.x += s.spin * dt;
    s.mesh.scale.setScalar(Math.max(0.01, s.life));
    if (s.life <= 0) scene.remove(s.mesh);
  }
  shards = shards.filter((s) => s.life > 0);

  if (state !== 'play') return;
  fever = Math.max(0, fever - dt);
  feverChip.hidden = fever <= 0;
  ballMat.color.setHex(fever > 0 ? 0xffc93c : 0xff5a1f);

  const smashing = hold.held;
  if (smashing) vy = -SMASH_SPEED;
  else {
    vy -= GRAVITY * dt;
    if (streak > 0 && vy > 0) streak = 0; // a bounce ends the smash streak
  }
  const prevBottom = ballY - BALL_R;
  ballY += vy * dt;
  const bottom = ballY - BALL_R;

  const ring = rings[nextRing];
  if (ring && vy < 0 && prevBottom >= ring.y + RING_H / 2 && bottom < ring.y + RING_H / 2) {
    const under = segmentUnderBall(ring);
    const top = ring.y + RING_H / 2;
    if (ring.finish) {
      ballY = top + BALL_R;
      levelUp();
      return;
    }
    if (under === 'gap') {
      passRing(ring, false);
    } else if (smashing) {
      if (under === 'danger' && fever <= 0) {
        ballY = top + BALL_R;
        die();
        return;
      }
      passRing(ring, true);
    } else {
      ballY = top + BALL_R;
      vy = BOUNCE;
      squash = 1;
    }
  }
  squash = Math.max(0, squash - dt * 6);
  ball.scale.set(1 + squash * 0.25, 1 - squash * 0.3, 1 + squash * 0.25);
}

function passRing(ring: Ring, smashed: boolean): void {
  nextRing++;
  if (smashed) {
    streak++;
    score += fever > 0 ? 3 : 1 + Math.floor(streak / 4);
    if (streak === FEVER_AFTER) {
      fever = FEVER_TIME;
      ui.toast('FEVER! Smash through anything!', 1500);
    }
  } else {
    score += 1;
  }
  shatter(ring);
}

function levelUp(): void {
  score += 10 * level;
  level++;
  ui.toast(`Level ${level - 1} cleared! +${10 * (level - 1)}`, 1600);
  buildLevel();
}

function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the tower comfortably in view on tall phones.
  camera.fov = w < h ? 68 : 55;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  update(dt);
  ball.position.set(0, ballY, BALL_Z);
  camY += (ballY + 2.2 - camY) * Math.min(1, dt * 6);
  camera.position.set(0, camY + 2.7, 7.8);
  camera.lookAt(0, camY - 2.3, 0);
  scoreChip.textContent = `★ ${score}`;
  levelChip.textContent = `Level ${level}`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
buildLevel();
requestAnimationFrame(frame);

// Title card with controls and the current leaderboard.
const intro = document.createElement('div');
intro.innerHTML =
  '<p><b>Hold</b> (mouse, finger or <kbd>Space</kbd>) to smash down through the rings. Let go to bounce.</p>' +
  '<p>Dark red segments are deadly while you smash. Smash 8 in a row for <b>FEVER</b>.</p>';
void ui.boardInto(intro);
ui.show({ kicker: 'TRONIX ARENA', title: 'Tower Smash', body: intro, buttons: [{ label: 'Play', primary: true, onClick: start }] });

Object.assign(window, { __smash: () => ({ state, level, score, ballY, ring: nextRing, rings: rings.length }) });
