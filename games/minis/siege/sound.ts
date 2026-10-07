/** Tiny WebAudio synth for Ghost Siege: blips, thumps and noise bursts, no audio files. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
const lastPlayed = new Map<string, number>();
export let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem('siege:muted') === '1';
  } catch {
    return false;
  }
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem('siege:muted', m ? '1' : '0');
  } catch {
    // private mode
  }
  if (master) master.gain.value = m ? 0 : 0.5;
}

/** Browsers only allow audio after a gesture; call this from a click/tap. */
export function unlockAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/** Skip a sound if the same one played less than `gap` seconds ago (rapid fire). */
function throttle(name: string, gap: number): boolean {
  if (!ctx || muted) return false;
  const now = ctx.currentTime;
  if (now - (lastPlayed.get(name) ?? -1) < gap) return false;
  lastPlayed.set(name, now);
  return true;
}

function tone(freq: number, to: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
  const t = ctx!.currentTime + delay;
  const o = ctx!.createOscillator();
  const g = ctx!.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass', sweepTo?: number): void {
  const t = ctx!.currentTime;
  const src = ctx!.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx!.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  blaster(): void {
    if (throttle('blaster', 0.07)) tone(1300, 500, 0.07, 'square', 0.035);
  },
  cannon(): void {
    if (throttle('cannon', 0.1)) noise(0.18, 900, 0.22, 'lowpass', 120);
  },
  rocket(): void {
    if (throttle('rocket', 0.12)) noise(0.35, 400, 0.12, 'bandpass', 2400);
  },
  boom(big = false): void {
    if (throttle(big ? 'bigboom' : 'boom', 0.06)) noise(big ? 0.9 : 0.35, big ? 700 : 1400, big ? 0.45 : 0.18, 'lowpass', 60);
  },
  kill(): void {
    if (throttle('kill', 0.05)) tone(500 + Math.random() * 200, 1400, 0.16, 'sine', 0.06);
  },
  leak(): void {
    if (throttle('leak', 0.1)) {
      tone(180, 50, 0.45, 'sawtooth', 0.16);
      noise(0.3, 300, 0.2);
    }
  },
  build(): void {
    if (!throttle('build', 0.05)) return;
    noise(0.12, 2000, 0.12, 'highpass');
    tone(330, 660, 0.12, 'triangle', 0.1, 0.03);
  },
  upgrade(): void {
    if (!throttle('upgrade', 0.05)) return;
    [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.12, 'triangle', 0.08, i * 0.06));
  },
  sell(): void {
    if (throttle('sell', 0.05)) [988, 1319].forEach((f, i) => tone(f, f, 0.1, 'square', 0.04, i * 0.07));
  },
  wave(boss: boolean): void {
    if (!throttle('wave', 0.3)) return;
    const notes = boss ? [110, 104, 98, 92] : [220, 277, 330];
    notes.forEach((f, i) => tone(f, f * 0.98, boss ? 0.35 : 0.22, 'sawtooth', 0.07, i * (boss ? 0.28 : 0.12)));
  },
  cleared(): void {
    if (throttle('cleared', 0.3)) [659, 784, 988, 1319].forEach((f, i) => tone(f, f, 0.16, 'sine', 0.09, i * 0.08));
  },
  denied(): void {
    if (throttle('denied', 0.1)) tone(160, 120, 0.12, 'square', 0.06);
  },
  click(): void {
    if (throttle('click', 0.03)) tone(900, 900, 0.03, 'sine', 0.05);
  },
};
