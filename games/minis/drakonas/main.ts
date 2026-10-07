/**
 * Drakonas: a vertical-scrolling shoot-'em-up. Fly over endless islands and
 * hills, shred scout formations, fighters, UFOs and mines with an auto-firing
 * cannon, grab power-ups, then take down the Dreadnought at the end of each
 * stage. Stages loop with rising difficulty. Score = kills × combo + bonuses.
 */
import * as THREE from 'three';
import { Keys } from '../shared/input';
import { el, GameUI } from '../shared/ui';
import { ASSETS, loadAssets, type Assets, type Model } from './assets';
import { Ground } from './ground';
import { Sfx } from './sfx';
import { badgeTex, coinTex, glowTex, orbTex, puffTex, ringTex, shadowTex, SpriteBatch, tracerTex } from './sprites';
import './drakonas.css';

// World: planes fly on the y = 0 plane, screen-up is -z. The ground is far below.
const FIELD_H = 74; // minimum visible depth of the playfield
const FIELD_W = 46; // minimum visible width at the bottom edge
const MAX_HW = 40; // play-area half width cap on wide screens
const TILT = 0.36; // camera tilt from straight down (radians)
const GROUND_Y = -70;
const SHADOW_Y = GROUND_Y + 17; // just above the hill tops
const GROUND_SPEED = 26;
const PLAYER_SPEED = 54;
const DRAG_SPEED = 140;
const TOUCH_OFFSET = 11; // ship sits this far above the finger
const PLAYER_R = 1.3;
const MAX_HP = 100;
const INVULN = 1.4;
const FIRE_GAP = 0.1;
const SHOT_SPEED = 135;
const SHOT_R = 0.8; // enemy bullet hit radius
const MAX_SHOTS = 520;
const MAX_PARTS = 700;
const SCORE_CAP = 10_000_000;

type Kind = 'scout' | 'fighter' | 'ufo' | 'mine' | 'boss';
type Drop = 'P' | 'M' | 'H' | 'B' | 'S' | 'C';
/** Cubic Bézier in field units: u ∈ [-1, 1] across, v = 0 top edge … 1 bottom edge. */
type Path = readonly [number, number, number, number, number, number, number, number];

interface Formation {
  left: number;
  killed: number;
}

interface Enemy {
  kind: Kind;
  model: Model;
  mesh: THREE.Mesh;
  x: number;
  z: number;
  hp: number;
  max: number;
  r: number;
  t: number; // age in seconds; negative = still waiting to enter
  life: number; // when it heads off screen
  fire: number;
  fire2: number;
  flash: number;
  path: Path | null;
  dur: number;
  ax: number; // anchor x
  az: number; // anchor z
  seed: number;
  armed: number; // mine fuse
  yaw: number;
  formation: Formation | null;
  dead: boolean;
}

interface Shot {
  x: number;
  z: number;
  vx: number;
  vz: number;
  c: number; // colour index into SHOT_COLORS
}

