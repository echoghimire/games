/** Top-level application states. */
export type GameStateName = 'loading' | 'menu' | 'match' | 'result';

/** Minimal state holder with transition logging and enter callbacks. */
export class GameStateMachine {
  private current: GameStateName = 'loading';
  private readonly enterHandlers = new Map<GameStateName, (from: GameStateName) => void>();

  get state(): GameStateName {
    return this.current;
  }

  onEnter(state: GameStateName, handler: (from: GameStateName) => void): void {
    this.enterHandlers.set(state, handler);
  }

  go(next: GameStateName): void {
    const from = this.current;
    this.current = next;
    this.enterHandlers.get(next)?.(from);
  }

  is(state: GameStateName): boolean {
    return this.current === state;
  }
}
