/**
 * Curve Clash: 3D tunnel pong. Move your paddle with the mouse, finger or
 * arrow keys; hitting the ball while moving puts spin on it so it curves.
 *
 * Solo: endless ladder against the computer (3 lives, it gets better as you
 * score). Online: first to 7 against a friend. The host's browser simulates
 * the ball; each player owns their own paddle (no lag on your own moves).
 */
import * as THREE from 'three';
import { inviteCode, Lobby } from '../shared/lobby';
import { isTouch, Keys } from '../shared/input';
import type { RoomMessage } from '../shared/room';
import { el, GameUI } from '../shared/ui';

const L = 18; // tunnel length: near paddle at z = 0, far paddle at z = -L
const HW = 3.6; // half width
const HH = 2.4; // half height
const PW = 1.0; // paddle half width
const PH = 0.7; // paddle half height
const BALL_R = 0.28;
const START_SPEED = 13;
const MAX_SPEED = 30;
const SPIN_FACTOR = 0.9;
const WIN_ONLINE = 7;

const ui = new GameUI('pong', 'Curve Clash');
const youChip = el('div', 'chip', ui.hud);
const themChip = el('div', 'chip', ui.hud);
const keys = new Keys();

// ---------------------------------------------------------------- scene
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060f);
scene.fog = new THREE.Fog(0x05060f, 14, 34);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 0.6, 6.2);
camera.lookAt(0, 0, -L / 2);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

// Tunnel: neon edges and depth rings.
const tunnel = new THREE.Group();
scene.add(tunnel);
const edgeMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 });
const corners = [
  [-HW, -HH],
  [HW, -HH],
  [HW, HH],
  [-HW, HH],
];
for (const [x, y] of corners) {
  tunnel.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x!, y!, 0.6), new THREE.Vector3(x!, y!, -L)]), edgeMat));
}
const ringGeo = new THREE.BufferGeometry().setFromPoints([...corners, corners[0]!].map(([x, y]) => new THREE.Vector3(x!, y!, 0)));
for (let i = 0; i <= 9; i++) {
  const ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.25 }));
  ring.position.z = -(i / 9) * L;
  tunnel.add(ring);
}
// Ball depth marker: a bright ring that follows the ball along the tunnel.
const marker = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0xffc93c }));
scene.add(marker);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, L + 1), new THREE.MeshBasicMaterial({ color: 0x0b0d22, transparent: true, opacity: 0.6 }));
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -HH, -L / 2);
scene.add(floor);

function paddleMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(PW * 2, PH * 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })));
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(PW * 2, PH * 2)), new THREE.LineBasicMaterial({ color }));
  g.add(edge);
  return g;
}
const myPaddle = paddleMesh(0xff5a1f);
const theirPaddle = paddleMesh(0x22d3ee);
scene.add(myPaddle, theirPaddle);
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
const glow = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.9, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.25 }));
ballMesh.add(glow);
scene.add(ballMesh);

// ---------------------------------------------------------------- simulation (canonical coords)
// Player 0 (you in solo, host online) is at z = 0; player 1 at z = -L.
interface Sim {
  ball: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector2;
  paddles: [THREE.Vector2, THREE.Vector2];
  prevPaddles: [THREE.Vector2, THREE.Vector2];
  score: [number, number];
  serveTimer: number;
  server: 0 | 1;
  hits: number;
}

const sim: Sim = {
  ball: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  spin: new THREE.Vector2(),
  paddles: [new THREE.Vector2(), new THREE.Vector2()],
  prevPaddles: [new THREE.Vector2(), new THREE.Vector2()],
  score: [0, 0],
  serveTimer: 1,
  server: 0,
  hits: 0,
};

let mode: 'menu' | 'solo' | 'online' = 'menu';
let running = false;
let lives = 3;
let soloScore = 0;
let cpuSkill = 0;
let mySlot: 0 | 1 = 0;
let lastFlash = 0;

function resetBall(server: 0 | 1): void {
  sim.server = server;
  sim.serveTimer = 1.1;
  sim.hits = 0;
  sim.spin.set(0, 0);
  sim.vel.set(0, 0, 0);
  sim.ball.set(sim.paddles[server].x, sim.paddles[server].y, server === 0 ? -0.6 : -L + 0.6);
}

function serve(): void {
  const dir = sim.server === 0 ? -1 : 1;
  sim.vel.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, dir * START_SPEED);
}

