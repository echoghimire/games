/**
 * Sound effects through WebAudio: the Drakonas samples (shots, plasma,
 * explosion, death) plus a few tiny synthesized blips. Mute is remembered.
 */

const SAMPLES = ['weapon-default', 'weapon-plasma', 'explosion-phaser', 'dieing-player'] as const;
export type Sample = (typeof SAMPLES)[number];
const MUTE_KEY = 'drakonas:muted';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<Sample, AudioBuffer>();
  private readonly lastAt = new Map<string, number>();
  muted = false;

  constructor(private readonly base: string) {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // storage blocked: default to sound on
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null; // no WebAudio: play silently
    }
    // Browsers only start audio after a gesture.
    const unlock = (): void => void this.ctx?.resume().catch(() => {});
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  async load(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      SAMPLES.map(async (name) => {
        try {
          const res = await fetch(`${this.base}${name}.mp3`);
          this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // a missing sound is not worth failing the game over
        }
      }),
    );
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      // ignore
    }
  }

  suspend(): void {
    void this.ctx?.suspend().catch(() => {});
  }

  resume(): void {
    void this.ctx?.resume().catch(() => {});
  }

  /** True if `key` played less than `gap` seconds ago (rate-limits busy sounds). */
  private busy(key: string, gap: number): boolean {
    const now = performance.now() / 1000;
    if (now - (this.lastAt.get(key) ?? -9) < gap) return true;
    this.lastAt.set(key, now);
    return false;
  }

  play(name: Sample, volume = 1, rate = 1, gap = 0.03): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !buf || this.muted || ctx.state !== 'running' || this.busy(name, gap)) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master!);
    src.start();
  }

  /** Short synthesized tone sweep. */
  tone(key: string, type: OscillatorType, f0: number, f1: number, dur: number, volume: number, gap = 0.04): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running' || this.busy(key, gap)) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  pickup(): void {
    this.tone('pick1', 'triangle', 660, 1320, 0.12, 0.25, 0);
    setTimeout(() => this.tone('pick2', 'triangle', 990, 1980, 0.14, 0.2, 0), 70);
  }

  coin(): void {
    this.tone('coin', 'square', 1500, 2400, 0.07, 0.06, 0.03);
  }

  hit(): void {
    this.tone('hit', 'sawtooth', 220, 50, 0.25, 0.35, 0.08);
  }

  warning(): void {
    for (let i = 0; i < 3; i++) setTimeout(() => this.tone(`warn${i}`, 'square', 440, 220, 0.45, 0.16, 0), i * 600);
  }
}
