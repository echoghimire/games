/**
 * Paint Clash: 90-second rounds, up to 4 painters. Every tile you roll over
 * turns your colour; grab paint bombs to splash a big area. Most tiles wins.
 *
 * Solo: you against 3 bots (score = tiles painted, on the leaderboard).
 * Online: the host's browser runs the round (bots, bombs, timer); each player
 * moves their own painter and everyone paints locally, with the host sending
 * the full board every second to keep everyone identical.
 */
import * as THREE from 'three';
import { isTouch, Keys, Stick } from '../shared/input';
import { inviteCode, Lobby } from '../shared/lobby';
import type { Player, RoomMessage } from '../shared/room';
import { el, esc, GameUI } from '../shared/ui';

const N = 28; // board is N x N tiles
const ROUND = 90;
const SPEED = 6.2; // tiles per second
const BOMB_RADIUS = 2.6;
const COLORS = ['#ff5a1f', '#22d3ee', '#a3e635', '#f472b6'];
const NAMES = ['Ember', 'Frost', 'Lime', 'Rose'];

interface Painter {
  slot: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bot: boolean;
  human: boolean; // controlled by a person (local or remote)
  target?: { x: number; y: number; at: number };
  mesh: THREE.Group;
}

const ui = new GameUI('paint', 'Paint Clash');
const timeChip = el('div', 'chip', ui.hud);
const scoreChips = COLORS.map((c) => {
  const chip = el('div', 'chip', ui.hud);
  chip.style.borderColor = c;
  chip.hidden = true;
  return chip;
});
const keys = new Keys();
const stick = isTouch() ? new Stick(document.body) : null;
if (stick) stick.root.hidden = true;

// ---------------------------------------------------------------- scene
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b14);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(10, 30, 14);
scene.add(sun);

// The board is one plane with a pixel texture: one texel per tile (cheap on any device).
const grid = new Uint8Array(N * N).fill(255); // 255 = unpainted, else slot
const texData = new Uint8Array(N * N * 4);
const tex = new THREE.DataTexture(texData, N, N);
tex.magFilter = THREE.NearestFilter;
tex.colorSpace = THREE.SRGBColorSpace;
const board = new THREE.Mesh(new THREE.PlaneGeometry(N, N), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
board.rotation.x = -Math.PI / 2;
board.position.set(N / 2, 0, N / 2);
scene.add(board);
const lines: THREE.Vector3[] = [];
for (let i = 0; i <= N; i++) {
  lines.push(new THREE.Vector3(i, 0.01, 0), new THREE.Vector3(i, 0.01, N), new THREE.Vector3(0, 0.01, i), new THREE.Vector3(N, 0.01, i));
}
scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })));
const wallMat = new THREE.MeshStandardMaterial({ color: 0x1d1b2e });
for (const [x, z, w, d] of [
  [N / 2, -0.25, N + 1, 0.5],
  [N / 2, N + 0.25, N + 1, 0.5],
  [-0.25, N / 2, 0.5, N + 1],
  [N + 0.25, N / 2, 0.5, N + 1],
] as const) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), wallMat);
  wall.position.set(x, 0.3, z);
  scene.add(wall);
}
const rgb = COLORS.map((c) => new THREE.Color(c).convertSRGBToLinear());
const rgb8 = COLORS.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
function paintTexel(i: number): void {
  const v = grid[i]!;
  const [r, g, b] = v === 255 ? [42, 40, 60] : rgb8[v]!;
  // checker tint so empty tiles read as a board
  const shade = v === 255 && ((i % N) + Math.floor(i / N)) % 2 ? 8 : 0;
  texData.set([r! + shade, g! + shade, b! + shade, 255], i * 4);
}
function redrawBoard(): void {
  for (let i = 0; i < N * N; i++) paintTexel(i);
  tex.needsUpdate = true;
}

function painterMesh(slot: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), new THREE.MeshStandardMaterial({ color: COLORS[slot], roughness: 0.3, emissive: rgb[slot]!, emissiveIntensity: 0.15 }));
  body.position.y = 0.45;
  body.scale.set(1, 0.9, 1);
  g.add(body);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.position.set(side * 0.15, 0.6, 0.33);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    pupil.position.set(0, 0, 0.06);
    eye.add(pupil);
    g.add(eye);
  }
  scene.add(g);
  return g;
}

const bombGeo = new THREE.SphereGeometry(0.32, 16, 12);
const bombMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffc93c, emissiveIntensity: 0.8 });
const bombMesh = new THREE.Mesh(bombGeo, bombMat);
bombMesh.visible = false;
scene.add(bombMesh);

