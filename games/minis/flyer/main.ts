/**
 * Sky Dash: one-tap flyer. Tap (click, touch or Space) to boost upward and
 * thread the neon gates over a synthwave city. One point per gate.
 */
import { Hold } from '../shared/input';
import { el, GameUI } from '../shared/ui';

const H = 640; // logical height; width follows the screen's aspect ratio
const GRAVITY = 1650;
const FLAP = -520;
const PLAYER_X = 0.3; // fraction of the width
const R = 15;
const GATE_W = 74;

interface Gate {
  x: number;
  gapY: number;
  gap: number;
  scored: boolean;
  hue: number;
}

const ui = new GameUI('flyer', 'Sky Dash');
const scoreChip = el('div', 'chip', ui.hud);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let W = 1000;
let scale = 1;
let state: 'title' | 'ready' | 'play' | 'dead' = 'title';
let y = H / 2;
let vy = 0;
let gates: Gate[] = [];
let score = 0;
let speed = 230;
let dist = 0;
let spawnIn = 0;
let t = 0;
let shake = 0;
const trail: { x: number; y: number }[] = [];
const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random() * 0.6, s: Math.random() * 1.6 + 0.4 }));
const skyline = (seed: number, n: number): number[] => Array.from({ length: n }, (_, i) => 60 + ((Math.sin(i * 12.9898 + seed) * 43758.5453) % 1 + 1) % 1 * 150);
const far = skyline(1, 40);
const near = skyline(7, 30);

new Hold(document.body, () => {
  if (state === 'ready') state = 'play';
  if (state === 'play') vy = FLAP;
});

function reset(): void {
  y = H / 2;
  vy = 0;
  gates = [];
  score = 0;
  speed = 230;
  dist = 0;
  spawnIn = 0.6;
  trail.length = 0;
  state = 'ready';
  ui.hide();
  ui.toast('Tap, click or press Space to fly', 1800);
}

function die(): void {
  if (state !== 'play') return;
  state = 'dead';
  shake = 0.35;
  setTimeout(() => void ui.gameOver(score, { title: score >= 20 ? 'Sky legend!' : 'Crashed!', unit: 'gates', onRetry: reset }), 700);
}

function update(dt: number): void {
  t += dt;
  shake = Math.max(0, shake - dt);
  if (state === 'ready') {
    y = H / 2 + Math.sin(t * 3) * 12;
    dist += 120 * dt;
    return;
  }
  if (state === 'dead') {
    vy += GRAVITY * dt;
    y = Math.min(H - 70, y + vy * dt);
    return;
  }
  if (state !== 'play') {
    dist += 60 * dt;
    return;
  }
  speed = Math.min(420, 230 + score * 6);
  dist += speed * dt;
  vy += GRAVITY * dt;
  y += vy * dt;
  if (y < R) {
    y = R; // the sky is a ceiling, not a wall of death
    vy = Math.max(vy, 0);
  }
  if (y > H - 70 - R) die();

  spawnIn -= dt;
  if (spawnIn <= 0) {
    const gap = Math.max(150, 215 - score * 2.2);
    gates.push({ x: W + GATE_W, gapY: 120 + Math.random() * (H - 70 - 240), gap, scored: false, hue: (score * 37) % 360 });
    spawnIn = Math.max(1.05, 1.55 - score * 0.012) * (230 / speed) * 1.25;
  }
  const px = W * PLAYER_X;
  for (const g of gates) {
    g.x -= speed * dt;
    if (!g.scored && g.x + GATE_W < px) {
      g.scored = true;
      score++;
    }
    // circle vs the two pillars
    const inX = px + R > g.x && px - R < g.x + GATE_W;
    if (inX && (y - R < g.gapY - g.gap / 2 || y + R > g.gapY + g.gap / 2)) die();
  }
  gates = gates.filter((g) => g.x > -GATE_W - 10);
  trail.push({ x: px, y });
  if (trail.length > 22) trail.shift();
}

