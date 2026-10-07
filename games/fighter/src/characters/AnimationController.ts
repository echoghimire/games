import * as THREE from 'three';
import type { AnimKey } from './AnimKeys';

export interface ClipSpec {
  /** Clip name inside the model file. */
  readonly clip: string;
  readonly loop?: boolean;
  /** Playback rate multiplier. */
  readonly speed?: number;
  /** Normalized start offset (0..1). */
  readonly start?: number;
  /** Freeze on this normalized time instead of playing (static poses, e.g. crouch). */
  readonly pose?: number;
  /** Logical key to use if `clip` is missing from the model. */
  readonly fallback?: AnimKey;
}

export type ClipMap = Readonly<Partial<Record<AnimKey, ClipSpec>>>;

export interface PlayOptions {
  /** Cross-fade duration in seconds. */
  fade?: number;
  /** Stretch the clip (after `start`) to last exactly this long, in seconds. */
  duration?: number;
  /** Extra offset applied on top of the spec's start (0..1). */
  start?: number;
}

interface Resolved {
  readonly spec: ClipSpec;
  readonly action: THREE.AnimationAction;
}

/**
 * Plays logical animations on a skinned model with cross-fades. Gameplay asks
 * for "jab" or "hitHigh"; the controller resolves clip names, fallbacks and timing.
 */
export class AnimationController {
  readonly mixer: THREE.AnimationMixer;
  private readonly cache = new Map<AnimKey, Resolved | null>();
  private readonly clipsByName = new Map<string, THREE.AnimationClip>();
  private current: Resolved | null = null;
  private currentKey: AnimKey | null = null;

  constructor(
    root: THREE.Object3D,
    clips: readonly THREE.AnimationClip[],
    private readonly map: ClipMap,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) this.clipsByName.set(clip.name, clip);
  }

  get key(): AnimKey | null {
    return this.currentKey;
  }

  has(key: AnimKey): boolean {
    return this.resolve(key) !== null;
  }

  play(key: AnimKey, opts: PlayOptions = {}): void {
    const next = this.resolve(key);
    if (!next) return;
    const { spec, action } = next;
    const clipDuration = action.getClip().duration;
    const start = Math.min(0.99, (spec.start ?? 0) + (opts.start ?? 0));
    const fade = opts.fade ?? 0.12;

    action.reset();
    action.enabled = true;
    action.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !spec.loop;

    if (spec.pose !== undefined) {
      action.time = spec.pose * clipDuration;
      action.timeScale = 0;
    } else {
      action.time = start * clipDuration;
      const remaining = clipDuration * (1 - start);
      action.timeScale = opts.duration && opts.duration > 0 ? remaining / opts.duration : (spec.speed ?? 1);
    }

    const prev = this.current;
    if (prev && prev.action !== action) {
      prev.action.fadeOut(fade);
      action.setEffectiveWeight(1).fadeIn(fade);
    } else if (!prev) {
      action.setEffectiveWeight(1);
    }
    action.play();
    this.current = next;
    this.currentKey = key;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  private resolve(key: AnimKey, depth = 0): Resolved | null {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const spec = this.map[key];
    let resolved: Resolved | null = null;
    if (spec) {
      const clip = this.clipsByName.get(spec.clip);
      if (clip) {
        resolved = { spec, action: this.mixer.clipAction(clip) };
      } else if (spec.fallback && depth < 4) {
        console.warn(`[anim] clip "${spec.clip}" missing for "${key}", using fallback "${spec.fallback}"`);
        resolved = this.resolve(spec.fallback, depth + 1);
      }
    } else if (key !== 'idle' && depth < 4) {
      resolved = this.resolve('idle', depth + 1);
    }
    this.cache.set(key, resolved);
    return resolved;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