// ---------------------------------------------------------------- state
let painters: Painter[] = [];
let mySlot = 0;
let mode: 'menu' | 'solo' | 'online' = 'menu';
let running = false;
let timeLeft = ROUND;
let bomb: { x: number; y: number } | null = null;
let bombIn = 4;
let lastSentPos = 0;
let lastState = 0;
let lastGrid = 0;

function spawnPoint(slot: number): { x: number; y: number } {
  const c = [
    [2.5, 2.5],
    [N - 2.5, N - 2.5],
    [N - 2.5, 2.5],
    [2.5, N - 2.5],
  ][slot]!;
  return { x: c[0]!, y: c[1]! };
}

function setupPainters(humans: { slot: number; name: string }[]): void {
  for (const p of painters) scene.remove(p.mesh);
  painters = [];
  for (let slot = 0; slot < 4; slot++) {
    const h = humans.find((x) => x.slot === slot);
    const s = spawnPoint(slot);
    painters.push({ slot, name: h ? h.name : `${NAMES[slot]} bot`, x: s.x, y: s.y, vx: 0, vy: 0, bot: !h, human: !!h, mesh: painterMesh(slot) });
  }
}

function paintAt(x: number, y: number, slot: number, radius = 0): void {
  const r = Math.ceil(radius);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (radius > 0 && dx * dx + dy * dy > radius * radius) continue;
      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
      const i = ty * N + tx;
      if (grid[i] !== slot) {
        grid[i] = slot;
        paintTexel(i);
        tex.needsUpdate = true;
      }
    }
  }
}

function counts(): number[] {
  const c = [0, 0, 0, 0];
  for (const v of grid) if (v !== 255) c[v]!++;
  return c;
}

