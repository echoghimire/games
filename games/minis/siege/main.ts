/**
 * Ghost Siege: 3D tower defense. Ghosts and UFOs pour out of a portal and
 * follow the dirt road to your core. Build Blasters, Cannons and Rockets
 * beside the road, upgrade them twice, and survive endless, ever harder waves.
 * Bosses every 5th wave. Call waves early for bonus gold.
 */
import * as THREE from 'three';
import { el, GameUI } from '../shared/ui';
import { type Assets, ASSET_URL, loadAssets } from './assets';
import { Board, Cell } from './board';
import {
  bountyScale,
  cellX,
  cellZ,
  clearBonus,
  COLS,
  ENEMIES,
  type EnemyDef,
  type EnemyKind,
  FIRST_WAVE_DELAY,
  hpScale,
  MAX_SCORE,
  pointScale,
  ROWS,
  SELL_REFUND,
  type Spawn,
  START_GOLD,
  START_LIVES,
  TOWER_KINDS,
  type TowerDef,
  type TowerKind,
  TOWERS,
  waveGap,
  waveSpawns,
  waveSummary,
} from './config';
import { Particles, Quads, radialTexture } from './fx';
import { muted, setMuted, sfx, unlockAudio } from './sound';
import './style.css';

interface Enemy {
  kind: EnemyKind;
  def: EnemyDef;
  hp: number;
  maxHp: number;
  d: number; // distance along the path
  speed: number;
  pos: THREE.Vector3; // hit centre
  yaw: number;
  wave: WaveRun;
  flash: number;
  bob: number;
  alive: boolean;
}

interface Tower {
  def: TowerDef;
  level: number; // 0..2
  col: number;
  row: number;
  x: number;
  z: number;
  cooldown: number;
  yaw: number;
  invested: number;
  pop: number; // build/upgrade bounce 0..1
  recoil: number;
  side: number; // alternates twin barrels
  height: number;
}

interface Shot {
  kind: TowerKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  target: Enemy | null;
  damage: number;
  splash: number;
  age: number;
  // cannon shells fly a fixed arc from s to e in `flight` seconds
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ez: number;
  flight: number;
  peak: number;
  alive: boolean;
}

interface WaveRun {
  wave: number;
  spawns: Spawn[];
  next: number;
  t: number;
  remaining: number;
  leaks: number;
}

interface Splat {
  x: number;
  z: number;
  t: number;
  yaw: number;
  size: number;
  color: number;
}

const TAU = Math.PI * 2;
const LEVEL_COLORS = [0x22d3ee, 0xffc93c, 0xf472b6];
const LEVEL_SCALE = [1, 1.1, 1.2];
const GHOST_YAW = Math.PI / 2; // the ghost model faces -x
const DEMO_TOWERS: [number, number, TowerKind][] = [
  [3, 4, 'blaster'],
  [5, 6, 'cannon'],
  [8, 4, 'rocket'],
  [11, 5, 'blaster'],
];

// ---------------------------------------------------------------- UI shell

const ui = new GameUI('siege', 'Ghost Siege');
const waveChip = el('div', 'chip', ui.hud);
const livesChip = el('div', 'chip', ui.hud);
const goldChip = el('div', 'chip', ui.hud);
const scoreChip = el('div', 'chip', ui.hud);

const controls = el('div', 'sg-controls', document.body);
const info = el('div', 'sg-info', controls);
const btnRow = el('div', 'sg-buttons', controls);
const pauseBtn = iconButton(btnRow, 'Pause (P)', '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>');
const soundBtn = iconButton(btnRow, 'Sound (M)', '');
const speedBtn = el('button', 'sg-btn sg-btn--speed', btnRow);
speedBtn.title = 'Game speed (F)';
const nextBtn = el('button', 'sg-next', btnRow);
const menu = el('div', 'sg-menu', document.body);
menu.hidden = true;
const banner = el('div', 'sg-banner', document.body);
const floaters = el('div', 'sg-floaters', document.body);

function iconButton(parent: HTMLElement, title: string, svg: string): HTMLButtonElement {
  const b = el('button', 'sg-btn', parent);
  b.title = title;
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${svg}</svg>`;
  return b;
}

function renderSoundIcon(): void {
  const wave = muted ? '<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" fill="none"/>' : '<path d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>';
  soundBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9h4l5-4v14l-5-4H4z"/>${wave}</svg>`;
}
renderSoundIcon();

// ---------------------------------------------------------------- renderer

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 1.5, alpha: true, powerPreference: 'high-performance' });
let maxPixelRatio = 2;
renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 200);
scene.add(new THREE.HemisphereLight(0xdde8ff, 0x3a2c22, 1.6));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(-4, 10, 6);
scene.add(sun);

// ---------------------------------------------------------------- game state

let assets: Assets | null = null;
let board: Board | null = null;
let state: 'loading' | 'title' | 'play' | 'over' = 'loading';
let paused = false;
let speed = 1;
let wave = 0;
let nextIn = -1; // countdown to the next wave (-1 while a wave is spawning)
let runs: WaveRun[] = [];
let gold = START_GOLD;
let lives = START_LIVES;
let score = 0;
let kills = 0;
let enemies: Enemy[] = [];
let shots: Shot[] = [];
let splats: Splat[] = [];
const towers = new Map<number, Tower>();
let selected: { col: number; row: number } | null = null;
let hover: { col: number; row: number } | null = null;
let previewKind: TowerKind | null = null;
let shake = 0;
let coreHit = 0;
let time = 0;
let demoSpawn = 0;
let ambient = 0;

// Scene objects that need assets are created in init().
let ghostMesh: THREE.InstancedMesh;
let ufoMesh: THREE.InstancedMesh;
// Towers are instanced per model (3 draw calls), pads share one instanced mesh.
const towerMeshes: THREE.InstancedMesh[] = [];
const towerOwners: Tower[][] = [[], [], []];
let padMesh: THREE.InstancedMesh;
const MAX_TOWERS = COLS * ROWS;
let glow: Particles;
let smoke: Particles;
let balls: Particles;
let flares: Particles;
let shadows: Quads;
let bars: Quads;
let splatQuads: Quads;
const rangeGroup = new THREE.Group();
let selector: THREE.Mesh;
const selectorMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, color: 0x39ff88 });

// ---------------------------------------------------------------- setup

