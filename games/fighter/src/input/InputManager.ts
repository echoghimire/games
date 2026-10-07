/**
 * Raw keyboard state. Keys pressed between two simulation ticks are latched,
 * so a tap shorter than one tick is never lost.
 */
export class InputManager {
  private readonly down = new Set<string>();
  private readonly pressedSinceTick = new Set<string>();
  private readonly preventDefaultCodes = new Set<string>([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
  ]);

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressedSinceTick.has(code);
  }

  /** Call once per simulation tick, after every input source has sampled. */
  endTick(): void {
    this.pressedSinceTick.clear();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.preventDefaultCodes.has(e.code) || e.code.startsWith('Numpad')) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressedSinceTick.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
