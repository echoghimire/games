/** Simulation runs at a fixed rate so gameplay (frame data) is independent from the display refresh rate. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
const MAX_FRAME_TIME = 0.25;

export interface LoopCallbacks {
  /** Fixed-step gameplay tick (always SIM_DT seconds). */
  fixedUpdate(dt: number): void;
  /** Per-frame presentation update. `alpha` is the interpolation factor between the last two ticks. */
  render(frameDt: number, alpha: number): void;
  /**
   * Online lockstep: return false while the next tick can't run yet (the
   * opponent's input hasn't arrived). Time keeps accumulating, up to a few
   * ticks, so the game catches up smoothly once it does.
   */
  canStep?(): boolean;
}

/** Most ticks of backlog kept while waiting for the network. */
const MAX_STALLED_TICKS = 4;

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  /** Gameplay time scale (hit-stop/slow-mo use it). Rendering keeps running. */
  timeScale = 1;

  constructor(private readonly callbacks: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const frameDt = Math.min((now - this.lastTime) / 1000, MAX_FRAME_TIME);
    this.lastTime = now;

    this.accumulator += frameDt * this.timeScale;
    while (this.accumulator >= SIM_DT) {
      if (this.callbacks.canStep && !this.callbacks.canStep()) {
        this.accumulator = Math.min(this.accumulator, SIM_DT * MAX_STALLED_TICKS);
        break;
      }
      this.callbacks.fixedUpdate(SIM_DT);
      this.accumulator -= SIM_DT;
    }
    this.callbacks.render(frameDt, this.accumulator / SIM_DT);
    this.rafId = requestAnimationFrame(this.frame);
  };
}