async function init(): Promise<void> {
  assets = await loadAssets();
  board = new Board(assets.grass, renderer.capabilities.getMaxAnisotropy());
  scene.add(board.group);

  const ghostMat = new THREE.MeshLambertMaterial({ map: assets.ghostTex, transparent: true, opacity: 0.9, emissive: 0x2c5a6e });
  ghostMesh = new THREE.InstancedMesh(assets.ghost, ghostMat, 256);
  const ufoMat = new THREE.MeshLambertMaterial({ map: assets.ufoTex, emissive: 0x221a00 });
  ufoMesh = new THREE.InstancedMesh(assets.ufo, ufoMat, 128);
  for (const m of [ghostMesh, ufoMesh]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color());
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
  }

  for (let i = 0; i < 3; i++) {
    const m = new THREE.InstancedMesh(assets.towers[i]!, new THREE.MeshLambertMaterial({ map: assets.towerTex[i], emissive: 0x262a33 }), MAX_TOWERS);
    towerMeshes.push(m);
  }
  // Tower pads: a dark hex plate with a bright rim, tinted per level through the instance colour.
  const plate = new THREE.CylinderGeometry(0.44, 0.48, 0.07, 6).toNonIndexed().translate(0, 0.035, 0);
  const rim = new THREE.TorusGeometry(0.45, 0.025, 6, 6).toNonIndexed().rotateX(Math.PI / 2).rotateY(Math.PI / 6).translate(0, 0.07, 0);
  const padGeo = new THREE.BufferGeometry();
  const parts = [plate, rim];
  padGeo.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap((p) => [...(p.getAttribute('position').array as Float32Array)]), 3));
  padGeo.setAttribute('normal', new THREE.Float32BufferAttribute(parts.flatMap((p) => [...(p.getAttribute('normal').array as Float32Array)]), 3));
  const cols: number[] = [];
  for (let i = 0; i < plate.getAttribute('position').count; i++) cols.push(0.22, 0.24, 0.3);
  for (let i = 0; i < rim.getAttribute('position').count; i++) cols.push(1.6, 1.6, 1.6);
  padGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  padMesh = new THREE.InstancedMesh(padGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_TOWERS);
  for (const m of [...towerMeshes, padMesh]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
  }
  padMesh.setColorAt(0, new THREE.Color());

  const glowTex = radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.22, 'rgba(255,255,255,0.75)'],
    [0.55, 'rgba(255,255,255,0.18)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  glow = new Particles(glowTex, true, 2500);
  smoke = new Particles(assets.smoke, false, 900);
  balls = new Particles(assets.ball, false, 200);
  flares = new Particles(assets.flare, true, 300);
  scene.add(smoke.points, balls.points, glow.points, flares.points);

  const shadowTex = radialTexture([
    [0, 'rgba(0,0,0,0.55)'],
    [0.6, 'rgba(0,0,0,0.3)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  shadows = new Quads(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), 400);
  shadows.mesh.renderOrder = 1;
  splatQuads = new Quads(new THREE.MeshBasicMaterial({ map: assets.splat, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 60);
  splatQuads.mesh.renderOrder = 1;
  bars = new Quads(new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true }), 600);
  bars.mesh.renderOrder = 20;
  scene.add(shadows.mesh, splatQuads.mesh, bars.mesh);

  // Range ring (soft disc + crisp edge) and the tile selector.
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.1, depthWrite: false }));
  const edge = new THREE.Mesh(new THREE.RingGeometry(0.975, 1, 96), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.75, depthWrite: false }));
  for (const m of [disc, edge]) {
    m.rotation.x = -Math.PI / 2;
    rangeGroup.add(m);
  }
  rangeGroup.visible = false;
  rangeGroup.renderOrder = 2;
  scene.add(rangeGroup);
  selectorMat.map = selectorTexture();
  selector = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), selectorMat);
  selector.rotation.x = -Math.PI / 2;
  selector.position.y = 0.02;
  selector.renderOrder = 3;
  selector.visible = false;
  scene.add(selector);

  resize();
  state = 'title';
  for (const [c, r, k] of DEMO_TOWERS) placeTower(c, r, k, true);
}

function selectorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(8, 8, 112, 112, 18);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fill();
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- game flow

function clearField(): void {
  towers.clear();
  enemies = [];
  shots = [];
  splats = [];
  runs = [];
  for (const p of [glow, smoke, balls, flares]) p.clear();
}

function start(): void {
  if (!board) {
    ui.toast('Loading the battlefield…', 1200);
    return;
  }
  unlockAudio();
  clearField();
  closeMenu();
  wave = 0;
  nextIn = FIRST_WAVE_DELAY;
  gold = START_GOLD;
  lives = START_LIVES;
  score = 0;
  kills = 0;
  speed = 1;
  paused = false;
  state = 'play';
  ui.hide();
  showBanner('Build your defences', 'Tap a free tile to build a tower');
}

function startWave(): void {
  wave++;
  nextIn = -1;
  const spawns = waveSpawns(wave);
  runs.push({ wave, spawns, next: 0, t: 0, remaining: spawns.length, leaks: 0 });
  const boss = spawns.some((s) => s.kind === 'boss');
  showBanner(`Wave ${wave}`, boss ? 'BOSS incoming!' : waveSummary(wave));
  sfx.wave(boss);
}

/** "Call wave" button: start the next wave now, for gold and points. */
function callWave(): void {
  if (state !== 'play' || paused || nextIn <= 0) return;
  const bonus = Math.round(nextIn);
  if (bonus > 0) {
    gold += bonus;
    addScore(bonus * 10);
    floatText(window.innerWidth - 90, window.innerHeight - 80, `+${bonus}◆ early`, 'gold');
  }
  startWave();
}

function gameOver(): void {
  if (state !== 'play') return;
  state = 'over';
  closeMenu();
  shake = 1.4;
  const b = board!.basePos;
  glow.burst(b.x, 0.7, b.z, 60, 5, { life: 1.1, size: 0.5, sizeEnd: 0.1, color: 0xff6a3d, grav: 3 });
  smoke.burst(b.x, 0.6, b.z, 24, 1.6, { life: 2, size: 0.8, sizeEnd: 1.8, color: 0x444444, alpha: 0.8, drag: 1.5 });
  sfx.boom(true);
  setTimeout(() => {
    void ui.gameOver(score, { title: wave >= 20 ? `Legend! Wave ${wave}` : `Overrun on wave ${wave}`, onRetry: start });
  }, 1400);
}

function addScore(n: number): void {
  score = Math.min(MAX_SCORE, score + Math.round(n));
}

function setPaused(p: boolean): void {
  if (state !== 'play' || paused === p) return;
  paused = p;
  if (p) {
    closeMenu();
    ui.show({
      kicker: 'PAUSED',
      title: 'Ghost Siege',
      body: `<p>Wave ${wave} · ${lives} lives · ${score} points</p>`,
      buttons: [
        { label: 'Resume', primary: true, onClick: () => setPaused(false) },
        { label: 'Restart', onClick: start },
      ],
    });
  } else {
    ui.hide();
  }
}

// ---------------------------------------------------------------- towers

const key = (c: number, r: number): number => r * COLS + c;

function canBuild(c: number, r: number): boolean {
  return !!board && board.cell(c, r) === Cell.Free && !towers.has(key(c, r));
}