interface Bullet {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

interface Missile {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  vx: number;
  vz: number;
  t: number;
  target: Enemy | null;
}

interface Pickup {
  kind: Drop;
  x: number;
  z: number;
  t: number;
}

interface Part {
  kind: 0 | 1 | 2; // fire puff, spark, ring
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  rot: number;
}

const KINDS: Record<Kind, { hp: number; r: number; score: number; scale: number }> = {
  scout: { hp: 3, r: 2.3, score: 100, scale: 1.5 },
  fighter: { hp: 11, r: 2.6, score: 250, scale: 1.45 },
  ufo: { hp: 46, r: 3.4, score: 700, scale: 0.9 },
  mine: { hp: 3, r: 1.7, score: 150, scale: 2.8 },
  boss: { hp: 650, r: 9, score: 0, scale: 2.4 },
};

const SHOT_COLORS: [number, number, number][] = [
  [1, 0.22, 0.55], // pink
  [0.2, 0.75, 1], // cyan
  [1, 0.5, 0.08], // orange
];

const PATHS: Path[] = [
  [-0.7, -0.15, -0.7, 0.8, 0.7, 0.8, 0.75, -0.2], // U-turn
  [-0.9, -0.15, -0.3, 0.3, 0.3, 0.6, 0.9, 1.15], // diagonal dive
  [0, -0.15, 0.95, 0.35, -0.95, 0.65, 0, 1.2], // S down the middle
  [-1.3, 0.05, -0.2, 0.12, 0.3, 0.7, 1.3, 0.55], // side sweep
  [-0.35, -0.15, -0.35, 0.6, -1.0, 0.65, -1.35, 0.15], // dive and peel off
];

// Lighting per stage, cycling: day, golden hour, dusk, night.
const SKIES = [
  { fog: 0x9ccbe8, hemi: 0xdff1ff, ground: 0x3d4b2c, sun: 0xffffff, sunI: 2.3, hemiI: 1.35 },
  { fog: 0xe6b48a, hemi: 0xffe2c0, ground: 0x4a3a22, sun: 0xffc98a, sunI: 2.4, hemiI: 1.2 },
  { fog: 0x7a6496, hemi: 0xe0c8ff, ground: 0x2c2440, sun: 0xffa8d8, sunI: 2.0, hemiI: 1.15 },
  { fog: 0x1c2a4a, hemi: 0x9fb8ff, ground: 0x10182c, sun: 0xb8ccff, sunI: 1.7, hemiI: 1.0 },
];

// ---------------------------------------------------------------------------
// UI
const ui = new GameUI('drakonas', 'Drakonas');
const scoreChip = el('div', 'chip', ui.hud);
const stageChip = el('div', 'chip', ui.hud);
const hpChip = el('div', 'chip', ui.hud);
const bombChip = el('div', 'chip', ui.hud);
const muteChip = el('button', 'chip dk-mute', ui.hud);
const hud = el('div', 'dk-hud', document.body);
const hullWrap = el('div', 'dk-hull', hud);
const hullFill = el('div', 'dk-hull__fill', hullWrap);
const hullText = el('div', 'dk-hull__text', hullWrap);
const comboEl = el('div', 'dk-combo', hud);
const bossBar = el('div', 'dk-boss', document.body);
el('div', 'dk-boss__name', bossBar).textContent = 'DREADNOUGHT';
const bossFill = el('div', 'dk-boss__fill', el('div', 'dk-boss__track', bossBar));
const banner = el('div', 'dk-banner', document.body);
const bannerTitle = el('div', 'dk-banner__title', banner);
const bannerSub = el('div', 'dk-banner__sub', banner);
const vignette = el('div', 'dk-vignette', document.body);
const flashEl = el('div', 'dk-flash', document.body);
const bombBtn = el('button', 'dk-bomb', document.body);
hud.hidden = true;
bossBar.hidden = true;
bombBtn.hidden = true;

const sfx = new Sfx(ASSETS);
const keys = new Keys();

// ---------------------------------------------------------------------------
// Scene
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9ccbe8, 150, 420);
scene.background = new THREE.Color(0x9ccbe8);
const camera = new THREE.PerspectiveCamera(50, 1, 1, 900);
const hemi = new THREE.HemisphereLight(0xdff1ff, 0x3d4b2c, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(-40, 100, -30);
scene.add(sun);
const boom = new THREE.PointLight(0xffa04a, 0, 90, 1);
scene.add(boom);

const glow = glowTex();
const shadows = new SpriteBatch(scene, 64, shadowTex(), { additive: false, opacity: 0.32, order: 0 });
const fire = new SpriteBatch(scene, MAX_PARTS, puffTex(), { order: 3 });
const sparks = new SpriteBatch(scene, MAX_PARTS, glow, { order: 3 });
const rings = new SpriteBatch(scene, 48, ringTex(), { order: 3 });
const tracers = new SpriteBatch(scene, 260, tracerTex(), { order: 4 });
const shotGlow = new SpriteBatch(scene, MAX_SHOTS, glow, { order: 9, top: true });
const shotCore = new SpriteBatch(scene, MAX_SHOTS, orbTex(), { order: 10, top: true });
const coinBatch = new SpriteBatch(scene, 64, coinTex(), { additive: false, order: 6 });
const badges = new Map<Drop, SpriteBatch>();

let A: Assets | null = null;
let ground: Ground | null = null;
let player: THREE.Mesh | null = null;
const ready = (async () => {
  await Promise.race([document.fonts.load('700 50px "Chakra Petch"').catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  const looks: [Drop, string, string][] = [
    ['P', '#ff7a1a', 'P'],
    ['M', '#22c8ff', 'M'],
    ['H', '#2fe07a', '+'],
    ['B', '#ff3b5c', 'B'],
    ['S', '#8a7bff', 'S'],
  ];
  for (const [k, color, glyph] of looks) badges.set(k, new SpriteBatch(scene, 12, badgeTex(color, glyph), { additive: false, order: 7 }));
  const [assets] = await Promise.all([loadAssets(), sfx.load()]);
  A = assets;
  ground = new Ground(scene, assets.tiles, GROUND_Y);
  player = new THREE.Mesh(assets.player.geo, assets.player.mat);
  player.scale.setScalar(1.25);
  scene.add(player);
  resize();
})();

// ---------------------------------------------------------------------------
// State
let state: 'title' | 'play' | 'dead' = 'title';
let phase: 'waves' | 'warning' | 'boss' | 'clear' = 'waves';
let paused = false;
let stage = 1;
let stageTime = 0;
let phaseT = 0;
let waveT = 0;
let score = 0;
let combo = 0;
let hp = MAX_HP;
let bombs = 2;
let weapon = 1;
let missiles = 0;
let shield = 0;
let invuln = 0;
let fireT = 0;
let missileT = 0;
let muzzle = 0;
let shake = 0;
let god = false;
let px = 0;
let pz = 20;
let pvx = 0;
let bank = 0;
let t = 0;
let boss: Enemy | null = null;
let bossPhase = 1;

const enemies: Enemy[] = [];
const shots: Shot[] = [];
const bullets: Bullet[] = [];
const rockets: Missile[] = [];
const pickups: Pickup[] = [];
const parts: Part[] = [];
const pools = new Map<Kind, THREE.Mesh[]>();
const rocketPool: THREE.Mesh[] = [];

/** Visible playfield on the y = 0 plane (recomputed on resize). */
const F = { top: -37, bottom: 37, hw: 23, hwTop: 30 };

const mult = (): number => Math.min(8, 1 + Math.floor(combo / 8));
const rateMul = (): number => Math.min(2.2, 1 + 0.15 * (stage - 1));
const hpMul = (): number => 1 + 0.22 * (stage - 1);
const shotSpeed = (): number => 23 + Math.min(stage - 1, 7) * 2;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const fieldX = (u: number): number => u * F.hw;
const fieldZ = (v: number): number => F.top + v * (F.bottom - F.top);

// ---------------------------------------------------------------------------
// Effects

function part(kind: Part['kind'], x: number, z: number, vx: number, vz: number, life: number, size: number, grow: number, r: number, g: number, b: number, y = 2): void {
  if (parts.length >= MAX_PARTS) return;
  parts.push({ kind, x, y, z, vx, vz, life, max: life, size, grow, r, g, b, rot: Math.random() * 6.28 });
}

function explode(x: number, z: number, size: number, y = 2): void {
  const n = Math.round(6 + size * 6);
  part(1, x, z, 0, 0, 0.18, size * 9, size * 10, 1, 0.95, 0.8, y + 1); // flash
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(2, 9) * size;
    part(0, x + Math.cos(a) * size, z + Math.sin(a) * size, Math.cos(a) * s, Math.sin(a) * s, rand(0.45, 0.9), rand(2.5, 4.5) * size, 3 * size, 1, 1, 1, y);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(14, 40) * Math.sqrt(size);
    part(1, x, z, Math.cos(a) * s, Math.sin(a) * s, rand(0.25, 0.55), rand(0.6, 1.2), -0.5, 1, 0.75, 0.3, y + 1);
  }
  part(2, x, z, 0, 0, 0.45, size * 2, size * 30, 1, 0.7, 0.4, y);
  boom.position.set(x, 12, z);
  boom.intensity = Math.max(boom.intensity, 60 * size);
  shake = Math.min(1.2, shake + 0.12 * size);
  sfx.play('explosion-phaser', Math.min(0.55, 0.18 + 0.1 * size), rand(0.85, 1.2), 0.06);
}

function hitSpark(x: number, z: number): void {
  for (let i = 0; i < 2; i++) part(1, x + rand(-0.6, 0.6), z, rand(-12, 12), rand(-4, 10), 0.18, rand(0.8, 1.4), -1, 1, 0.85, 0.4, 3);
}

function showBanner(title: string, sub: string, ms = 2400, warn = false): void {
  bannerTitle.textContent = title;
  bannerSub.textContent = sub;
  banner.classList.toggle('dk-banner--warn', warn);
  banner.classList.remove('dk-banner--on');
  void banner.offsetWidth; // restart the animation
  banner.classList.add('dk-banner--on');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => banner.classList.remove('dk-banner--on'), ms);
}
let bannerTimer = 0;

function pulse(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

// ---------------------------------------------------------------------------
// Enemies

function spawn(kind: Kind, x: number, z: number): Enemy {
  const k = KINDS[kind];
  const alt = stage % 2 === 0;
  const a = A!;
  const model = { scout: alt ? a.scoutAlt : a.scout, ufo: alt ? a.ufoAlt : a.ufo, fighter: a.fighter, mine: a.mine, boss: a.boss }[kind];
  let pool = pools.get(kind);
  if (!pool) pools.set(kind, (pool = []));
  let mesh = pool.pop();
  if (!mesh) {
    mesh = new THREE.Mesh(model.geo, model.mat);
    mesh.scale.setScalar(k.scale);
    scene.add(mesh);
  }
  mesh.material = model.mat;
  mesh.visible = false;
  const hp = kind === 'boss' ? Math.round(k.hp * (1 + 0.45 * (stage - 1))) : Math.ceil(k.hp * hpMul());
  const e: Enemy = { kind, model, mesh, x, z, hp, max: hp, r: k.r, t: 0, life: 1e9, fire: rand(0.8, 2), fire2: 0, flash: 0, path: null, dur: 1, ax: x, az: z, seed: Math.random() * 10, armed: 0, yaw: 0, formation: null, dead: false };
  enemies.push(e);
  return e;
}

function release(e: Enemy): void {
  e.dead = true;
  e.mesh.visible = false;
  pools.get(e.kind)!.push(e.mesh);
}

function scoutFormation(): void {
  const base = PATHS[Math.floor(Math.random() * PATHS.length)]!;
  const flip = Math.random() < 0.5 ? -1 : 1;
  const path = base.map((v, i) => (i % 2 === 0 ? v * flip : v)) as unknown as Path;
  const n = stage >= 3 ? 6 : 5;
  const formation: Formation = { left: n, killed: 0 };
  const dur = Math.max(3.2, 4.6 - 0.15 * (stage - 1));
  for (let i = 0; i < n; i++) {
    const e = spawn('scout', 0, F.top - 10);
    e.path = path;
    e.dur = dur;
    e.t = -i * 0.3;
    e.formation = formation;
    e.fire = Math.random() < 0.25 + 0.12 * stage ? rand(0.6, dur * 0.6) : 1e9;
  }
}

function fighters(): void {
  const n = 1 + (Math.random() < 0.35 + 0.1 * stage ? 1 : 0) + (stage >= 3 && Math.random() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const x = fieldX(n === 1 ? rand(-0.5, 0.5) : -0.6 + (1.2 * i) / (n - 1));
    const e = spawn('fighter', x, F.top - 8);
    e.az = fieldZ(rand(0.12, 0.3));
    e.life = rand(8, 11);
    e.t = -i * 0.4;
    e.fire = rand(1.2, 2);
  }
}

function mines(): void {
  const n = 3 + Math.min(stage, 4);
  for (let i = 0; i < n; i++) {
    const e = spawn('mine', fieldX(rand(-0.9, 0.9)), F.top - 6);
    e.t = -i * 0.45;
  }
}

function ufo(): void {
  const e = spawn('ufo', fieldX(rand(-0.4, 0.4)), F.top - 10);
  e.az = fieldZ(rand(0.2, 0.3));
  e.life = 15;
  e.fire = 2;
}

function spawnBoss(): void {
  const e = spawn('boss', 0, F.top - 30);
  e.az = fieldZ(0.24);
  e.fire = 2.5;
  boss = e;
  bossPhase = 1;
  bossBar.hidden = false;
  phase = 'boss';
}

function spawnWave(): void {
  const alive = (k: Kind): boolean => enemies.some((e) => e.kind === k);
  const s = stageTime;
  const table: [number, () => void][] = [
    [40, scoutFormation],
    [s > 6 ? 26 : 0, fighters],
    [s > 12 ? 15 : 0, mines],
    [s > 18 && !alive('ufo') ? 12 + stage * 2 : 0, ufo],
    [
      stage >= 2 && s > 10 ? 10 : 0,
      () => {
        scoutFormation();
        fighters();
      },
    ],
  ];
  let r = Math.random() * table.reduce((a, [w]) => a + w, 0);
  for (const [w, fn] of table) {
    r -= w;
    if (r <= 0) {
      fn();
      break;
    }
  }
  waveT = Math.max(1.6, 3.7 - 0.35 * (stage - 1)) + rand(0, 1.2);
}

/** Fire one enemy bullet at angle `a` (0 = straight down the screen). */
function shoot(x: number, z: number, a: number, speed: number, c = 0): void {
  if (shots.length >= MAX_SHOTS) return;
  shots.push({ x, z, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, c });
}

const aimAt = (x: number, z: number): number => Math.atan2(px - x, pz - z);

function fan(x: number, z: number, n: number, spread: number, speed: number, c = 0, a0 = aimAt(x, z)): void {
  for (let i = 0; i < n; i++) shoot(x, z, a0 + (n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1)), speed, c);
}

function ring(x: number, z: number, n: number, speed: number, c: number, off = 0): void {
  for (let i = 0; i < n; i++) shoot(x, z, off + (i / n) * Math.PI * 2, speed, c);
}

function bezier(p: Path, s: number): [number, number] {
  const u = 1 - s;
  const a = u * u * u;
  const b = 3 * u * u * s;
  const c = 3 * u * s * s;
  const d = s * s * s;
  return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
}

function updateEnemy(e: Enemy, dt: number): void {
  e.t += dt;
  if (e.t < 0) return;
  const ox = e.x;
  const oz = e.z;
  const sp = shotSpeed();
  const onScreen = e.z > F.top + 2 && e.z < F.bottom - 4;
  let yaw = 0;
  let roll = 0;
  switch (e.kind) {
    case 'scout': {
      const s = e.t / e.dur;
      const [u, v] = bezier(e.path!, Math.min(s, 1.3));
      e.x = fieldX(u);
      e.z = fieldZ(v);
      if (s > 1.25) e.dead = true;
      e.fire -= dt;
      if (e.fire <= 0 && onScreen) {
        e.fire = 1e9;
        fan(e.x, e.z, 1, 0, sp * 0.9);
      }
      yaw = Math.atan2(-(e.x - ox), -(e.z - oz));
      let turn = yaw - e.yaw;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      roll = Math.max(-0.9, Math.min(0.9, (turn / Math.max(dt, 1e-3)) * 0.35));
      break;
    }
    case 'fighter': {
      const enter = Math.min(1, e.t / 1.4);
      const ease = 1 - (1 - enter) ** 3;
      e.ax += (px - e.ax) * 0.25 * dt;
      const strafe = Math.sin(e.t * 0.9 + e.seed) * F.hw * 0.45;
      const tx = Math.max(-F.hw, Math.min(F.hw, e.ax + strafe));
      e.x += (tx - e.x) * Math.min(1, dt * 2.5);
      e.z = F.top - 8 + (e.az - F.top + 8) * ease + Math.max(0, e.t - e.life) ** 2 * 14;
      if (e.z > F.bottom + 10) e.dead = true;
      e.fire -= dt * rateMul();
      if (e.fire <= 0 && onScreen && e.t < e.life) {
        e.fire = rand(1.6, 2.2);
        fan(e.x, e.z + 2, stage >= 3 ? 5 : 3, 0.45, sp);
        sfx.play('weapon-default', 0.06, 0.6, 0.1);
      }
      yaw = Math.atan2(-(px - e.x), -(pz - e.z));
      roll = Math.max(-0.7, Math.min(0.7, -(e.x - ox) / dt / 40));
      break;
    }
    case 'ufo': {
      const enter = Math.min(1, e.t / 2.5);
      const ease = 1 - (1 - enter) ** 2;
      e.x = e.ax + Math.sin(e.t * 0.5 + e.seed) * F.hw * 0.35;
      e.z = F.top - 10 + (e.az - F.top + 10) * ease + Math.sin(e.t * 0.8) * 3;
      if (e.t > e.life) e.az += 9 * dt;
      if (e.z > F.bottom + 12) e.dead = true;
      e.mesh.rotation.y += dt * 1.6;
      yaw = e.mesh.rotation.y;
      if (onScreen && e.t < e.life + 2) {
        e.fire -= dt * rateMul();
        if (e.fire <= 0) {
          e.fire = 2.4;
          e.fire2 = 1.1; // then a spiral stream
          ring(e.x, e.z, Math.min(24, 12 + 2 * stage), sp * 0.75, 1, Math.random());
          sfx.play('weapon-plasma', 0.12, 1.4, 0.2);
        }
        if (e.fire2 > 0) {
          e.fire2 -= dt;
          if (Math.floor(e.fire2 / 0.09) !== Math.floor((e.fire2 + dt) / 0.09)) shoot(e.x, e.z, e.t * 4, sp * 0.85, 1);
        }
      }
      break;
    }
    case 'mine': {
      e.z += (8 + stage) * dt;
      e.x = e.ax + Math.sin(e.t * 1.3 + e.seed) * 5;
      e.mesh.rotation.y += dt * 2;
      yaw = e.mesh.rotation.y;
      if (e.z > F.bottom + 6) e.dead = true;
      const d = Math.hypot(px - e.x, pz - e.z);
      if (!e.armed && d < 11 && state === 'play') e.armed = 0.65;
      if (e.armed) {
        e.armed -= dt;
        e.flash = Math.floor(e.armed * 12) % 2 ? 0.05 : 0;
        if (e.armed <= 0) {
          kill(e, false);
          if (Math.hypot(px - e.x, pz - e.z) < 8) hurt(22);
          ring(e.x, e.z, Math.min(16, 6 + 2 * stage), sp * 0.7, 2, Math.random());
        }
      }
      break;
    }
    case 'boss':
      updateBoss(e, dt);
      return;
  }
  e.yaw = yaw;
  e.mesh.rotation.set(0, yaw, roll);
}

function updateBoss(e: Enemy, dt: number): void {
  const enter = Math.min(1, e.t / 4);
  const ease = 1 - (1 - enter) ** 3;
  const p = e.hp / e.max > 0.66 ? 1 : e.hp / e.max > 0.33 ? 2 : 3;
  if (p !== bossPhase) {
    bossPhase = p;
    explode(e.x - 7, e.z + 2, 1.6);
    explode(e.x + 7, e.z + 2, 1.6);
    showBanner(p === 2 ? 'PHASE 2' : 'FINAL PHASE', 'The Dreadnought is enraged', 1600, true);
    e.fire = 1.2;
  }
  const speed = p === 3 ? 0.75 : 0.45;
  e.ax += speed * dt;
  e.x = Math.sin(e.ax) * F.hw * 0.55;
  e.z = F.top - 30 + (e.az - F.top + 30) * ease + Math.sin(e.t * 0.7) * 2;
  e.mesh.rotation.set(0, Math.PI, Math.sin(e.ax) * -0.12);
  if (enter < 1) return;
  const sp = shotSpeed();
  const r = rateMul();
  e.fire -= dt * r;
  e.fire2 -= dt * r;
  const nose = e.z + 6.5;
  if (p === 1) {
    if (e.fire <= 0) {
      e.fire = 1.4;
      fan(e.x, nose, 5 + Math.min(stage, 4), 0.7, sp, 2);
      sfx.play('weapon-plasma', 0.15, 1.1, 0.2);
    }
    if (e.fire2 <= 0) {
      e.fire2 = 0.22;
      e.seed = -e.seed || 1;
      shoot(e.x + 8 * Math.sign(e.seed), e.z + 3, 0, sp * 1.1, 0);
    }
  } else if (p === 2) {
    if (e.fire2 <= 0) {
      e.fire2 = 0.075;
      e.armed += 0.23;
      shoot(e.x, nose - 2, e.armed, sp * 0.8, 1);
      shoot(e.x, nose - 2, e.armed + Math.PI, sp * 0.8, 1);
    }
    if (e.fire <= 0) {
      e.fire = 2;
      fan(e.x - 8, e.z + 3, 5, 0.5, sp * 1.05, 2);
      fan(e.x + 8, e.z + 3, 5, 0.5, sp * 1.05, 2);
      sfx.play('weapon-plasma', 0.15, 0.9, 0.2);
    }
  } else {
    if (e.fire <= 0) {
      e.fire = 1.5;
      ring(e.x, nose - 2, Math.min(28, 18 + 2 * stage), sp * 0.8, 0, Math.random());
      sfx.play('weapon-plasma', 0.18, 0.75, 0.2);
      if (Math.random() < 0.35) {
        const m = spawn('mine', e.x + rand(-8, 8), e.z + 4);
        m.ax = m.x;
      }
    }
    if (e.fire2 <= 0) {
      e.fire2 = 0.55;
      fan(e.x, nose, 3, 0.25, sp * 1.2, 2);
    }
  }
}

/** Does a point at (x, z) with radius r touch enemy e? The boss has a wing + spine shape. */
function touches(e: Enemy, x: number, z: number, r: number): boolean {
  if (e.kind === 'boss') {
    const dx = Math.abs(x - e.x);
    const dz = z - e.z;
    return (dx < 9 + r && dz > -4 - r && dz < 6.5 + r) || (dx < 3 + r && dz > -19 && dz <= -4);
  }
  const dx = x - e.x;
  const dz = z - e.z;
  return dx * dx + dz * dz < (e.r + r) * (e.r + r);
}

function damage(e: Enemy, dmg: number, x: number, z: number): void {
  if (e.dead || e.t < 0) return;
  if (e.kind === 'boss' && e.t < 3) return; // still arriving
  e.hp -= dmg;
  e.flash = 0.05;
  hitSpark(x, z);
  if (e.hp <= 0) kill(e, true);
}

function kill(e: Enemy, byPlayer: boolean): void {
  if (e.dead) return;
  e.dead = true;
  if (e.kind === 'boss') {
    bossDown(e);
    return;
  }
  explode(e.x, e.z, e.kind === 'ufo' ? 2.2 : e.kind === 'fighter' ? 1.4 : 1);
  if (!byPlayer) return;
  combo++;
  const pts = KINDS[e.kind].score * mult();
  addScore(pts);
  if (combo > 0 && combo % 8 === 0 && mult() > 1) pulse(comboEl, 'dk-combo--pop');
  // Drops
  if (e.kind === 'scout') {
    if (e.formation && ++e.formation.killed === e.formation.left) drop(power(), e.x, e.z);
    else if (Math.random() < 0.08) drop('C', e.x, e.z);
  } else if (e.kind === 'fighter') {
    if (Math.random() < 0.15) drop(power(), e.x, e.z);
    else if (Math.random() < 0.7) for (let i = 0; i < 2; i++) drop('C', e.x + rand(-2, 2), e.z + rand(-2, 2));
  } else if (e.kind === 'ufo') {
    drop(power(), e.x, e.z);
    for (let i = 0; i < 4; i++) drop('C', e.x + rand(-4, 4), e.z + rand(-4, 4));
  } else if (e.kind === 'mine' && Math.random() < 0.3) drop('C', e.x, e.z);
}

function bossDown(e: Enemy): void {
  const bonus = 10_000 * stage;
  addScore(bonus);
  phase = 'clear';
  phaseT = 0;
  bossBar.hidden = true;
  boss = null;
  shots.length = 0;
  // A chain of explosions along the hull, then the big one.
  for (let i = 0; i < 9; i++) {
    setTimeout(() => {
      if (state === 'play') explode(e.x + rand(-9, 9), e.z + rand(-16, 6), rand(1.4, 2.4));
    }, i * 140);
  }
  setTimeout(() => {
    e.mesh.visible = false;
    pools.get('boss')!.push(e.mesh);
    if (state !== 'play') return;
    explode(e.x, e.z, 4.5);
    shake = 1.4;
    drop('P', e.x - 5, e.z);
    drop('H', e.x + 5, e.z);
    drop(Math.random() < 0.5 ? 'M' : 'B', e.x, e.z + 4);
    for (let i = 0; i < 12; i++) drop('C', e.x + rand(-10, 10), e.z + rand(-8, 8));
  }, 1300);
  showBanner(`STAGE ${stage} CLEAR`, `Dreadnought down · +${bonus.toLocaleString('en-US')}`, 3600);
}

/** Pick a power-up, favouring what the player is missing. */
function power(): Drop {
  const w: [Drop, number][] = [
    ['P', weapon < 4 ? 46 : 12],
    ['M', missiles < 3 ? 22 : 6],
    ['H', hp < 60 ? 26 : 10],
    ['B', bombs < 3 ? 12 : 5],
    ['S', 6],
  ];
  let r = Math.random() * w.reduce((a, [, n]) => a + n, 0);
  for (const [k, n] of w) if ((r -= n) <= 0) return k;
  return 'P';
}

function drop(kind: Drop, x: number, z: number): void {
  if (pickups.length < 60) pickups.push({ kind, x, z, t: 0 });
}

function addScore(n: number): void {
  score = Math.min(SCORE_CAP, score + n);
}

// ---------------------------------------------------------------------------
// Player

function hurt(dmg: number): void {
  if (state !== 'play' || god || invuln > 0) return;
  if (shield > 0) {
    shield = Math.max(0, shield - 2.5);
    part(2, px, pz, 0, 0, 0.3, 4, 30, 0.5, 0.45, 1);
    return;
  }
  hp = Math.max(0, hp - dmg);
  invuln = INVULN;
  combo = 0;
  shake = Math.min(1.2, shake + 0.6);
  pulse(vignette, 'dk-vignette--on');
  sfx.hit();
  for (let i = 0; i < 10; i++) part(1, px, pz, rand(-25, 25), rand(-25, 25), 0.35, 1.2, -1, 1, 0.5, 0.2, 3);
  if (hp <= 0) die();
}

function die(): void {
  state = 'dead';
  explode(px, pz, 3);
  sfx.play('dieing-player', 0.7, 1, 0);
  for (let i = 1; i < 5; i++) setTimeout(() => explode(px + rand(-4, 4), pz + rand(-4, 4), 1.6), i * 160);
  if (player) player.visible = false;
  bossBar.hidden = true;
  bombBtn.hidden = true;
  setTimeout(() => {
    hud.hidden = true;
    void ui.gameOver(score, { title: stage > 1 ? `Fell on stage ${stage}` : 'Shot down!', unit: 'points', onRetry: () => void start() });
  }, 1800);
}

function bomb(): void {
  if (state !== 'play' || paused || bombs <= 0) return;
  bombs--;
  pulse(bombChip, 'dk-pop');
  for (let i = 0; i < Math.min(shots.length, 80); i++) {
    const s = shots[Math.floor(Math.random() * shots.length)]!;
    part(1, s.x, s.z, 0, 0, 0.3, 2, 2, 0.6, 0.8, 1);
  }
  shots.length = 0;
  for (const e of enemies) {
    if (e.dead || e.t < 0 || e.z < F.top - 4) continue;
    if (e.kind === 'boss') damage(e, Math.ceil(e.max * 0.06), e.x, e.z + 4);
    else damage(e, 40, e.x, e.z);
  }
  part(2, px, pz, 0, 0, 0.7, 6, 160, 0.7, 0.85, 1);
  part(2, px, pz, 0, 0, 0.9, 4, 110, 1, 0.6, 0.3);
  explode(px, pz - 10, 2);
  invuln = Math.max(invuln, 1);
  shake = 1.2;
  pulse(flashEl, 'dk-flash--on');
  sfx.play('weapon-plasma', 0.6, 0.6, 0);
}

function collect(p: Pickup): void {
  const m = mult();
  switch (p.kind) {
    case 'C':
      addScore(50 * m);
      sfx.coin();
      return;
    case 'P':
      if (weapon < 4) {
        weapon++;
        ui.toast(`Spread cannon level ${weapon}`, 1400);
      } else addScore(2000 * m);
      break;
    case 'M':
      if (missiles < 3) {
        missiles++;
        ui.toast(`Homing missiles ×${missiles}`, 1400);
      } else addScore(2000 * m);
      break;
    case 'H':
      hp = Math.min(MAX_HP, hp + 30);
      ui.toast('Hull repaired +30', 1200);
      break;
    case 'B':
      if (bombs < 5) bombs++;
      else addScore(2000 * m);
      pulse(bombChip, 'dk-pop');
      break;
    case 'S':
      shield = 10;
      ui.toast('Shield up!', 1200);
      break;
  }
  part(2, p.x, p.z, 0, 0, 0.35, 3, 30, 1, 1, 1);
  sfx.pickup();
}

function fireGuns(): void {
  const guns: [number, number][] =
    weapon === 1
      ? [
          [-0.7, 0],
          [0.7, 0],
        ]
      : weapon === 2
        ? [
            [-0.7, 0],
            [0.7, 0],
            [-1.3, -0.12],
            [1.3, 0.12],
          ]
        : weapon === 3
          ? [
              [-0.9, 0],
              [0, 0],
              [0.9, 0],
              [-1.4, -0.11],
              [1.4, 0.11],
            ]
          : [
              [-0.9, 0],
              [0, 0],
              [0.9, 0],
              [-1.4, -0.1],
              [1.4, 0.1],
              [-1.7, -0.22],
              [1.7, 0.22],
            ];
  for (const [ox, a] of guns) bullets.push({ x: px + ox, z: pz - 3.5, vx: Math.sin(a) * SHOT_SPEED, vz: -Math.cos(a) * SHOT_SPEED });
  muzzle = 0.05;
  sfx.play('weapon-default', 0.07, rand(0.92, 1.08), 0.08);
}

function launchMissiles(): void {
  for (let i = 0; i < missiles; i++) {
    let mesh = rocketPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(A!.missile.geo, A!.missile.mat);
      mesh.scale.setScalar(5);
      scene.add(mesh);
    }
    mesh.visible = true;
    const side = i % 2 ? 1 : -1;
    rockets.push({ mesh, x: px + side * 1.8, z: pz, vx: side * rand(18, 28), vz: rand(-10, 0), t: 0, target: null });
  }
  if (missiles) sfx.play('weapon-plasma', 0.08, 1.8, 0.2);
}