/** Advance the ball. Returns the scoring player when a point ends. */
function step(dt: number): 0 | 1 | null {
  if (sim.serveTimer > 0) {
    sim.serveTimer -= dt;
    const p = sim.paddles[sim.server];
    sim.ball.set(p.x, p.y, sim.server === 0 ? -0.6 : -L + 0.6);
    if (sim.serveTimer <= 0) serve();
    return null;
  }
  // Spin curves the ball, and slowly wears off.
  sim.vel.x += sim.spin.x * dt;
  sim.vel.y += sim.spin.y * dt;
  sim.spin.multiplyScalar(Math.pow(0.55, dt));
  sim.ball.addScaledVector(sim.vel, dt);
  const lim = (v: number, m: number, axis: 'x' | 'y'): number => {
    if (v > m - BALL_R) {
      sim.vel[axis] = -Math.abs(sim.vel[axis]);
      sim.spin[axis] *= -0.5;
      return m - BALL_R;
    }
    if (v < -m + BALL_R) {
      sim.vel[axis] = Math.abs(sim.vel[axis]);
      sim.spin[axis] *= -0.5;
      return -m + BALL_R;
    }
    return v;
  };
  sim.ball.x = lim(sim.ball.x, HW, 'x');
  sim.ball.y = lim(sim.ball.y, HH, 'y');

  for (const who of [0, 1] as const) {
    const planeZ = who === 0 ? 0 : -L;
    const coming = who === 0 ? sim.vel.z > 0 : sim.vel.z < 0;
    const crossed = who === 0 ? sim.ball.z >= planeZ : sim.ball.z <= planeZ;
    if (!coming || !crossed) continue;
    const p = sim.paddles[who];
    if (Math.abs(sim.ball.x - p.x) <= PW + BALL_R && Math.abs(sim.ball.y - p.y) <= PH + BALL_R) {
      sim.hits++;
      const speed = Math.min(MAX_SPEED, START_SPEED + sim.hits * 0.9);
      const moved =
        who === 1 && mode === 'online'
          ? remoteVel
          : new THREE.Vector2().subVectors(p, sim.prevPaddles[who]).divideScalar(Math.max(dt, 1 / 240));
      sim.spin.set(THREE.MathUtils.clamp(moved.x * SPIN_FACTOR, -22, 22), THREE.MathUtils.clamp(moved.y * SPIN_FACTOR, -22, 22));
      sim.vel.x = (sim.ball.x - p.x) * 3;
      sim.vel.y = (sim.ball.y - p.y) * 3;
      sim.vel.z = who === 0 ? -speed : speed;
      sim.ball.z = planeZ;
      lastFlash = 0.15;
    } else {
      return who === 0 ? 1 : 0;
    }
  }
  return null;
}

// ---------------------------------------------------------------- input
const target = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  if (ui.visible) return;
  // Map the pointer to the near end of the tunnel (projected), with a little gain.
  const nx = (e.clientX / innerWidth) * 2 - 1;
  const ny = -((e.clientY / innerHeight) * 2 - 1);
  target.set(nx * HW * 1.25, ny * HH * 1.35 + 0.3);
});

function moveMyPaddle(dt: number): THREE.Vector2 {
  const mine = new THREE.Vector2();
  const local = sim.paddles[mySlot === 0 ? 0 : 1];
  // Online guests see a mirrored world: convert back to canonical coords.
  const flip = mySlot === 1 ? -1 : 1;
  const k = keys.axis();
  if (k.x || k.y) {
    target.x = THREE.MathUtils.clamp(local.x * flip + k.x * 9 * dt, -HW + PW, HW - PW);
    target.y = THREE.MathUtils.clamp(local.y - k.y * 9 * dt, -HH + PH, HH - PH);
  }
  mine.set(THREE.MathUtils.clamp(target.x, -HW + PW, HW - PW) * flip, THREE.MathUtils.clamp(target.y, -HH + PH, HH - PH));
  return mine;
}

function cpu(dt: number): void {
  const p = sim.paddles[1];
  let tx = 0;
  let ty = 0;
  if (sim.vel.z < 0 && sim.serveTimer <= 0) {
    // Predict roughly where the ball arrives, with skill-based error.
    const t = (sim.ball.z + L) / -sim.vel.z;
    tx = sim.ball.x + sim.vel.x * t * 0.5;
    ty = sim.ball.y + sim.vel.y * t * 0.5;
    const err = 1.2 - Math.min(1.1, cpuSkill * 0.12);
    tx += Math.sin(performance.now() / 700) * err;
  }
  const speed = 3.2 + cpuSkill * 0.6;
  p.x += THREE.MathUtils.clamp(tx - p.x, -speed * dt, speed * dt);
  p.y += THREE.MathUtils.clamp(ty - p.y, -speed * dt, speed * dt);
  p.x = THREE.MathUtils.clamp(p.x, -HW + PW, HW - PW);
  p.y = THREE.MathUtils.clamp(p.y, -HH + PH, HH - PH);
}