function placeTower(c: number, r: number, kind: TowerKind, free = false): Tower | null {
  const def = TOWERS[kind];
  const cost = def.levels[0].cost;
  if (!canBuild(c, r) || (!free && gold < cost)) return null;
  if (!free) gold -= cost;
  const x = cellX(c);
  const z = cellZ(r);
  const t: Tower = {
    def,
    level: 0,
    col: c,
    row: r,
    x,
    z,
    cooldown: 0.3,
    yaw: Math.random() * TAU,
    invested: cost,
    pop: 0,
    recoil: 0,
    side: 1,
    height: assets!.towers[def.model - 1]!.boundingBox!.max.y,
  };
  towers.set(key(c, r), t);
  if (!free) {
    smoke.burst(x, 0.1, z, 10, 1.2, { life: 0.8, size: 0.35, sizeEnd: 0.8, color: 0xc8b48c, alpha: 0.7, drag: 3 });
    sfx.build();
  }
  return t;
}

function upgradeTower(t: Tower): boolean {
  if (t.level >= 2) return false;
  const cost = t.def.levels[t.level + 1]!.cost;
  if (gold < cost) {
    sfx.denied();
    return false;
  }
  gold -= cost;
  t.invested += cost;
  t.level++;
  t.pop = 0.4;
  glow.burst(t.x, 0.4, t.z, 24, 2.2, { life: 0.7, size: 0.18, sizeEnd: 0.02, color: LEVEL_COLORS[t.level]!, vy: 1.5 });
  sfx.upgrade();
  return true;
}

function sellTower(t: Tower): void {
  const refund = Math.floor(t.invested * SELL_REFUND);
  gold += refund;
  towers.delete(key(t.col, t.row));
  smoke.burst(t.x, 0.2, t.z, 12, 1.4, { life: 0.9, size: 0.4, sizeEnd: 0.9, color: 0x9a9a9a, alpha: 0.7, drag: 3 });
  const p = toScreen(t.x, 0.6, t.z);
  floatText(p.x, p.y, `+${refund}◆`, 'gold');
  sfx.sell();
}

const stats = (t: TowerDef, level: number) => t.levels[level]!;

function updateTower(t: Tower, dt: number): void {
  t.pop = Math.max(0, t.pop - dt);
  t.recoil = Math.max(0, t.recoil - dt * 6);
  t.cooldown -= dt;
  const s = stats(t.def, t.level);
  // Blasters and Cannons go for the enemy furthest along; Rockets for the toughest.
  let best: Enemy | null = null;
  let bestScore = -Infinity;
  const r2 = s.range * s.range;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.pos.x - t.x;
    const dz = e.pos.z - t.z;
    if (dx * dx + dz * dz > r2) continue;
    const v = t.def.kind === 'rocket' ? e.hp + e.d * 0.01 : e.d;
    if (v > bestScore) {
      bestScore = v;
      best = e;
    }
  }
  if (!best) return;
  const want = Math.atan2(best.pos.x - t.x, best.pos.z - t.z);
  let diff = want - t.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  t.yaw += Math.sign(diff) * Math.min(Math.abs(diff), dt * 9);
  if (t.cooldown > 0 || Math.abs(diff) > 0.6) return;
  t.cooldown = 1 / s.rate;
  fire(t, best, s.damage, s.splash);
}

function fire(t: Tower, target: Enemy, damage: number, splash: number): void {
  const k = LEVEL_SCALE[t.level]!;
  const fx = Math.sin(t.yaw);
  const fz = Math.cos(t.yaw);
  const top = t.height * k * 0.85 + 0.07;
  t.recoil = 1;
  const base: Shot = { kind: t.def.kind, x: t.x, y: top, z: t.z, vx: 0, vy: 0, vz: 0, target, damage, splash, age: 0, sx: 0, sy: 0, sz: 0, ex: 0, ez: 0, flight: 0, peak: 0, alive: true };
  if (t.def.kind === 'blaster') {
    t.side = -t.side;
    const side = t.level === 2 ? t.side * 0.14 : 0;
    base.x += fx * 0.32 + fz * side;
    base.z += fz * 0.32 - fx * side;
    base.y = top * 0.8;
    glow.emit(base.x, base.y, base.z, { life: 0.09, size: 0.55, sizeEnd: 0.2, color: LEVEL_COLORS[t.level]! });
    sfx.blaster();
  } else if (t.def.kind === 'cannon') {
    // Lead the target: aim where it will be when the shell lands.
    const dist = Math.hypot(target.pos.x - t.x, target.pos.z - t.z);
    base.flight = 0.45 + dist * 0.12;
    const aim = board!.sample(Math.min(board!.length, target.d + target.speed * base.flight), new THREE.Vector3());
    base.sx = base.x = t.x + fx * 0.2;
    base.sz = base.z = t.z + fz * 0.2;
    base.sy = top;
    base.ex = aim.x;
    base.ez = aim.z;
    base.peak = 0.8 + dist * 0.22;
    glow.emit(base.x, top + 0.05, base.z, { life: 0.12, size: 0.7, sizeEnd: 0.2, color: 0xffb347 });
    smoke.burst(base.x, top, base.z, 4, 0.6, { life: 0.6, size: 0.25, sizeEnd: 0.6, color: 0xbbbbbb, alpha: 0.6, drag: 2, vy: 0.6 });
    sfx.cannon();
  } else {
    base.vx = fx * 1.2 + (Math.random() - 0.5);
    base.vz = fz * 1.2 + (Math.random() - 0.5);
    base.vy = 3.2;
    glow.emit(base.x, top, base.z, { life: 0.2, size: 0.7, sizeEnd: 0.1, color: 0xff7a3d });
    smoke.burst(t.x, 0.2, t.z, 6, 1, { life: 0.7, size: 0.3, sizeEnd: 0.7, color: 0xcccccc, alpha: 0.6, drag: 3 });
    sfx.rocket();
  }
  shots.push(base);
}

// ---------------------------------------------------------------- enemies

function spawnEnemy(kind: EnemyKind, run: WaveRun | null): void {
  const def = ENEMIES[kind];
  const hp = def.hp * hpScale(run?.wave ?? 1);
  const e: Enemy = {
    kind,
    def,
    hp,
    maxHp: hp,
    d: 0,
    speed: def.speed * (0.94 + Math.random() * 0.12),
    pos: new THREE.Vector3(),
    yaw: Math.PI / 2,
    wave: run ?? { wave: 0, spawns: [], next: 0, t: 0, remaining: 1, leaks: 0 },
    flash: 0,
    bob: Math.random() * TAU,
    alive: true,
  };
  board!.sample(0, e.pos).setY(def.height);
  enemies.push(e);
  const p = board!.portalPos;
  glow.burst(p.x, 0.5, p.z, kind === 'boss' ? 30 : 8, 1.2, { life: 0.6, size: 0.2, sizeEnd: 0.02, color: 0xc084fc });
}

const ahead = new THREE.Vector3();