function nearestEnemy(x: number, z: number): Enemy | null {
  let best: Enemy | null = null;
  let bd = Infinity;
  for (const e of enemies) {
    if (e.dead || e.t < 0 || e.z < F.top - 2 || e.z > F.bottom) continue;
    const d = (e.x - x) ** 2 + (e.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Input: keyboard, mouse / touch drag

let dragId: number | null = null;
let dragX = 0;
let dragZ = 0;
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane0 = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmp = new THREE.Vector3();

function toWorld(cx: number, cy: number, planeY = 0): THREE.Vector3 | null {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  plane0.constant = -planeY;
  return ray.ray.intersectPlane(plane0, tmp);
}

canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play' || paused) return;
  e.preventDefault();
  dragId = e.pointerId;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // synthetic pointer
  }
  aim(e);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === dragId) aim(e);
});
const endDrag = (e: PointerEvent): void => {
  if (e.pointerId === dragId) dragId = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function aim(e: PointerEvent): void {
  const w = toWorld(e.clientX, e.clientY);
  if (!w) return;
  dragX = w.x;
  dragZ = w.z - (e.pointerType === 'mouse' ? 0 : TOUCH_OFFSET);
}

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyB') bomb();
  else if (e.code === 'KeyM') toggleMute();
  else if ((e.code === 'Escape' || e.code === 'KeyP') && state === 'play') {
    if (paused) resume();
    else pause();
  }
});

bombBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  bomb();
});

function toggleMute(): void {
  sfx.setMuted(!sfx.muted);
  muteChip.textContent = sfx.muted ? 'Sound off' : 'Sound on';
  muteChip.classList.toggle('dk-mute--off', sfx.muted);
}
muteChip.addEventListener('click', toggleMute);
muteChip.textContent = sfx.muted ? 'Sound off' : 'Sound on';
muteChip.classList.toggle('dk-mute--off', sfx.muted);

function pause(): void {
  if (paused || state !== 'play') return;
  paused = true;
  dragId = null;
  sfx.suspend();
  ui.show({ kicker: 'PAUSED', title: 'Drakonas', body: controlsHtml(), buttons: [{ label: 'Resume', primary: true, onClick: resume }] });
}

function resume(): void {
  if (!paused) return;
  paused = false;
  ui.hide();
  sfx.resume();
  last = performance.now();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// ---------------------------------------------------------------------------
// Game flow

async function start(): Promise<void> {
  await ready;
  for (const e of enemies) release(e);
  enemies.length = 0;
  for (const r of rockets) {
    r.mesh.visible = false;
    rocketPool.push(r.mesh);
  }
  rockets.length = 0;
  shots.length = 0;
  bullets.length = 0;
  pickups.length = 0;
  parts.length = 0;
  stage = 1;
  score = 0;
  combo = 0;
  hp = MAX_HP;
  bombs = 2;
  weapon = 1;
  missiles = 0;
  shield = 0;
  invuln = 2;
  px = 0;
  pz = fieldZ(0.82);
  dragId = null;
  boss = null;
  paused = false;
  if (player) player.visible = true;
  state = 'play';
  ui.hide();
  hud.hidden = false;
  bombBtn.hidden = false;
  beginStage();
}

function beginStage(): void {
  phase = 'waves';
  stageTime = 0;
  waveT = 1.5;
  bossBar.hidden = true;
  applySky();
  showBanner(`STAGE ${stage}`, stage === 1 ? 'Clear the skies' : `Threat level ${stage}`, 2400);
}

function applySky(): void {
  const s = SKIES[(stage - 1) % SKIES.length]!;
  (scene.fog as THREE.Fog).color.setHex(s.fog);
  (scene.background as THREE.Color).setHex(s.fog);
  hemi.color.setHex(s.hemi);
  hemi.groundColor.setHex(s.ground);
  hemi.intensity = s.hemiI;
  sun.color.setHex(s.sun);
  sun.intensity = s.sunI;
}

function update(dt: number): void {
  t += dt;
  ground?.update(GROUND_SPEED * dt);
  shake = Math.max(0, shake - dt * 2.2);
  boom.intensity *= Math.exp(-dt * 9);

  if (state === 'title') {
    px = Math.sin(t * 0.7) * 6;
    pz = fieldZ(0.72) + Math.sin(t * 1.3) * 1.5;
    bank = Math.cos(t * 0.7) * -0.35;
  }

  if (state === 'play') updatePlayer(dt);
  if (state === 'play') updateFlow(dt);

  // Enemies
  for (const e of enemies) {
    if (!e.dead) updateEnemy(e, dt);
    if (e.flash > 0) e.flash -= dt;
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i]!;
    if (e.dead) {
      if (e.kind !== 'boss') release(e);
      enemies.splice(i, 1);
    }
  }

  // Player bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]!;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    let hit = b.z < F.top - 12 || Math.abs(b.x) > F.hwTop + 10;
    if (!hit) {
      for (const e of enemies) {
        if (!e.dead && e.t >= 0 && touches(e, b.x, b.z, 0.6)) {
          damage(e, 1, b.x, b.z);
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      bullets[i] = bullets[bullets.length - 1]!;
      bullets.pop();
    }
  }

  // Homing missiles
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i]!;
    r.t += dt;
    if (!r.target || r.target.dead) r.target = nearestEnemy(r.x, r.z);
    const speed = Math.min(95, 30 + r.t * 140);
    let want = Math.atan2(r.vx, r.vz);
    if (r.target && r.t > 0.12) want = Math.atan2(r.target.x - r.x, r.target.z + (r.target.kind === 'boss' ? 3 : 0) - r.z);
    else if (r.t > 0.12) want = Math.PI;
    let cur = Math.atan2(r.vx, r.vz);
    let d = want - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    cur += Math.max(-7 * dt, Math.min(7 * dt, d));
    r.vx = Math.sin(cur) * speed;
    r.vz = Math.cos(cur) * speed;
    r.x += r.vx * dt;
    r.z += r.vz * dt;
    r.mesh.position.set(r.x, 0.5, r.z);
    r.mesh.rotation.set(0, cur, 0);
    if (Math.random() < 0.7) part(0, r.x - Math.sin(cur) * 2, r.z - Math.cos(cur) * 2, 0, 0, 0.3, 1.1, 2, 0.9, 0.9, 1, 0.5);
    let gone = r.t > 3 || r.z < F.top - 15 || r.z > F.bottom + 10;
    for (const e of enemies) {
      if (!gone && !e.dead && e.t >= 0 && touches(e, r.x, r.z, 0.8)) {
        damage(e, 5, r.x, r.z);
        part(0, r.x, r.z, 0, 0, 0.3, 3, 8, 1, 0.8, 0.5);
        gone = true;
      }
    }
    if (gone) {
      r.mesh.visible = false;
      rocketPool.push(r.mesh);
      rockets[i] = rockets[rockets.length - 1]!;
      rockets.pop();
    }
  }

  // Enemy bullets
  const playing = state === 'play';
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]!;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    let gone = s.z > F.bottom + 6 || s.z < F.top - 40 || Math.abs(s.x) > F.hwTop + 8;
    if (!gone && playing) {
      const dx = s.x - px;
      const dz = s.z - pz;
      if (dx * dx + dz * dz < (PLAYER_R + SHOT_R) ** 2) {
        if (invuln <= 0 || shield > 0) {
          hurt(10);
          gone = true;
        }
      }
    }
    if (gone) {
      shots[i] = shots[shots.length - 1]!;
      shots.pop();
    }
  }

  // Pickups drift down and are pulled toward the ship when close.
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]!;
    p.t += dt;
    const dx = px - p.x;
    const dz = pz - p.z;
    const d = Math.hypot(dx, dz);
    const pull = p.kind === 'C' ? 18 : 11;
    if (playing && d < pull && p.t > 0.3) {
      const s = (1 - d / pull) * 120 + 20;
      p.x += (dx / d) * s * dt;
      p.z += (dz / d) * s * dt;
    } else {
      p.z += (p.t < 0.5 ? -6 : 9) * dt;
      p.x += Math.sin(p.t * 2 + i) * 4 * dt;
    }
    if (playing && d < 3.4) {
      collect(p);
      pickups.splice(i, 1);
    } else if (p.z > F.bottom + 6) pickups.splice(i, 1);
  }

  // Particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    p.life -= dt;
    if (p.life <= 0) {
      parts[i] = parts[parts.length - 1]!;
      parts.pop();
      continue;
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt + (p.kind === 0 ? GROUND_SPEED * 0.15 * dt : 0);
    p.vx *= 1 - 2.5 * dt;
    p.vz *= 1 - 2.5 * dt;
    p.size = Math.max(0.05, p.size + p.grow * dt);
  }

}