function draw(): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 14 * shake, (Math.random() - 0.5) * 14 * shake);
  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0d0221');
  sky.addColorStop(0.55, '#3a0b4d');
  sky.addColorStop(0.85, '#ff3d7f');
  sky.addColorStop(1, '#ffb347');
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, W + 40, H + 40);
  for (const s of stars) {
    ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + s.x * 30));
    ctx.fillStyle = '#fff';
    ctx.fillRect(((s.x * W - dist * 0.02) % W + W) % W, s.y * H, s.s, s.s);
  }
  ctx.globalAlpha = 1;
  // sun
  const sun = ctx.createLinearGradient(0, H * 0.38, 0, H * 0.78);
  sun.addColorStop(0, '#ffe66d');
  sun.addColorStop(1, '#ff2e88');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(W * 0.7, H * 0.6, 120, Math.PI, 0);
  ctx.fill();
  // skylines
  drawSkyline(far, 0.15, 36, '#2a0a3d');
  drawSkyline(near, 0.4, 52, '#16052a');
  // neon floor grid
  const floorY = H - 70;
  ctx.fillStyle = '#0a0118';
  ctx.fillRect(0, floorY, W, 80);
  ctx.strokeStyle = 'rgba(255,61,127,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(W, floorY);
  for (let i = -2; i < 30; i++) {
    const x = ((i * 60 - (dist % 60)) / W - 0.5) * W;
    ctx.moveTo(W / 2 + x * 0.3, floorY);
    ctx.lineTo(W / 2 + x * 2.2, H);
  }
  ctx.stroke();
  // gates
  for (const g of gates) {
    const top = g.gapY - g.gap / 2;
    const bot = g.gapY + g.gap / 2;
    const color = `hsl(${(190 + g.hue) % 360} 100% 60%)`;
    ctx.fillStyle = 'rgba(10,2,30,0.85)';
    ctx.fillRect(g.x, -10, GATE_W, top + 10);
    ctx.fillRect(g.x, bot, GATE_W, floorY - bot);
    // Neon glow: a wide translucent stroke under a thin bright one (cheaper than shadowBlur).
    for (const [w, a] of [[12, 0.25], [4, 1]] as const) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.strokeRect(g.x, -10, GATE_W, top + 10);
      ctx.strokeRect(g.x, bot, GATE_W, floorY - bot);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillRect(g.x - 6, top - 12, GATE_W + 12, 12);
    ctx.fillRect(g.x - 6, bot, GATE_W + 12, 12);
  }
  // trail + player
  const px = W * PLAYER_X;
  trail.forEach((p, i) => {
    const a = i / trail.length;
    ctx.fillStyle = `rgba(255,201,60,${a * 0.5})`;
    ctx.beginPath();
    ctx.arc(p.x - (trail.length - i) * (speed / 60) * 0.35, p.y, R * a, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.save();
  ctx.translate(px, y);
  ctx.rotate(Math.max(-0.5, Math.min(0.9, vy / 900)));
  ctx.shadowColor = '#ffc93c';
  ctx.shadowBlur = 24;
  const orb = ctx.createRadialGradient(-4, -5, 2, 0, 0, R);
  orb.addColorStop(0, '#fff7d6');
  orb.addColorStop(0.5, '#ffc93c');
  orb.addColorStop(1, '#ff5a1f');
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a0700';
  ctx.beginPath();
  ctx.arc(5, -3, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.shadowBlur = 0;
  // big score
  if (state === 'play' || state === 'dead') {
    ctx.font = '700 64px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.shadowColor = '#ff2e88';
    ctx.shadowBlur = 20;
    ctx.fillText(String(score), W / 2, 130);
    ctx.shadowBlur = 0;
  }
}

function drawSkyline(heights: number[], parallax: number, w: number, color: string): void {
  const floorY = H - 70;
  ctx.fillStyle = color;
  const off = (dist * parallax) % (heights.length * w);
  for (let i = 0; i < heights.length * 2; i++) {
    const x = i * w - off;
    if (x > W || x + w < 0) continue;
    const h = heights[i % heights.length]!;
    ctx.fillRect(x, floorY - h, w - 4, h);
  }
}

function resize(): void {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  scale = canvas.height / H;
  W = canvas.width / scale;
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  update(dt);
  draw();
  scoreChip.textContent = `Gates ${score}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const intro = document.createElement('div');
intro.innerHTML = '<p><b>Tap</b>, click or press <kbd>Space</kbd> to boost. Fly through the gaps in the neon gates.</p><p>It gets faster. How far can you go?</p>';
void ui.boardInto(intro);
ui.show({ kicker: 'TRONIX ARENA', title: 'Sky Dash', body: intro, buttons: [{ label: 'Play', primary: true, onClick: reset }] });

Object.assign(window, {
  __flyer: () => ({ state, score, y, vy, next: gates.find((g) => g.x + GATE_W > W * PLAYER_X - R)?.gapY ?? H / 2 }),
});