function updateEnemy(e: Enemy, dt: number): void {
  e.d += e.speed * dt;
  e.flash = Math.max(0, e.flash - dt);
  e.bob += dt * (e.kind === 'wisp' ? 7 : 3);
  if (e.d >= board!.length) {
    leak(e);
    return;
  }
  board!.sample(e.d, e.pos);
  board!.sample(e.d + 0.15, ahead);
  e.yaw = Math.atan2(ahead.x - e.pos.x, ahead.z - e.pos.z);
  e.pos.y = e.def.height + Math.sin(e.bob) * 0.06;
  if (e.kind === 'wisp' && Math.random() < dt * 20) {
    glow.emit(e.pos.x, e.pos.y, e.pos.z, { life: 0.4, size: 0.22, sizeEnd: 0.02, color: 0xff7849, vy: 0.4 });
  }
  if (e.kind === 'boss' && Math.random() < dt * 12) {
    flares.emit(e.pos.x + (Math.random() - 0.5) * 1.2, e.pos.y - 0.2, e.pos.z + (Math.random() - 0.5) * 1.2, { life: 0.6, size: 0.3, sizeEnd: 0.05, color: 0xff66cc, vy: -0.6 });
  }
}

function hurt(e: Enemy, dmg: number): void {
  if (!e.alive) return;
  e.hp -= dmg;
  e.flash = 0.1;
  if (e.hp <= 0) kill(e);
}

function kill(e: Enemy): void {
  e.alive = false;
  e.wave.remaining--;
  const { x, y, z } = e.pos;
  if (e.kind === 'ghost' || e.kind === 'wisp') {
    const c = e.kind === 'ghost' ? 0x7dfcc2 : 0xff8a5c;
    glow.burst(x, y, z, 16, 2.4, { life: 0.7, size: 0.2, sizeEnd: 0.02, color: c, vy: 1.2, drag: 2 });
    glow.emit(x, y, z, { life: 0.25, size: 1.1, sizeEnd: 0.2, color: c });
    splats.push({ x, z, t: 2.5, yaw: Math.random() * TAU, size: 0.7 + Math.random() * 0.3, color: e.kind === 'ghost' ? 0x2ee59d : 0xff6a3d });
  } else {
    const big = e.kind === 'boss';
    glow.burst(x, y, z, big ? 70 : 22, big ? 5 : 3, { life: big ? 1 : 0.6, size: big ? 0.35 : 0.2, sizeEnd: 0.02, color: 0xffd36b, grav: 4 });
    glow.emit(x, y, z, { life: 0.3, size: big ? 3.5 : 1.4, sizeEnd: 0.3, color: 0xff9a3d });
    smoke.burst(x, y, z, big ? 18 : 6, big ? 1.8 : 1, { life: 1.4, size: big ? 0.8 : 0.4, sizeEnd: big ? 1.8 : 0.9, color: 0x555555, alpha: 0.75, drag: 2, vy: 0.5 });
    if (big) shake = Math.max(shake, 0.7);
    sfx.boom(big);
  }
  if (state === 'play') {
    const bounty = Math.round(e.def.bounty * bountyScale(e.wave.wave));
    gold += bounty;
    kills++;
    addScore(e.def.points * pointScale(e.wave.wave));
    const p = toScreen(x, y + 0.4, z);
    floatText(p.x, p.y, `+${bounty}`, 'gold');
  }
  sfx.kill();
}

function leak(e: Enemy): void {
  e.alive = false;
  e.wave.remaining--;
  e.wave.leaks++;
  if (state !== 'play') return;
  lives = Math.max(0, lives - e.def.lives);
  coreHit = 1;
  shake = Math.max(shake, e.kind === 'boss' ? 1.2 : 0.55);
  const b = board!.basePos;
  glow.burst(b.x, 0.7, b.z, 26, 3, { life: 0.6, size: 0.22, sizeEnd: 0.02, color: 0xff4d4d, grav: 2 });
  sfx.leak();
  const p = toScreen(b.x, 1.1, b.z);
  floatText(p.x, p.y, `-${e.def.lives} ♥`, 'bad');
  if (lives <= 0) gameOver();
}

// ---------------------------------------------------------------- projectiles

function updateShot(s: Shot, dt: number): void {
  s.age += dt;
  const tgt = s.target && s.target.alive ? s.target : null;
  if (s.kind === 'blaster') {
    if (tgt) {
      const dx = tgt.pos.x - s.x;
      const dy = tgt.pos.y - s.y;
      const dz = tgt.pos.z - s.z;
      const d = Math.hypot(dx, dy, dz);
      const v = 13;
      if (d < v * dt + tgt.def.radius * 0.5) {
        hurt(tgt, s.damage);
        glow.burst(s.x, s.y, s.z, 4, 1.5, { life: 0.2, size: 0.12, sizeEnd: 0.02, color: 0xbff7ff });
        s.alive = false;
        return;
      }
      s.vx = (dx / d) * v;
      s.vy = (dy / d) * v;
      s.vz = (dz / d) * v;
    } else if (s.age > 0.5) s.alive = false;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
  } else if (s.kind === 'cannon') {
    const p = Math.min(1, s.age / s.flight);
    s.x = s.sx + (s.ex - s.sx) * p;
    s.z = s.sz + (s.ez - s.sz) * p;
    s.y = s.sy + (0.15 - s.sy) * p + s.peak * 4 * p * (1 - p);
    if (Math.random() < dt * 25) smoke.emit(s.x, s.y, s.z, { life: 0.5, size: 0.14, sizeEnd: 0.35, color: 0xdddddd, alpha: 0.5 });
    if (p >= 1) {
      explode(s.x, s.z, s.splash, s.damage, null, 1);
      s.alive = false;
    }
  } else {
    // Homing rocket: re-acquire if the target died, steer, accelerate.
    if (!tgt) s.target = nearestEnemy(s.x, s.z, 3.5);
    const target = s.target && s.target.alive ? s.target : null;
    const sp = Math.min(11, 3 + s.age * 9);
    if (target && s.age > 0.18) {
      const dx = target.pos.x - s.x;
      const dy = target.pos.y - s.y;
      const dz = target.pos.z - s.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.3 + target.def.radius * 0.5) {
        explode(s.x, s.z, s.splash, s.damage * 0.5, target, 0.7, s.damage);
        s.alive = false;
        return;
      }
      const turn = Math.min(1, dt * 7);
      s.vx += ((dx / d) * sp - s.vx) * turn;
      s.vy += ((dy / d) * sp - s.vy) * turn;
      s.vz += ((dz / d) * sp - s.vz) * turn;
    } else {
      s.vy -= 6 * dt;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    smoke.emit(s.x, s.y, s.z, { life: 0.55, size: 0.12, sizeEnd: 0.4, color: 0xcfcfcf, alpha: 0.55 });
    if (s.y < 0.05 || s.age > 4) {
      explode(s.x, s.z, s.splash, s.damage * 0.5, null, 0.7);
      s.alive = false;
    }
  }
}

