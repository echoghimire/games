import { Action, type ActionName, type InputFrame } from './Actions';
import type { InputManager } from './InputManager';
import type { KeyBinding } from './KeyBindings';

/**
 * Anything that can drive a fighter: keyboard, gamepad, AI, network peer, replay.
 * Fighters only ever see InputFrames.
 */
export interface InputSource {
  sample(out: InputFrame): void;
}

export class KeyboardInputSource implements InputSource {
  private readonly entries: ReadonlyArray<readonly [number, readonly string[]]>;

  constructor(
    private readonly input: InputManager,
    binding: KeyBinding,
  ) {
    this.entries = (Object.keys(binding) as ActionName[]).map((name) => [Action[name], binding[name]] as const);
  }

  sample(out: InputFrame): void {
    let held = 0;
    let pressed = 0;
    for (const [bit, codes] of this.entries) {
      for (const code of codes) {
        if (this.input.isDown(code)) held |= bit;
        if (this.input.wasPressed(code)) pressed |= bit;
      }
    }
    out.held = held | pressed;
    out.pressed = pressed;
  }
}

/** Does nothing; used for disabled players and during cut-scenes. */
export class NullInputSource implements InputSource {
  sample(out: InputFrame): void {
    out.held = 0;
    out.pressed = 0;
  }
}
