/**
 * Client for a PartyRoom (apps/arena/src/partyroom.js). Messages are JSON;
 * the room stamps `from` with the sender's slot and routes `to` if set.
 */
export interface Player {
  slot: number;
  name: string;
  host: boolean;
}

export type RoomMessage = { t: string; from?: number; to?: number; [k: string]: unknown };

export interface RoomHandlers {
  onWelcome(slot: number, players: Player[]): void;
  onRoster(players: Player[]): void;
  onMessage(msg: RoomMessage): void;
  onClosed(reason: string): void;
}

export class RoomClient {
  private ws: WebSocket | null = null;
  private leaving = false;
  slot = -1;
  players: Player[] = [];

  constructor(
    readonly code: string,
    private readonly handlers: RoomHandlers,
  ) {}

  get isHost(): boolean {
    return this.slot === 0;
  }

  connect(): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/party/rooms/${this.code}/ws`);
    this.ws = ws;
    return new Promise((resolve, reject) => {
      let welcomed = false;
      ws.onmessage = (e) => {
        let msg: RoomMessage;
        try {
          msg = JSON.parse(e.data as string) as RoomMessage;
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          welcomed = true;
          this.slot = msg['slot'] as number;
          this.players = msg['players'] as Player[];
          this.handlers.onWelcome(this.slot, this.players);
          resolve();
        } else if (msg.t === 'roster') {
          this.players = msg['players'] as Player[];
          this.handlers.onRoster(this.players);
        } else if (msg.t === 'closed') {
          this.handlers.onClosed('The host closed the room.');
        } else {
          this.handlers.onMessage(msg);
        }
      };
      ws.onclose = (e) => {
        if (!welcomed) reject(new Error('Could not join that room.'));
        else if (!this.leaving) this.handlers.onClosed(e.reason === 'host left' ? 'The host closed the room.' : 'Connection lost.');
      };
    });
  }

  send(msg: RoomMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  leave(): void {
    this.leaving = true;
    this.ws?.close(1000, 'leave');
  }
}