function nearestEnemy(x: number, z: number, max: number): Enemy | null {
  let best: Enemy | null = null;
  let bd = max * max;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = (e.pos.x - x) ** 2 + (e.pos.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Splash damage with falloff; `direct` takes `directDmg` on top. */
function explode(x: number, z: number, radius: number, dmg: number, direct: Enemy | null, size: number, directDmg = 0): void {
  if (direct) hurt(direct, directDmg - dmg);
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.pos.x - x, e.pos.z - z) - e.def.radius * 0.5;
    if (d <= radius) hurt(e, dmg * (1 - 0.5 * Math.max(0, d) / radius));
  }
  glow.emit(x, 0.35, z, { life: 0.28, size: 2.2 * size * Math.max(0.6, radius), sizeEnd: 0.4, color: 0xffa040 });
  glow.burst(x, 0.3, z, Math.round(14 * size), 2.6 * size, { life: 0.5, size: 0.16, sizeEnd: 0.02, color: 0xffd36b, grav: 5, vy: 1.5 });
  smoke.burst(x, 0.3, z, Math.round(6 * size), 1.1, { life: 1, size: 0.35, sizeEnd: 0.9 * size + 0.3, color: 0x6b6b6b, alpha: 0.7, drag: 2.5, vy: 0.5 });
  shake = Math.max(shake, 0.12 * size);
  sfx.boom();
}

// ---------------------------------------------------------------- simulation

function update(dt: number): void {
  time += dt;
  if (state === 'play') {
    if (nextIn > 0) {
      nextIn -= dt;
      if (nextIn <= 0) startWave();
    }
    for (const run of runs) {
      run.t += dt;
      while (run.next < run.spawns.length && run.spawns[run.next]!.at <= run.t) spawnEnemy(run.spawns[run.next++]!.kind, run);
    }
    if (nextIn < 0 && runs.every((r) => r.next >= r.spawns.length)) nextIn = waveGap(wave);
    for (const run of runs) {
      if (run.next < run.spawns.length || run.remaining > 0) continue;
      const perfect = run.leaks === 0;
      const bonus = Math.round(clearBonus(run.wave) * (perfect ? 1.5 : 1));
      gold += bonus;
      addScore(run.wave * 50 * (perfect ? 1.5 : 1));
      showBanner(`Wave ${run.wave} cleared`, `+${bonus}◆${perfect ? ' · Perfect!' : ''}`, true);
      sfx.cleared();
    }
    runs = runs.filter((r) => r.next < r.spawns.length || r.remaining > 0);
  } else if (state === 'title') {
    // Attract mode: a gentle trickle of ghosts for the demo towers.
    demoSpawn -= dt;
    if (demoSpawn <= 0 && enemies.length < 14) {
      demoSpawn = 0.9 + Math.random() * 0.8;
      spawnEnemy(Math.random() < 0.18 ? 'ufo' : Math.random() < 0.2 ? 'wisp' : 'ghost', null);
    }
  }

  for (const e of enemies) if (e.alive) updateEnemy(e, dt);
  enemies = enemies.filter((e) => e.alive);
  for (const t of towers.values()) updateTower(t, dt);
  for (const s of shots) if (s.alive) updateShot(s, dt);
  shots = shots.filter((s) => s.alive);
  for (const sp of splats) sp.t -= dt;
  splats = splats.filter((sp) => sp.t > 0);

  // Ambient fireflies and portal sparks.
  ambient -= dt;
  if (ambient <= 0 && board) {
    ambient = 0.12;
    glow.emit((Math.random() - 0.5) * COLS, 0.2 + Math.random() * 0.6, (Math.random() - 0.5) * ROWS, { life: 3, size: 0.09, sizeEnd: 0.02, color: Math.random() < 0.5 ? 0xb8ffcf : 0x9ae6ff, vy: 0.12, vx: (Math.random() - 0.5) * 0.2 });
    const p = board.portalPos;
    const a = Math.random() * TAU;
    glow.emit(p.x, 0.5 + Math.sin(a) * 0.4, p.z + Math.cos(a) * 0.4, { life: 0.8, size: 0.12, sizeEnd: 0.02, color: 0xd8b4fe, vx: 0.5, vy: -Math.sin(a) * 0.3, vz: -Math.cos(a) * 0.3 });
  }
  for (const p of [glow, smoke, balls, flares]) p.update(dt);
  shake = Math.max(0, shake - dt * 2.2);
  coreHit = Math.max(0, coreHit - dt * 2.5);
}

// ---------------------------------------------------------------- rendering

const m4 = new THREE.Matrix4();
const qy = new THREE.Quaternion();
const vScale = new THREE.Vector3();
const vPos = new THREE.Vector3();
const tint = new THREE.Color();
const camTarget = new THREE.Vector3();
const camBase = new THREE.Vector3();

