/**
 * WebSocket connection to an online room on the arena Worker
 * (`/api/fight/rooms/<code>/ws`). JSON text carries control messages; binary
 * frames carry inputs as three int32s: [match seq, tick, packed input].
 */
export type ControlMessage =
  | { t: 'hello'; role: 'host' | 'guest'; you: string; peer: string | null }
  | { t: 'peer'; joined: boolean; name: string; roomClosed?: boolean }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'pick'; fighter: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'start'; seq: number; p1: string; p2: string; delay: number }
  | { t: 'rematch' }
  | { t: 'sum'; seq: number; frame: number; hash: number }
  | { t: 'leave' };

export interface NetHandlers {
  onControl(msg: ControlMessage): void;
  onInput(seq: number, frame: number, packed: number): void;
  onClose(reason: string): void;
}

export class NetSession {
  private ws: WebSocket | null = null;
  private closedByUs = false;

  constructor(private readonly handlers: NetHandlers) {}

  connect(code: string): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/fight/rooms/${code}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    return new Promise((resolve, reject) => {
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data === 'string') {
          try {
            this.handlers.onControl(JSON.parse(e.data) as ControlMessage);
          } catch {
            // ignore malformed control messages
          }
        } else {
          const v = new Int32Array(e.data as ArrayBuffer);
          if (v.length === 3) this.handlers.onInput(v[0]!, v[1]!, v[2]!);
        }
      };
      ws.onclose = (e: CloseEvent) => {
        if (!opened) reject(new Error('Could not connect to the room.'));
        else if (!this.closedByUs) this.handlers.onClose(e.reason || 'Connection lost');
      };
    });
  }

  send(msg: ControlMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private readonly inputBuf = new Int32Array(3);

  sendInput(seq: number, frame: number, packed: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.inputBuf[0] = seq;
    this.inputBuf[1] = frame;
    this.inputBuf[2] = packed;
    this.ws.send(this.inputBuf);
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close(1000, 'leave');
    this.ws = null;
  }
}