// ---------------------------------------------------------------- online
let net: { send: (m: RoomMessage) => void } | null = null;
let sendTimer = 0;
let gotBallAt = 0;
// The guest's paddle arrives ~30 times a second, so measure its speed per update.
const remoteVel = new THREE.Vector2();
let remoteAt = 0;

const lobby = new Lobby({
  game: 'pong',
  ui,
  minPlayers: 2,
  colors: ['#ff5a1f', '#22d3ee'],
  note: 'First to 7 wins. The host serves first.',
  onHostStart: (room) => {
    room.send({ t: 'start' });
    startOnline(0, room);
  },
  onMessage: (room, msg) => {
    if (msg.t === 'start' && !room.isHost) startOnline(1, room);
    else if (msg.t === 'p' && mode === 'online' && room.isHost) {
      // Guest paddle (canonical coords).
      const now = performance.now();
      const x = msg['x'] as number;
      const y = msg['y'] as number;
      const dt = Math.max(0.016, (now - remoteAt) / 1000);
      remoteVel.set((x - sim.paddles[1].x) / dt, (y - sim.paddles[1].y) / dt);
      remoteAt = now;
      sim.paddles[1].set(x, y);
    } else if (msg.t === 's' && mode === 'online' && !room.isHost) {
      const b = msg['b'] as number[];
      sim.ball.set(b[0]!, b[1]!, b[2]!);
      sim.vel.set(b[3]!, b[4]!, b[5]!);
      sim.spin.set(b[6]!, b[7]!);
      sim.serveTimer = b[8]!;
      const p = msg['p'] as number[];
      sim.paddles[0].set(p[0]!, p[1]!);
      const sc = msg['sc'] as number[];
      if (sc[0] !== sim.score[0] || sc[1] !== sim.score[1]) {
        sim.score = [sc[0]!, sc[1]!];
        lastFlash = 0.3;
      }
      gotBallAt = performance.now();
    } else if (msg.t === 'over' && mode === 'online' && !room.isHost) {
      onlineOver(msg['winner'] as 0 | 1);
    }
  },
  onRoster: (_room, players) => {
    if (mode === 'online' && players.length < 2) {
      ui.toast('Your opponent left.', 3000);
      running = false;
      mode = 'menu';
      lobby.show();
    }
  },
  onClosed: (reason) => {
    lobby.leave();
    net = null;
    running = false;
    mode = 'menu';
    showTitle();
    if (reason) ui.toast(reason, 4000);
  },
});

function startOnline(slot: 0 | 1, room: NonNullable<Lobby['room']>): void {
  mode = 'online';
  mySlot = slot;
  net = room;
  lobby.inMatch = true;
  sim.score = [0, 0];
  sim.paddles[0].set(0, 0);
  sim.paddles[1].set(0, 0);
  resetBall(0);
  running = true;
  ui.hide();
}

function onlineOver(winner: 0 | 1): void {
  running = false;
  const won = winner === mySlot;
  ui.show({
    kicker: 'MATCH OVER',
    title: won ? 'You win!' : 'You lose',
    body: `<div class="score">${sim.score[mySlot]} – ${sim.score[mySlot === 0 ? 1 : 0]}</div>`,
    buttons: [{ label: 'Back to room', primary: true, onClick: () => lobby.show() }],
  });
}

// ---------------------------------------------------------------- game flow
function startSolo(): void {
  mode = 'solo';
  mySlot = 0;
  lives = 3;
  soloScore = 0;
  cpuSkill = 0;
  sim.score = [0, 0];
  resetBall(0);
  running = true;
  ui.hide();
}

function pointTo(winner: 0 | 1): void {
  sim.score[winner]++;
  lastFlash = 0.3;
  if (mode === 'solo') {
    if (winner === 0) {
      soloScore++;
      cpuSkill = Math.floor(soloScore / 2);
      if (soloScore % 2 === 0) ui.toast(`Level ${cpuSkill + 1}: the CPU gets sharper`, 1500);
    } else {
      lives--;
      if (lives <= 0) {
        running = false;
        void ui.gameOver(soloScore, { title: `Level ${cpuSkill + 1}`, onRetry: startSolo });
        return;
      }
    }
    resetBall(winner === 0 ? 1 : 0);
    return;
  }
  // online (host)
  if (sim.score[winner] >= WIN_ONLINE) {
    net?.send({ t: 's', b: [...sim.ball.toArray(), ...sim.vel.toArray(), sim.spin.x, sim.spin.y, 9], p: sim.paddles[0].toArray(), sc: sim.score });
    net?.send({ t: 'over', winner });
    onlineOver(winner);
    return;
  }
  resetBall(winner === 0 ? 1 : 0);
}

