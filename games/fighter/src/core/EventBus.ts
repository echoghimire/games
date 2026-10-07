/**
 * Minimal strongly typed pub/sub. Gameplay emits events; audio, VFX and UI
 * subscribe, so the simulation never depends on presentation code.
 */
export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as (payload: never) => void);
    return () => this.off(type, listener);
  }

  off<K extends keyof Events>(type: K, listener: (payload: Events[K]) => void): void {
    this.listeners.get(type)?.delete(listener as (payload: never) => void);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of set) (listener as (payload: Events[K]) => void)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