// ---------------------------------------------------------------- simulation
function steerBot(p: Painter, now: number): void {
  if (!p.target || now > p.target.at || Math.hypot(p.target.x - p.x, p.target.y - p.y) < 0.6) {
    // Head for a nearby tile that isn't ours yet (prefer close ones).
    let best = { x: Math.random() * N, y: Math.random() * N };
    let bestScore = -Infinity;
    for (let k = 0; k < 14; k++) {
      const x = Math.floor(Math.random() * N) + 0.5;
      const y = Math.floor(Math.random() * N) + 0.5;
      const v = grid[Math.floor(y) * N + Math.floor(x)];
      const d = Math.hypot(x - p.x, y - p.y);
      const score = (v === p.slot ? -6 : v === 255 ? 2 : 3) - d * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    if (bomb && Math.hypot(bomb.x - p.x, bomb.y - p.y) < 7) best = { ...bomb };
    p.target = { ...best, at: now + 1.2 + Math.random() };
  }
  const dx = p.target.x - p.x;
  const dy = p.target.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  p.vx = (dx / d) * SPEED * 0.86;
  p.vy = (dy / d) * SPEED * 0.86;
}

function moveLocal(p: Painter): void {
  const k = keys.axis();
  let x = k.x;
  let y = k.y;
  if (stick && (stick.x || stick.y)) {
    x = stick.x;
    y = stick.y;
  }
  p.vx = x * SPEED;
  p.vy = y * SPEED;
}

const isAuthority = (): boolean => mode === 'solo' || !!lobby.room?.isHost;

function update(dt: number, now: number): void {
  if (!running) return;
  for (const p of painters) {
    if (p.slot === mySlot) moveLocal(p);
    else if (p.bot && isAuthority()) steerBot(p, now);
    // Everyone else keeps the velocity from the last network update (extrapolated).
    p.x = THREE.MathUtils.clamp(p.x + p.vx * dt, 0.3, N - 0.3);
    p.y = THREE.MathUtils.clamp(p.y + p.vy * dt, 0.3, N - 0.3);
    paintAt(p.x, p.y, p.slot);
    if (bomb && isAuthority() && Math.hypot(bomb.x - p.x, bomb.y - p.y) < 0.8) explode(p.slot, bomb.x, bomb.y);
  }

  if (!isAuthority()) return;
  timeLeft -= dt;
  bombIn -= dt;
  if (!bomb && bombIn <= 0) {
    bomb = { x: 3 + Math.random() * (N - 6), y: 3 + Math.random() * (N - 6) };
    if (mode === 'online') lobby.room?.send({ t: 'bomb', x: bomb.x, y: bomb.y });
  }
  if (mode === 'online') {
    if (now - lastState > 1 / 15) {
      lastState = now;
      lobby.room?.send({ t: 'st', time: timeLeft, ps: painters.filter((p) => p.bot || p.slot === mySlot).map((p) => [p.slot, round2(p.x), round2(p.y), round2(p.vx), round2(p.vy)]) });
    }
    if (now - lastGrid > 1) {
      lastGrid = now;
      lobby.room?.send({ t: 'grid', g: encodeGrid() });
    }
  }
  if (timeLeft <= 0) endRound();
}

function explode(slot: number, x: number, y: number): void {
  paintAt(x, y, slot, BOMB_RADIUS);
  bomb = null;
  bombIn = 6 + Math.random() * 4;
  if (slot === mySlot) ui.toast('SPLASH!', 900);
  if (mode === 'online') lobby.room?.send({ t: 'boom', slot, x, y });
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const encodeGrid = (): string => String.fromCharCode(...Array.from(grid, (v) => (v === 255 ? 48 : 49 + v)));
function decodeGrid(s: string): void {
  for (let i = 0; i < N * N && i < s.length; i++) {
    const c = s.charCodeAt(i);
    grid[i] = c === 48 ? 255 : c - 49;
  }
  redrawBoard();
}

function endRound(): void {
  running = false;
  timeLeft = 0;
  const c = counts();
  if (mode === 'online') lobby.room?.send({ t: 'end', g: encodeGrid() });
  showResults(c);
}

function showResults(c: number[]): void {
  if (stick) stick.root.hidden = true;
  const order = painters.map((p) => ({ p, n: c[p.slot]! })).sort((a, b) => b.n - a.n);
  const winner = order[0]!.p;
  const total = N * N;
  const rows = order
    .map(({ p, n }, i) => `<li><i style="background:${COLORS[p.slot]}"></i><span>#${i + 1} ${esc(p.name)}${p.slot === mySlot ? ' · you' : ''}</span><b style="margin-left:auto">${Math.round((n / total) * 100)}%</b></li>`)
    .join('');
  const won = winner.slot === mySlot;
  if (mode === 'solo') {
    const body = document.createElement('div');
    body.innerHTML = `<ul class="players">${rows}</ul>`;
    void ui.gameOver(c[mySlot]!, { title: won ? 'You win!' : `${winner.name} wins`, unit: 'tiles painted', onRetry: startSolo }).then(() => {
      document.querySelector('.card .score__unit')?.insertAdjacentElement('afterend', body);
    });
    return;
  }
  ui.show({
    kicker: 'ROUND OVER',
    title: won ? 'You win!' : `${winner.name} wins`,
    body: `<ul class="players">${rows}</ul>`,
    buttons: [{ label: 'Back to room', primary: true, onClick: () => lobby.show() }],
  });
}

// ---------------------------------------------------------------- online
const lobby = new Lobby({
  game: 'paint',
  ui,
  minPlayers: 1,
  colors: COLORS,
  note: 'Up to 4 players. Empty slots are filled with bots.',
  onHostStart: (room) => {
    const humans = room.players.map((p) => ({ slot: p.slot, name: p.name }));
    room.send({ t: 'start', humans });
    startOnline(room.slot, humans);
  },
  onMessage: (room, msg) => handleNet(room.isHost, msg),
  onRoster: (_room, players: Player[]) => {
    // Someone left mid-round: a bot takes over their painter.
    for (const p of painters) {
      if (p.human && p.slot !== mySlot && !players.some((x) => x.slot === p.slot)) {
        p.human = false;
        p.bot = true;
        p.name = `${NAMES[p.slot]} bot`;
        ui.toast('A player left; a bot took over.', 2500);
      }
    }
  },
  onClosed: (reason) => {
    lobby.leave();
    running = false;
    mode = 'menu';
    if (stick) stick.root.hidden = true;
    showTitle();
    if (reason) ui.toast(reason, 4000);
  },
});

function handleNet(amHost: boolean, msg: RoomMessage): void {
  switch (msg.t) {
    case 'start':
      if (!amHost) startOnline(lobby.room!.slot, msg['humans'] as { slot: number; name: string }[]);
      break;
    case 'pos': {
      // A player's own painter position (they are authoritative over it).
      const p = painters[msg.from!];
      if (p && msg.from !== mySlot) {
        p.x = msg['x'] as number;
        p.y = msg['y'] as number;
        p.vx = msg['vx'] as number;
        p.vy = msg['vy'] as number;
      }
      break;
    }
    case 'st':
      if (!amHost) {
        timeLeft = msg['time'] as number;
        for (const [slot, x, y, vx, vy] of msg['ps'] as number[][]) {
          const p = painters[slot!];
          if (!p || slot === mySlot) continue;
          p.x = x!;
          p.y = y!;
          p.vx = vx!;
          p.vy = vy!;
        }
      }
      break;
    case 'grid':
      if (!amHost) decodeGrid(msg['g'] as string);
      break;
    case 'bomb':
      bomb = { x: msg['x'] as number, y: msg['y'] as number };
      break;
    case 'boom':
      paintAt(msg['x'] as number, msg['y'] as number, msg['slot'] as number, BOMB_RADIUS);
      bomb = null;
      break;
    case 'end':
      if (!amHost) {
        decodeGrid(msg['g'] as string);
        running = false;
        showResults(counts());
      }
      break;
  }
}

function startOnline(slot: number, humans: { slot: number; name: string }[]): void {
  mode = 'online';
  mySlot = slot;
  lobby.inMatch = true;
  beginRound(humans);
}

function startSolo(): void {
  mode = 'solo';
  mySlot = 0;
  beginRound([{ slot: 0, name: ui.me?.name ?? 'You' }]);
}

function beginRound(humans: { slot: number; name: string }[]): void {
  grid.fill(255);
  redrawBoard();
  setupPainters(humans);
  timeLeft = ROUND;
  bomb = null;
  bombIn = 4;
  running = true;
  ui.hide();
  if (stick) stick.root.hidden = false;
  ui.toast(isTouch() ? 'Drag the joystick to paint!' : 'WASD or arrow keys to paint!', 2000);
}

// ---------------------------------------------------------------- render loop
function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(nowMs: number): void {
  const dt = Math.min((nowMs - last) / 1000, 1 / 20);
  last = nowMs;
  const now = nowMs / 1000;
  update(dt, now);
  const me = painters[mySlot];
  if (mode === 'online' && running && me && now - lastSentPos > 1 / 20 && !lobby.room?.isHost) {
    lastSentPos = now;
    lobby.room?.send({ t: 'pos', x: round2(me.x), y: round2(me.y), vx: round2(me.vx), vy: round2(me.vy) });
  }
  // Host sends its own painter in 'st'; guests' painters go out above.
  for (const p of painters) {
    p.mesh.position.set(p.x, Math.abs(Math.sin(now * 9 + p.slot)) * (Math.hypot(p.vx, p.vy) > 0.1 ? 0.18 : 0.04), p.y);
    if (Math.hypot(p.vx, p.vy) > 0.1) p.mesh.rotation.y = Math.atan2(p.vx, p.vy);
  }
  bombMesh.visible = !!bomb && running;
  if (bomb) {
    bombMesh.position.set(bomb.x, 0.45 + Math.sin(now * 5) * 0.12, bomb.y);
    bombMat.emissiveIntensity = 0.6 + Math.sin(now * 10) * 0.3;
  }
  // Camera: a tilted view that follows you a little.
  const portrait = innerWidth < innerHeight;
  const follow = portrait ? 0.75 : 0.35; // narrow screens can't show the whole board, so track the player
  const fx = me ? N / 2 + (me.x - N / 2) * follow : N / 2;
  const fz = me ? N / 2 + (me.y - N / 2) * follow : N / 2;
  camera.position.set(fx, portrait ? 38 : 26, fz + (portrait ? 14 : 17));
  camera.lookAt(fx, 0, fz + 1);
  // HUD
  timeChip.textContent = `⏱ ${Math.max(0, Math.ceil(timeLeft))}`;
  timeChip.hidden = mode === 'menu';
  if (painters.length) {
    const c = counts();
    painters.forEach((p, i) => {
      const chip = scoreChips[i]!;
      chip.hidden = mode === 'menu';
      chip.textContent = `${p.slot === mySlot ? 'You' : p.name.split(' ')[0]} ${Math.round((c[i]! / (N * N)) * 100)}%`;
      chip.style.color = COLORS[i]!;
    });
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function showTitle(): void {
  const body = document.createElement('div');
  body.innerHTML = `<p>${isTouch() ? 'Use the joystick' : 'Move with <kbd>WASD</kbd> or the arrow keys'}. Every tile you roll over turns your colour. Grab the glowing <b>paint bombs</b> for a big splash.</p><p>90 seconds. Most tiles wins.</p>`;
  const join = el('form', 'row', body);
  const input = el('input', 'code-input', join);
  input.placeholder = 'CODE';
  input.maxLength = 6;
  const jb = el('button', 'btn', join);
  jb.textContent = 'Join';
  join.addEventListener('submit', (e) => {
    e.preventDefault();
    void lobby.join(input.value);
  });
  void ui.boardInto(body);
  ui.show({
    kicker: 'TRONIX ARENA',
    title: 'Paint Clash',
    body,
    buttons: [
      { label: 'Play vs bots', primary: true, onClick: startSolo },
      { label: 'Host online', onClick: () => void lobby.host() },
    ],
  });
}

redrawBoard();
setupPainters([]);
const invite = inviteCode();
if (invite) void lobby.join(invite);
else showTitle();

Object.assign(window, {
  __paint: () => ({ mode, running, mySlot, timeLeft, counts: counts(), grid: encodeGrid(), painters: painters.map((p) => ({ slot: p.slot, name: p.name, x: p.x, y: p.y, bot: p.bot })) }),
});