function draw(): void {
  if (!board) {
    renderer.render(scene, camera);
    return;
  }
  // Camera with screen shake.
  const sh = shake * shake * 0.25;
  camera.position.copy(camBase).add(vPos.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
  camera.lookAt(camTarget);

  // Enemies (two instanced meshes) and their blob shadows.
  shadows.begin();
  bars.begin();
  let ng = 0;
  let nu = 0;
  for (const e of enemies) {
    const ghostish = e.kind === 'ghost' || e.kind === 'wisp';
    const mesh = ghostish ? ghostMesh : ufoMesh;
    const i = ghostish ? ng++ : nu++;
    if (i >= mesh.instanceMatrix.count) continue;
    const scale = e.kind === 'boss' ? 2 : e.kind === 'wisp' ? 0.8 : 1;
    if (ghostish) {
      qy.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, e.yaw + GHOST_YAW);
      vPos.set(e.pos.x, e.pos.y - 0.36 * scale, e.pos.z);
    } else {
      qy.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * (e.kind === 'boss' ? 1.2 : 2.5));
      vPos.set(e.pos.x, e.pos.y - 0.1 * scale, e.pos.z);
    }
    m4.compose(vPos, qy, vScale.setScalar(scale));
    mesh.setMatrixAt(i, m4);
    tint.setHex(e.kind === 'wisp' ? 0xff9a6b : e.kind === 'boss' ? 0xff8ae0 : e.kind === 'ghost' ? 0xe6fdff : 0xffffff);
    if (e.flash > 0) tint.multiplyScalar(3);
    mesh.setColorAt(i, tint);
    const sz = e.kind === 'boss' ? 1.8 : e.kind === 'ufo' ? 0.85 : 0.6 * scale;
    shadows.ground(e.pos.x, 0.015, e.pos.z, sz, sz, 0xffffff);
    if (e.hp < e.maxHp || e.kind === 'boss') {
      const w = e.kind === 'boss' ? 1.3 : 0.6;
      const top = e.kind === 'boss' ? 1.75 : e.kind === 'ufo' ? 0.95 : 1.0 * scale;
      const r = Math.max(0, e.hp / e.maxHp);
      const col = r > 0.6 ? 0x4ade80 : r > 0.3 ? 0xfacc15 : 0xef4444;
      bars.billboard(camera.quaternion, e.pos.x, top, e.pos.z, w + 0.06, 0.12, 0x0b0b12);
      // Shift the fill left along the camera's right vector so it drains to the left.
      vScale.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(-(w * (1 - r)) / 2);
      bars.billboard(camera.quaternion, e.pos.x + vScale.x, top + vScale.y, e.pos.z + vScale.z, w * r, 0.07, col, 1.2);
    }
  }
  ghostMesh.count = Math.min(ng, ghostMesh.instanceMatrix.count);
  ufoMesh.count = Math.min(nu, ufoMesh.instanceMatrix.count);
  for (const m of [ghostMesh, ufoMesh]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  // Towers: aim, build bounce, recoil; one instanced mesh per model plus the pads.
  const counts = [0, 0, 0];
  let np = 0;
  for (const t of towers.values()) {
    const pop = t.pop > 0 ? 1 + Math.sin((t.pop / 0.4) * Math.PI) * 0.18 : 1;
    const k = LEVEL_SCALE[t.level]! * pop;
    const mi = t.def.model - 1;
    qy.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.yaw);
    m4.compose(vPos.set(t.x, 0.07, t.z), qy, vScale.set(k, k * (1 - t.recoil * 0.06), k));
    towerOwners[mi]![counts[mi]!] = t;
    towerMeshes[mi]!.setMatrixAt(counts[mi]!++, m4);
    qy.identity();
    m4.compose(vPos.set(t.x, 0, t.z), qy, vScale.setScalar(1));
    padMesh.setMatrixAt(np, m4);
    padMesh.setColorAt(np++, tint.setHex(LEVEL_COLORS[t.level]!));
    shadows.ground(t.x, 0.012, t.z, 1.15, 1.15, 0xffffff);
  }
  towerMeshes.forEach((m, i) => {
    m.count = counts[i]!;
    m.instanceMatrix.needsUpdate = true;
  });
  padMesh.count = np;
  padMesh.instanceMatrix.needsUpdate = true;
  padMesh.instanceColor!.needsUpdate = true;
  shadows.end();
  bars.end();

  splatQuads.begin();
  // Additive blending, so splats fade out by darkening their colour.
  for (const sp of splats) splatQuads.ground(sp.x, 0.02, sp.z, sp.size, sp.size, sp.color, sp.yaw, Math.min(1, sp.t / 1.5) * 0.8);
  splatQuads.end();

  // Projectiles drawn as one-frame sprites.
  for (const p of [glow, smoke, balls, flares]) p.begin();
  for (const s of shots) {
    if (s.kind === 'blaster') {
      glow.put(s.x, s.y, s.z, 0.32, 0x67e8f9);
      glow.put(s.x - s.vx * 0.012, s.y - s.vy * 0.012, s.z - s.vz * 0.012, 0.22, 0x22d3ee, 0.7);
      glow.put(s.x - s.vx * 0.024, s.y - s.vy * 0.024, s.z - s.vz * 0.024, 0.14, 0x0891b2, 0.5);
    } else if (s.kind === 'cannon') {
      balls.put(s.x, s.y, s.z, 0.26, 0xffffff);
    } else {
      flares.put(s.x, s.y, s.z, 0.32, 0xffffff);
      glow.put(s.x, s.y, s.z, 0.5, 0xff7a3d, 0.8);
    }
  }
  for (const p of [glow, smoke, balls, flares]) p.flush();

  board.update(time, lives / START_LIVES, coreHit);
  updateSelection();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- camera fit

let marginTop = 56;
let marginBottom = 64;

/** Fit the whole board between the top bar and the bottom controls, any aspect ratio. */
function fitCamera(): void {
  const w = innerWidth;
  const h = innerHeight;
  const portrait = h > w * 1.1;
  const az = portrait ? Math.PI / 2 : 0;
  const pitch = THREE.MathUtils.degToRad(portrait ? 64 : 55);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(pitch), Math.sin(pitch), Math.cos(az) * Math.cos(pitch));
  camera.aspect = w / h;
  camera.clearViewOffset();
  const corners: THREE.Vector3[] = [];
  for (const x of [-COLS / 2 - 0.8, COLS / 2 + 0.25])
    for (const y of [-0.75, 0.9]) for (const z of [-ROWS / 2 - 0.25, ROWS / 2 + 0.25]) corners.push(new THREE.Vector3(x, y, z));
  const side = 10;
  const availW = (2 * (w - side * 2)) / w;
  const availH = (2 * (h - marginTop - marginBottom - 8)) / h;
  camTarget.set(0, 0, 0);
  const bounds = (dist: number): [number, number, number, number] => {
    camera.position.copy(dir).multiplyScalar(dist);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const v = new THREE.Vector3();
    for (const c of corners) {
      v.copy(c).project(camera);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
    return [x0, x1, y0, y1];
  };
  let lo = 4;
  let hi = 120;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const [x0, x1, y0, y1] = bounds(mid);
    if (x1 - x0 <= availW && y1 - y0 <= availH) hi = mid;
    else lo = mid;
  }
  const [x0, x1, y0, y1] = bounds(hi);
  camBase.copy(camera.position);
  // Shift the image (not the camera) so the board sits centred in the free area.
  const wantY = (marginBottom - marginTop) / h;
  const shiftX = -(x0 + x1) / 2;
  const shiftY = wantY - (y0 + y1) / 2;
  camera.setViewOffset(w, h, (-shiftX * w) / 2, (shiftY * h) / 2, w, h);
  camera.updateProjectionMatrix();
  const pxScale = (renderer.getPixelRatio() * h * camera.projectionMatrix.elements[5]!) / 2;
  for (const p of [glow, smoke, balls, flares]) p?.setScale(pxScale);
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  const bar = document.querySelector('.bar');
  marginTop = bar ? bar.getBoundingClientRect().bottom + 2 : 56;
  marginBottom = innerHeight - controls.getBoundingClientRect().top;
  fitCamera();
  if (selected) positionMenu();
}
addEventListener('resize', resize);
new ResizeObserver(() => resize()).observe(controls);
const barEl = document.querySelector('.bar');
if (barEl) new ResizeObserver(() => resize()).observe(barEl);

// ---------------------------------------------------------------- input

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function cellAt(clientX: number, clientY: number, preferTowers: boolean): { col: number; row: number } | null {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (preferTowers) {
    for (const m of towerMeshes) m.computeBoundingSphere();
    const hit = raycaster.intersectObjects(towerMeshes, false)[0];
    const t = hit && hit.instanceId !== undefined ? towerOwners[towerMeshes.indexOf(hit.object as THREE.InstancedMesh)]![hit.instanceId] : undefined;
    if (t) return { col: t.col, row: t.row };
  }
  const p = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!p) return null;
  const col = Math.floor(p.x + COLS / 2);
  const row = Math.floor(p.z + ROWS / 2);
  return board?.inside(col, row) ? { col, row } : null;
}