function updatePlayer(dt: number): void {
  invuln = Math.max(0, invuln - dt);
  shield = Math.max(0, shield - dt);
  const ox = px;
  const k = keys.axis();
  px += k.x * PLAYER_SPEED * dt;
  pz += k.y * PLAYER_SPEED * dt;
  if (dragId !== null) {
    const dx = dragX - px;
    const dz = dragZ - pz;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, DRAG_SPEED * dt);
    if (d > 0.01) {
      px += (dx / d) * step;
      pz += (dz / d) * step;
    }
  }
  px = Math.max(-F.hw, Math.min(F.hw, px));
  pz = Math.max(fieldZ(0.3), Math.min(F.bottom - 4, pz));
  pvx += ((px - ox) / Math.max(dt, 1e-3) - pvx) * Math.min(1, dt * 10);
  bank = Math.max(-0.75, Math.min(0.75, -pvx / 70));

  fireT -= dt;
  while (fireT <= 0) {
    fireGuns();
    fireT += FIRE_GAP;
  }
  missileT -= dt;
  if (missileT <= 0) {
    missileT = 0.75;
    launchMissiles();
  }
  muzzle = Math.max(0, muzzle - dt);

  // Ramming hurts both.
  for (const e of enemies) {
    if (!e.dead && e.t >= 0 && touches(e, px, pz, PLAYER_R)) {
      hurt(e.kind === 'boss' ? 25 : 20);
      if (e.kind !== 'boss') damage(e, 10, e.x, e.z);
    }
  }
}

