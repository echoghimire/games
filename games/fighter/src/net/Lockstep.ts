import { emptyFrame, type InputFrame } from '../input/Actions';
import type { InputSource } from '../input/InputSource';
import type { PlayerIndex } from '../game/GameEvents';

/** Packs an input frame into one number: held in the low 16 bits, pressed in the high 16. */
export const packInput = (f: InputFrame): number => (f.held & 0xffff) | ((f.pressed & 0xffff) << 16);
export const unpackInput = (v: number, out: InputFrame): void => {
  out.held = v & 0xffff;
  out.pressed = (v >>> 16) & 0xffff;
};

/**
 * Delay-based lockstep for two players.
 *
 * Both browsers run the same deterministic simulation. Each tick, the local
 * player's input is scheduled `delay` ticks into the future and sent to the
 * peer; a tick is only simulated once both players' inputs for it are known.
 * With enough delay to cover the network trip, neither side ever waits.
 */
export class Lockstep {
  /** Next tick to simulate. */
  frame = 0;
  private readonly local = new Map<number, number>();
  private readonly remote = new Map<number, number>();
  private readonly current: [InputFrame, InputFrame] = [emptyFrame(), emptyFrame()];
  private readonly localSample = emptyFrame();
  readonly sources: readonly [InputSource, InputSource];

  constructor(
    readonly localSlot: PlayerIndex,
    readonly delay: number,
    private readonly send: (frame: number, packed: number) => void,
  ) {
    // Nobody has pressed anything during the first `delay` ticks.
    for (let f = 0; f < delay; f++) {
      this.local.set(f, 0);
      this.remote.set(f, 0);
    }
    this.sources = [this.sourceFor(0), this.sourceFor(1)];
  }

  /** True when the peer's input for the next tick has arrived. */
  canStep(): boolean {
    return this.remote.has(this.frame);
  }

  /**
   * Advance one tick: sample the local player, schedule and send their input,
   * and expose both players' inputs for this tick through `sources`.
   * Only call when `canStep()` is true.
   */
  step(sampleLocal: (out: InputFrame) => void): void {
    sampleLocal(this.localSample);
    const target = this.frame + this.delay;
    const packed = packInput(this.localSample);
    this.local.set(target, packed);
    this.send(target, packed);

    const mine = this.local.get(this.frame) ?? 0;
    const theirs = this.remote.get(this.frame) ?? 0;
    this.local.delete(this.frame);
    this.remote.delete(this.frame);
    unpackInput(mine, this.current[this.localSlot]);
    unpackInput(theirs, this.current[this.localSlot === 0 ? 1 : 0]);
    this.frame++;
  }

  /** Input for `frame` arrived from the peer. */
  receive(frame: number, packed: number): void {
    if (frame >= this.frame) this.remote.set(frame, packed);
  }

  /** How many ticks of peer input are buffered ahead (for the "waiting" indicator). */
  get remoteLead(): number {
    let n = 0;
    while (this.remote.has(this.frame + n)) n++;
    return n;
  }

  private sourceFor(slot: PlayerIndex): InputSource {
    return {
      sample: (out: InputFrame) => {
        out.held = this.current[slot].held;
        out.pressed = this.current[slot].pressed;
      },
    };
  }
}

/** Picks an input delay (in 60 Hz ticks) from the measured round-trip time. */
export function delayForRtt(rttMs: number): number {
  const oneWayTicks = Math.ceil(rttMs / 2 / (1000 / 60));
  return Math.min(10, Math.max(3, oneWayTicks + 2));
}