let downAt: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 14) return;
  tap(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  hover = state === 'play' ? cellAt(e.clientX, e.clientY, false) : null;
});
canvas.addEventListener('pointerleave', () => (hover = null));

function tap(x: number, y: number): void {
  unlockAudio();
  if (state !== 'play' || paused) return;
  const c = cellAt(x, y, true);
  if (!c) {
    closeMenu();
    return;
  }
  if (selected && selected.col === c.col && selected.row === c.row) {
    closeMenu();
    return;
  }
  if (towers.has(key(c.col, c.row)) || canBuild(c.col, c.row)) {
    selected = c;
    sfx.click();
    openMenu();
  } else {
    closeMenu();
    if (board!.cell(c.col, c.row) === Cell.Path) ui.toast('Towers go beside the road, not on it', 1400);
  }
}

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (state !== 'play') return;
  const t = selected ? towers.get(key(selected.col, selected.row)) : undefined;
  if (e.code === 'Escape') {
    if (selected) closeMenu();
    else setPaused(!paused);
  } else if (e.code === 'KeyP') setPaused(!paused);
  else if (paused) return;
  else if (e.code === 'KeyN') callWave();
  else if (e.code === 'KeyF') toggleSpeed();
  else if (e.code === 'KeyM') toggleSound();
  else if (selected && !t && /^Digit[123]$/.test(e.code)) buildSelected(TOWER_KINDS[Number(e.code.slice(5)) - 1]!);
  else if (t && e.code === 'KeyU') {
    upgradeTower(t);
    openMenu();
  } else if (t && (e.code === 'KeyS' || e.code === 'Delete' || e.code === 'Backspace')) {
    sellTower(t);
    closeMenu();
  }
});

function toggleSpeed(): void {
  speed = speed === 1 ? 2 : 1;
  sfx.click();
}

function toggleSound(): void {
  unlockAudio();
  setMuted(!muted);
  renderSoundIcon();
}

pauseBtn.addEventListener('click', () => setPaused(true));
soundBtn.addEventListener('click', toggleSound);
speedBtn.addEventListener('click', () => {
  unlockAudio();
  toggleSpeed();
});
nextBtn.addEventListener('click', () => {
  unlockAudio();
  callWave();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});

// ---------------------------------------------------------------- menus

function buildSelected(kind: TowerKind): void {
  if (!selected) return;
  const t = placeTower(selected.col, selected.row, kind);
  if (!t) {
    sfx.denied();
    return;
  }
  t.pop = 0.4;
  closeMenu();
}

/** Build menu on a free tile, upgrade/sell menu on a tower. Rebuilt on every change. */
function openMenu(): void {
  if (!selected) return;
  const t = towers.get(key(selected.col, selected.row));
  menu.replaceChildren();
  previewKind = null;
  if (!t) {
    el('div', 'sg-menu__title', menu).textContent = 'Build tower';
    TOWER_KINDS.forEach((kind, i) => {
      const def = TOWERS[kind];
      const lv = def.levels[0];
      const b = el('button', 'sg-opt', menu);
      b.disabled = gold < lv.cost;
      b.dataset.cost = String(lv.cost);
      b.innerHTML = `<img src="${ASSET_URL}icon-0${def.model}.png" alt="" /><span class="sg-opt__name">${def.name}<small>${def.blurb}</small></span><span class="sg-opt__cost">${lv.cost}◆</span><kbd class="sg-opt__key">${i + 1}</kbd>`;
      b.addEventListener('click', () => buildSelected(kind));
      b.addEventListener('pointerenter', () => (previewKind = kind));
      b.addEventListener('pointerleave', () => (previewKind = null));
    });
  } else {
    const s = stats(t.def, t.level);
    const head = el('div', 'sg-menu__title', menu);
    head.innerHTML = `${t.def.name} <span class="sg-lv sg-lv--${t.level}">Lv ${t.level + 1}</span>`;
    const next = t.level < 2 ? stats(t.def, t.level + 1) : null;
    const row = (label: string, a: number, b?: number): string => `<span>${label}</span><b>${fmt(a)}${b !== undefined ? ` <i>→ ${fmt(b)}</i>` : ''}</b>`;
    const st = el('div', 'sg-stats', menu);
    st.innerHTML =
      row('Damage', s.damage, next?.damage) + row('Rate', s.rate, next?.rate) + row('Range', s.range, next?.range) + (s.splash ? row('Splash', s.splash, next?.splash) : '');
    const btns = el('div', 'sg-menu__row', menu);
    const up = el('button', 'sg-act sg-act--up', btns);
    if (next) {
      up.innerHTML = `Upgrade <b>${next.cost}◆</b>`;
      up.disabled = gold < next.cost;
      up.dataset.cost = String(next.cost);
    } else {
      up.textContent = 'Max level';
      up.disabled = true;
    }
    up.addEventListener('click', () => {
      upgradeTower(t);
      openMenu();
    });
    const sell = el('button', 'sg-act sg-act--sell', btns);
    sell.innerHTML = `Sell <b>+${Math.floor(t.invested * SELL_REFUND)}◆</b>`;
    sell.addEventListener('click', () => {
      sellTower(t);
      closeMenu();
    });
  }
  menu.hidden = false;
  positionMenu();
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function closeMenu(): void {
  selected = null;
  previewKind = null;
  menu.hidden = true;
}

/** Float the menu next to its tile, or dock it above the controls on small screens. */
function positionMenu(): void {
  if (!selected || menu.hidden) return;
  const docked = innerWidth < 640;
  menu.classList.toggle('sg-menu--dock', docked);
  const p = toScreen(cellX(selected.col), 0.4, cellZ(selected.row));
  if (docked) {
    // Docked above the controls, or under the top bar if that would hide the tile.
    menu.style.left = '';
    const h = menu.getBoundingClientRect().height;
    const low = p.y > innerHeight - marginBottom - h - 30;
    menu.style.top = low ? `${marginTop + 6}px` : '';
    menu.style.bottom = low ? '' : `${marginBottom + 6}px`;
    return;
  }
  menu.style.bottom = '';
  const r = menu.getBoundingClientRect();
  let left = p.x + 44;
  if (left + r.width > innerWidth - 8) left = p.x - 44 - r.width;
  const top = Math.min(innerHeight - marginBottom - r.height - 6, Math.max(marginTop + 4, p.y - r.height / 2));
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
}

/** Keep the selector, range ring and menu affordability in sync with the game. */
function updateSelection(): void {
  const cell = selected ?? hover;
  const t = cell ? towers.get(key(cell.col, cell.row)) : undefined;
  if (cell && state === 'play') {
    selector.visible = true;
    selector.position.set(cellX(cell.col), 0.025, cellZ(cell.row));
    const ok = !!t || canBuild(cell.col, cell.row);
    selectorMat.color.setHex(ok ? (selected ? 0xffc93c : 0x39ff88) : 0xff4d4d);
    selectorMat.opacity = selected ? 0.95 : 0.6;
  } else selector.visible = false;
  // Range ring: the selected tower, or the hovered build option.
  let range = 0;
  if (selected && t) range = stats(t.def, t.level).range;
  else if (selected && previewKind) range = TOWERS[previewKind].levels[0].range;
  else if (!selected && hover && t) range = stats(t.def, t.level).range;
  rangeGroup.visible = range > 0 && state === 'play';
  if (rangeGroup.visible && cell) {
    rangeGroup.position.set(cellX(cell.col), 0.03, cellZ(cell.row));
    rangeGroup.scale.setScalar(range);
  }
  if (!menu.hidden) {
    for (const b of menu.querySelectorAll<HTMLButtonElement>('[data-cost]')) b.disabled = gold < Number(b.dataset.cost);
  }
}

function toScreen(x: number, y: number, z: number): { x: number; y: number } {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
}

// ---------------------------------------------------------------- HUD

let floatCount = 0;
function floatText(x: number, y: number, text: string, kind: 'gold' | 'bad'): void {
  if (floatCount > 14) return;
  const f = el('div', `sg-float sg-float--${kind}`, floaters);
  f.textContent = text;
  f.style.left = `${x}px`;
  f.style.top = `${y}px`;
  floatCount++;
  f.addEventListener('animationend', () => {
    f.remove();
    floatCount--;
  });
}

let bannerTimer = 0;
function showBanner(title: string, sub: string, good = false): void {
  banner.innerHTML = `<div class="sg-banner__title">${title}</div><div class="sg-banner__sub">${sub}</div>`;
  banner.classList.toggle('sg-banner--good', good);
  banner.classList.remove('sg-banner--on');
  void banner.offsetWidth; // restart the animation
  banner.classList.add('sg-banner--on');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => banner.classList.remove('sg-banner--on'), 2200);
}