function updateFlow(dt: number): void {
  stageTime += dt;
  phaseT += dt;
  if (phase === 'waves') {
    waveT -= dt;
    if (waveT <= 0) spawnWave();
    if (stageTime > 52 + Math.min(stage, 5) * 6) {
      phase = 'warning';
      phaseT = 0;
      showBanner('WARNING', 'Dreadnought approaching', 3000, true);
      sfx.warning();
    }
  } else if (phase === 'warning') {
    if ((phaseT > 3.2 && enemies.every((e) => e.kind === 'boss')) || phaseT > 8) spawnBoss();
  } else if (phase === 'boss') {
    if (boss) bossFill.style.width = `${Math.max(0, (boss.hp / boss.max) * 100)}%`;
  } else if (phase === 'clear' && phaseT > 5) {
    stage++;
    hp = Math.min(MAX_HP, hp + 25);
    beginStage();
  }
}

// ---------------------------------------------------------------------------
// Drawing

function draw(): void {
  // Ships
  if (player) {
    player.position.set(px, 0, pz);
    player.rotation.set(0, Math.PI, bank);
    if (state === 'play') player.visible = invuln <= 0 || Math.floor(t * 16) % 2 === 0;
  }
  for (const e of enemies) {
    if (e.dead) continue;
    e.mesh.visible = e.t >= 0;
    e.mesh.position.set(e.x, 0, e.z);
    e.mesh.material = e.flash > 0 ? e.model.flash : e.model.mat;
  }

  shadows.begin();
  const showShip = player?.visible && state !== 'dead';
  if (showShip) shadows.add(px + 6, SHADOW_Y, pz + 2, 7, 8);
  for (const e of enemies) if (!e.dead && e.t >= 0) shadows.add(e.x + 6, SHADOW_Y, e.z + 2, e.kind === 'boss' ? 26 : e.r * 3, e.kind === 'boss' ? 40 : e.r * 3.2);
  shadows.end();

  tracers.begin();
  for (const b of bullets) tracers.add(b.x, 1, b.z, 0.9, 4.2, Math.atan2(b.vx, b.vz), 1, 0.85, 0.35);
  if (showShip && state === 'play') {
    // Engine glow and muzzle flashes.
    const f = 0.8 + Math.random() * 0.4;
    tracers.add(px - 0.55, 0.5, pz + 3.7, 1.1 * f, 3.2 * f, 0, 0.4, 0.7, 1);
    tracers.add(px + 0.55, 0.5, pz + 3.7, 1.1 * f, 3.2 * f, 0, 0.4, 0.7, 1);
    if (muzzle > 0) {
      tracers.add(px - 0.7, 1.2, pz - 3.8, 1.8, 3, 0, 1, 0.8, 0.4);
      tracers.add(px + 0.7, 1.2, pz - 3.8, 1.8, 3, 0, 1, 0.8, 0.4);
    }
  } else if (state === 'title' && player) {
    const f = 0.8 + Math.random() * 0.4;
    tracers.add(px - 0.55, 0.5, pz + 3.7, 1.1 * f, 3.2 * f, 0, 0.4, 0.7, 1);
    tracers.add(px + 0.55, 0.5, pz + 3.7, 1.1 * f, 3.2 * f, 0, 0.4, 0.7, 1);
  }
  tracers.end();

  shotGlow.begin();
  shotCore.begin();
  const pulseS = 1 + Math.sin(t * 20) * 0.12;
  for (const s of shots) {
    const [r, g, b] = SHOT_COLORS[s.c]!;
    shotGlow.add(s.x, 3, s.z, 4.2 * pulseS, 4.2 * pulseS, 0, r, g, b);
    shotCore.add(s.x, 3.1, s.z, 1.5, 1.5, 0, 1, 0.92 + 0.08 * g, 0.92 + 0.08 * b);
  }
  // Mines about to blow get a warning glow.
  for (const e of enemies) if (e.kind === 'mine' && e.armed > 0 && !e.dead) shotGlow.add(e.x, 2, e.z, 9, 9, 0, 1, 0.1, 0.05);
  shotGlow.end();
  shotCore.end();

  fire.begin();
  sparks.begin();
  rings.begin();
  for (const p of parts) {
    const f = p.life / p.max;
    if (p.kind === 0) {
      // white-hot → orange → dark red
      const r = f > 0.6 ? 1 : 0.35 + f;
      const g = f > 0.6 ? 0.55 + (f - 0.6) * 1.1 : f * 0.9;
      const b = f > 0.7 ? (f - 0.7) * 2 : 0.04;
      fire.add(p.x, p.y, p.z, p.size, p.size, p.rot, r * p.r * f * 1.4, g * p.g * f * 1.4, b * p.b * f * 1.4);
    } else if (p.kind === 1) sparks.add(p.x, p.y, p.z, p.size, p.size, 0, p.r * f, p.g * f, p.b * f);
    else rings.add(p.x, p.y, p.z, p.size, p.size, 0, p.r * f, p.g * f, p.b * f);
  }
  if (shield > 0 && state === 'play') {
    const a = shield < 2 ? (Math.floor(t * 10) % 2 ? 0.3 : 0.8) : 0.8;
    rings.add(px, 1, pz, 9 + Math.sin(t * 8) * 0.4, 9 + Math.sin(t * 8) * 0.4, 0, 0.45 * a, 0.5 * a, 1 * a);
  }
  fire.end();
  sparks.end();
  rings.end();

  coinBatch.begin();
  for (const b of badges.values()) b.begin();
  for (const p of pickups) {
    if (p.kind === 'C') coinBatch.add(p.x, 2, p.z, 2.6 * Math.abs(Math.cos(p.t * 5)) + 0.3, 2.6);
    else badges.get(p.kind)?.add(p.x, 2, p.z, 4.6 + Math.sin(p.t * 6) * 0.3, 4.6 + Math.sin(p.t * 6) * 0.3);
  }
  coinBatch.end();
  for (const b of badges.values()) b.end();

  // Camera with shake.
  camera.position.copy(camBase);
  if (shake > 0) camera.position.add(tmp.set((Math.random() - 0.5) * shake * 2.4, 0, (Math.random() - 0.5) * shake * 2.4));
  camera.lookAt(camLook.set(camera.position.x - camBase.x, 0, camera.position.z - camBase.z));
}
const camBase = new THREE.Vector3();
const camLook = new THREE.Vector3();

