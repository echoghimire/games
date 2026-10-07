import type { AssetManager } from '../assets/AssetManager';
import type { SoundKey } from '../assets/AssetManifest';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../game/GameEvents';

type Bus = 'music' | 'sfx' | 'ui';

export interface PlayOptions {
  volume?: number;
  /** Random pitch variation (+/- fraction). */
  pitchJitter?: number;
  rate?: number;
  /** Stereo position -1..1. */
  pan?: number;
  bus?: Bus;
  delay?: number;
}

const DEFAULT_VOLUMES: Readonly<Record<Bus, number>> = { music: 0.32, sfx: 0.9, ui: 0.6 };

/**
 * Web Audio playback with music / sfx / ui buses. Browsers block audio until
 * a user gesture, so the context is resumed on the first key or click.
 */
export class AudioManager {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly buses: Record<Bus, GainNode>;
  private readonly buffers = new Map<SoundKey, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  private punchAlt = false;
  private muted = false;

  constructor(private readonly stageHalfWidth: number) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    const make = (bus: Bus): GainNode => {
      const g = this.ctx.createGain();
      g.gain.value = DEFAULT_VOLUMES[bus];
      g.connect(this.master);
      return g;
    };
    this.buses = { music: make('music'), sfx: make('sfx'), ui: make('ui') };
    const unlock = (): void => {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  async load(assets: AssetManager): Promise<void> {
    const jobs = assets.soundKeys().map(async (key) => {
      try {
        const buffer = await this.ctx.decodeAudioData(assets.takeSound(key));
        this.buffers.set(key, buffer);
      } catch (err) {
        console.warn(`[audio] could not decode ${key}`, err);
      }
    });
    await Promise.all(jobs);
  }

  play(key: SoundKey, opts: PlayOptions = {}): void {
    const buffer = this.buffers.get(key);
    if (!buffer || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const jitter = opts.pitchJitter ?? 0.06;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    let node: AudioNode = src;
    node.connect(gain);
    node = gain;
    if (opts.pan !== undefined) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      node.connect(panner);
      node = panner;
    }
    node.connect(this.buses[opts.bus ?? 'sfx']);
    src.start(this.ctx.currentTime + (opts.delay ?? 0));
  }

  playMusic(key: SoundKey, fadeIn = 1.5): void {
    const buffer = this.buffers.get(key);
    if (!buffer) return;
    if (this.musicSource) return;
    const start = (): void => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + fadeIn);
      src.connect(gain).connect(this.buses.music);
      src.start();
      this.musicSource = src;
      this.musicGain = gain;
    };
    if (this.ctx.state === 'running') start();
    else {
      const resumeAndStart = (): void => {
        window.removeEventListener('keydown', resumeAndStart);
        window.removeEventListener('pointerdown', resumeAndStart);
        void this.ctx.resume().then(() => {
          if (!this.musicSource) start();
        });
      };
      window.addEventListener('keydown', resumeAndStart);
      window.addEventListener('pointerdown', resumeAndStart);
    }
  }

  /** Duck the music (e.g. on menus) without stopping it. */
  setMusicLevel(level: number, seconds = 0.6): void {
    const g = this.musicGain;
    if (!g) return;
    const now = this.ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(level, now + seconds);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }

  private panFor(x: number): number {
    return (x / (this.stageHalfWidth + 2)) * 0.7;
  }

  /** Maps game events to sounds. */
  bind(events: EventBus<GameEvents>): void {
    this.unsubscribe.push(
      events.on('attackStart', (e) => {
        const heavy = e.attack.shake >= 0.3;
        this.play(heavy ? 'whooshHeavy' : 'whoosh', { volume: heavy ? 0.5 : 0.35, pitchJitter: 0.12 });
      }),
      events.on('hit', (e) => {
        const pan = this.panFor(e.point.x);
        if (e.attack.sound === 'heavy' || e.heavy) {
          this.play('heavy', { volume: 1, pan });
          this.play('punch', { volume: 0.5, pan, rate: 0.7 });
        } else if (e.attack.sound === 'kick') {
          this.play('kick', { volume: 0.9, pan });
        } else {
          this.punchAlt = !this.punchAlt;
          this.play(this.punchAlt ? 'punch' : 'punch2', { volume: 0.85, pan });
        }
        if (e.counter) this.play('heavy', { volume: 0.5, rate: 1.4, delay: 0.03, pan });
      }),
      events.on('block', (e) => this.play('block', { volume: 0.55, pan: this.panFor(e.point.x), pitchJitter: 0.1 })),
      events.on('grabConnect', (e) => this.play('grab', { volume: 0.7, pan: this.panFor(e.point.x) })),
      events.on('grabTech', () => this.play('block', { volume: 0.6, rate: 0.8 })),
      events.on('throw', (e) => {
        this.play('heavy', { volume: 1, pan: this.panFor(e.point.x), rate: 0.85 });
        this.play('land', { volume: 1, delay: 0.25, rate: 0.8 });
      }),
      events.on('jump', (e) => this.play('jump', { volume: 0.5, pan: this.panFor(e.x), pitchJitter: 0.15 })),
      events.on('dash', (e) => this.play('whoosh', { volume: 0.25, pan: this.panFor(e.x), rate: 0.75 })),
      events.on('land', (e) => this.play('land', { volume: e.hard ? 1 : 0.45, rate: e.hard ? 0.75 : 1, pan: this.panFor(e.x) })),
      events.on('ko', () => {
        this.play('ko', { volume: 1, rate: 0.8, pitchJitter: 0 });
        this.play('heavy', { volume: 1, rate: 0.6, pitchJitter: 0 });
        this.setMusicLevel(0.25, 0.3);
      }),
      events.on('roundIntro', () => {
        this.play('uiRound', { bus: 'ui', volume: 0.9, pitchJitter: 0 });
        this.setMusicLevel(1, 1);
      }),
      events.on('roundFight', () => {
        this.play('uiConfirm', { bus: 'ui', volume: 0.9, pitchJitter: 0 });
        this.play('heavy', { volume: 0.6, rate: 0.5, pitchJitter: 0 });
      }),
      events.on('roundEnd', (e) => {
        if (e.reason === 'time') this.play('uiRound', { bus: 'ui', rate: 0.8, pitchJitter: 0 });
      }),
      events.on('matchEnd', () => this.setMusicLevel(0.5, 2)),
    );
  }

  uiSelect(): void {
    this.play('uiSelect', { bus: 'ui', volume: 0.8 });
  }

  uiConfirm(): void {
    this.play('uiConfirm', { bus: 'ui', volume: 0.9, pitchJitter: 0 });
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.musicSource?.stop();
    void this.ctx.close();
  }
}