const shown: Record<string, string> = {};
function setHTML(node: HTMLElement, id: string, html: string): void {
  if (shown[id] === html) return;
  shown[id] = html;
  node.innerHTML = html;
}

function updateHud(): void {
  const play = state === 'play' || state === 'over';
  controls.classList.toggle('sg-controls--off', !play); // keep its layout so the camera fit stays put
  setHTML(waveChip, 'wave', `Wave <b>${wave}</b>`);
  setHTML(livesChip, 'lives', `<span class="sg-heart">♥</span> ${lives}`);
  setHTML(goldChip, 'gold', `<span class="sg-gold">◆</span> ${gold}`);
  setHTML(scoreChip, 'score', `★ ${score}`);
  livesChip.classList.toggle('sg-chip--low', lives <= 5);
  setHTML(speedBtn, 'speed', `${speed}×`);
  speedBtn.classList.toggle('sg-btn--on', speed === 2);
  if (nextIn > 0) {
    const bonus = Math.round(nextIn);
    setHTML(nextBtn, 'next', `<span>${wave === 0 ? 'Start' : 'Call'} wave ${wave + 1}</span><small>+${bonus}◆ · ${Math.ceil(nextIn)}s</small>`);
    setHTML(info, 'info', `<b>Next:</b> ${waveSummary(wave + 1)}`);
    nextBtn.disabled = false;
  } else {
    setHTML(nextBtn, 'next', `<span>Wave ${wave}</span><small>incoming…</small>`);
    setHTML(info, 'info', `<b>Kills:</b> ${kills} · <b>On field:</b> ${enemies.length}`);
    nextBtn.disabled = true;
  }
}

// ---------------------------------------------------------------- main loop

let last = performance.now();
let slowFrames = 0;
function frame(now: number): void {
  const raw = (now - last) / 1000;
  const dt = Math.min(raw, 1 / 20);
  last = now;
  // Low-end GPU guard: if frames stay slow, render at a lower resolution.
  if (raw > 0.045 && raw < 0.5) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 90 && maxPixelRatio > 1) {
    maxPixelRatio = 1;
    slowFrames = 0;
    renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));
    resize();
  }
  if (board && !paused && state !== 'loading') {
    const steps = state === 'play' ? speed : 1;
    for (let i = 0; i < steps; i++) update(dt);
  }
  draw();
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
resize();

// Title card with rules and the current leaderboard.
const intro = document.createElement('div');
intro.className = 'sg-intro';
intro.innerHTML =
  '<p>Ghosts and UFOs march on your <b>core</b>. Tap a free tile beside the road to build, tap a tower to <b>upgrade</b> or <b>sell</b> it.</p>' +
  `<div class="sg-intro__towers">${TOWER_KINDS.map((k) => `<span><img src="${ASSET_URL}icon-0${TOWERS[k].model}.png" alt="" />${TOWERS[k].name}<small>${TOWERS[k].blurb}</small></span>`).join('')}</div>` +
  '<p>Boss every 5th wave. Call waves early for bonus gold. Keys: <kbd>1</kbd>–<kbd>3</kbd> build, <kbd>U</kbd> upgrade, <kbd>S</kbd> sell, <kbd>N</kbd> next wave, <kbd>F</kbd> speed.</p>';
void ui.boardInto(intro);
ui.show({ kicker: 'TRONIX ARENA', title: 'Ghost Siege', body: intro, buttons: [{ label: 'Play', primary: true, onClick: start }] });

init().catch((err) => {
  console.error(err);
  ui.toast('Could not load the game assets. Please reload.', 8000);
});

// Test hooks (used by the automated smoke test).
Object.assign(window, {
  __siege: {
    info: () => ({ state, wave, gold, lives, score, kills, nextIn, enemies: enemies.length, towers: towers.size, paused, speed }),
    build: (c: number, r: number, k: TowerKind) => !!placeTower(c, r, k),
    upgrade: (c: number, r: number) => {
      const t = towers.get(key(c, r));
      return !!t && upgradeTower(t);
    },
    sell: (c: number, r: number) => {
      const t = towers.get(key(c, r));
      if (t) sellTower(t);
      return !!t;
    },
    next: callWave,
    step: (sec: number) => {
      for (let i = 0; i < sec * 30 && board; i++) update(1 / 30);
    },
    free: () => {
      const out: [number, number][] = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (canBuild(c, r)) out.push([c, r]);
      return out;
    },
    screen: (c: number, r: number) => toScreen(cellX(c), 0.05, cellZ(r)),
    /** Length of road (cells) within `range` of a cell, for the autopilot. */
    coverage: (c: number, r: number, range: number) => {
      let n = 0;
      const v = new THREE.Vector3();
      for (let d = 0; d < board!.length; d += 0.1) if (board!.sample(d, v) && Math.hypot(v.x - cellX(c), v.z - cellZ(r)) <= range) n += 0.1;
      return n;
    },
  },
});