function update(dt: number): void {
  if (!running) return;
  sim.prevPaddles[0].copy(sim.paddles[0]);
  sim.prevPaddles[1].copy(sim.paddles[1]);
  const mine = moveMyPaddle(dt);
  sim.paddles[mySlot].copy(mine);
  if (mode === 'solo') {
    cpu(dt);
    const p = step(dt);
    if (p !== null) pointTo(p);
  } else if (mode === 'online') {
    sendTimer -= dt;
    if (lobby.room?.isHost) {
      const p = step(dt);
      if (p !== null) pointTo(p);
      if (sendTimer <= 0) {
        sendTimer = 1 / 30;
        net?.send({ t: 's', b: [...sim.ball.toArray(), ...sim.vel.toArray(), sim.spin.x, sim.spin.y, sim.serveTimer], p: sim.paddles[0].toArray(), sc: sim.score });
      }
    } else {
      // Guest: extrapolate the host's ball between snapshots.
      if (sim.serveTimer <= 0 && performance.now() - gotBallAt < 250) {
        sim.vel.x += sim.spin.x * dt;
        sim.vel.y += sim.spin.y * dt;
        sim.ball.addScaledVector(sim.vel, dt);
      }
      if (sendTimer <= 0) {
        sendTimer = 1 / 30;
        net?.send({ t: 'p', x: mine.x, y: mine.y });
      }
    }
  }
}

/** World → view: online guests see the tunnel from the other end. */
function view(v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return mySlot === 1 ? out.set(-v.x, v.y, -L - v.z) : out.copy(v);
}

function render(dt: number): void {
  const me = sim.paddles[mySlot];
  const them = sim.paddles[mySlot === 0 ? 1 : 0];
  // Your paddle is always at the near end of your view, the opponent's at the far end.
  const flip = mySlot === 1 ? -1 : 1;
  myPaddle.position.set(me.x * flip, me.y, 0.02);
  theirPaddle.position.set(them.x * flip, them.y, -L);
  view(sim.ball, ballMesh.position);
  marker.position.z = ballMesh.position.z;
  lastFlash = Math.max(0, lastFlash - dt);
  edgeMat.opacity = 0.55 + lastFlash * 2;
  (glow.material as THREE.MeshBasicMaterial).opacity = 0.25 + lastFlash;
  if (mode === 'solo') {
    youChip.textContent = `★ ${soloScore}`;
    themChip.textContent = `${'♥'.repeat(Math.max(0, lives))} · Lv ${cpuSkill + 1}`;
  } else if (mode === 'online') {
    youChip.textContent = `You ${sim.score[mySlot]}`;
    themChip.textContent = `Them ${sim.score[mySlot === 0 ? 1 : 0]}`;
  } else {
    youChip.textContent = '';
    themChip.textContent = '';
  }
  youChip.hidden = !youChip.textContent;
  themChip.hidden = !themChip.textContent;
  renderer.render(scene, camera);
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = innerWidth < innerHeight ? 82 : 60;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  // Smaller sub-steps keep fast balls from skipping through paddles.
  const steps = Math.ceil(dt / (1 / 120));
  for (let i = 0; i < steps; i++) update(dt / steps);
  render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function showTitle(): void {
  const body = document.createElement('div');
  body.innerHTML = `<p>${isTouch() ? 'Drag your finger' : 'Move the mouse (or arrow keys)'} to move your paddle. <b>Move while you hit</b> to curve the ball.</p><p>Solo: beat the computer as it levels up. 3 lives.</p>`;
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
    title: 'Curve Clash',
    body,
    buttons: [
      { label: 'Play solo', primary: true, onClick: startSolo },
      { label: 'Host online 1v1', onClick: () => void lobby.host() },
    ],
  });
}

const invite = inviteCode();
if (invite) void lobby.join(invite);
else showTitle();
resetBall(0);

Object.assign(window, {
  __pong: () => ({ mode, running, mySlot, score: [...sim.score], soloScore, lives, ball: sim.ball.toArray(), vel: sim.vel.toArray(), paddles: sim.paddles.map((p) => p.toArray()) }),
});