function updateHud(): void {
  scoreChip.textContent = `★ ${score.toLocaleString('en-US')}`;
  stageChip.textContent = `Stage ${stage}`;
  hpChip.textContent = `HP ${Math.ceil(hp)}`;
  hpChip.classList.toggle('dk-low', hp <= 30 && state === 'play');
  bombChip.textContent = `Bombs ${bombs}`;
  bombBtn.textContent = `BOMB ${bombs}`;
  bombBtn.disabled = bombs <= 0;
  hullFill.style.width = `${hp}%`;
  hullFill.classList.toggle('dk-hull__fill--low', hp <= 30);
  hullText.textContent = shield > 0 ? `SHIELD ${Math.ceil(shield)}s` : `HULL ${Math.ceil(hp)}%`;
  hullWrap.classList.toggle('dk-hull--shield', shield > 0);
  const m = mult();
  comboEl.textContent = combo >= 3 ? `×${m} · ${combo} chain` : '';
  comboEl.classList.toggle('dk-combo--hot', m >= 4);
}

// ---------------------------------------------------------------------------
// Layout

function placeCamera(d: number): void {
  camBase.set(0, Math.cos(TILT) * d, Math.sin(TILT) * d);
  camera.position.copy(camBase);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
}

function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = 50;
  camera.updateProjectionMatrix();
  // Fit the playfield: measure at a reference distance, then scale (everything is linear in d).
  placeCamera(100);
  const corner = (x: number, y: number, py: number): THREE.Vector3 => {
    ndc.set(x, y);
    ray.setFromCamera(ndc, camera);
    plane0.constant = -py;
    return ray.ray.intersectPlane(plane0, new THREE.Vector3()) ?? new THREE.Vector3(0, 0, -300);
  };
  const top = corner(0, 1, 0).z;
  const bottom = corner(0, -1, 0).z;
  const hwBottom = corner(1, -1, 0).x;
  const hwTop = corner(1, 1, 0).x;
  const k = Math.max(FIELD_H / (bottom - top), FIELD_W / (2 * hwBottom));
  const d = 100 * k;
  placeCamera(d);
  F.top = top * k;
  F.bottom = bottom * k;
  F.hwTop = hwTop * k;
  F.hw = Math.min(hwBottom * k - 2.5, MAX_HW);
  const fog = scene.fog as THREE.Fog;
  fog.near = d + 60;
  fog.far = d + 330;
  camera.far = d + 600;
  camera.updateProjectionMatrix();
  if (ground) ground.cover(corner(0, 1, GROUND_Y).z - 60, corner(0, -1, GROUND_Y).z + 40);
  if (state === 'title') pz = fieldZ(0.72);
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  if (!paused) {
    update(dt);
    draw();
    updateHud();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Title card

function controlsHtml(): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML =
    '<p><kbd>WASD</kbd>/<kbd>←↑↓→</kbd> or drag to fly. Your guns fire on their own. <kbd>Space</kbd>/<kbd>Shift</kbd> drops a <b>bomb</b> that clears every bullet.</p>' +
    '<p>Grab <b style="color:#ff9a3c">P</b> spread, <b style="color:#3fd2ff">M</b> missiles, <b style="color:#3fe08a">+</b> repairs, <b style="color:#ff5a72">B</b> bombs and <b style="color:#a99bff">S</b> shields. Chain kills without getting hit for up to <b>×8</b> points.</p>';
  return d;
}

const intro = controlsHtml();
void ui.boardInto(intro);
ui.show({ kicker: 'TRONIX ARENA', title: 'Drakonas', body: intro, buttons: [{ label: 'Take off', primary: true, onClick: () => void start() }] });

// Test hook for automated checks.
Object.assign(window, {
  __drakonas: {
    state: () => ({
      state,
      phase,
      stage,
      score,
      hp,
      bombs,
      weapon,
      missiles,
      shield,
      combo,
      px,
      pz,
      enemies: enemies.map((e) => e.kind),
      shots: shots.length,
      pickups: pickups.map((p) => p.kind),
      boss: boss ? { hp: boss.hp, max: boss.max, phase: bossPhase } : null,
      field: { ...F },
    }),
    boss: () => {
      stageTime = 1e4;
    },
    god: (on = true) => (god = on),
    power: (k: Drop) => collect({ kind: k, x: px, z: pz, t: 0 }),
    hurt: (n: number) => {
      invuln = 0;
      hurt(n);
    },
    hitBoss: (frac: number) => boss && damage(boss, Math.ceil(boss.max * frac), boss.x, boss.z),
    bomb,
  },
});
