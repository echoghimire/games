import { createRoom, getRoom } from './api';
import { RoomClient, type Player, type RoomMessage } from './room';
import { el, esc, type GameUI } from './ui';

export interface LobbyOptions {
  game: string;
  ui: GameUI;
  /** Fewest humans needed before the host can start. */
  minPlayers: number;
  /** Colour per slot, for the player list. */
  colors: readonly string[];
  /** Short line under the room code, e.g. "Empty slots are filled with bots." */
  note?: string;
  /** Host pressed Start. */
  onHostStart(room: RoomClient): void;
  onMessage(room: RoomClient, msg: RoomMessage): void;
  /** Roster changed while a match is running (someone left). */
  onRoster?(room: RoomClient, players: Player[]): void;
  /** Room gone (host left / connection lost). */
  onClosed(reason: string): void;
}

/** Online room flow shared by Paint Clash and Curve Clash. */
export class Lobby {
  room: RoomClient | null = null;
  inMatch = false;

  constructor(private readonly o: LobbyOptions) {}

  async host(): Promise<void> {
    try {
      const { code } = await createRoom(this.o.game);
      await this.connect(code);
    } catch (err) {
      this.fail(err);
    }
  }

  async join(raw: string): Promise<void> {
    const code = raw.trim().toUpperCase();
    try {
      if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Room codes are 6 letters or numbers.');
      const info = await getRoom(code);
      if (info.game !== this.o.game) throw new Error('That code is for a different game.');
      if (!info.hostOnline) throw new Error('The host is not in that room right now.');
      if (info.full) throw new Error('That room is full.');
      await this.connect(code);
    } catch (err) {
      this.fail(err);
    }
  }

  leave(): void {
    this.room?.leave();
    this.room = null;
    this.inMatch = false;
    history.replaceState(null, '', location.pathname);
  }

  /** Show the lobby card again (after a match). */
  show(): void {
    this.inMatch = false;
    this.render();
  }

  private async connect(code: string): Promise<void> {
    this.o.ui.show({ kicker: 'ONLINE', title: 'Connecting…', buttons: [] });
    const room = new RoomClient(code, {
      onWelcome: () => this.render(),
      onRoster: (players) => {
        if (this.inMatch) this.o.onRoster?.(room, players);
        else this.render();
      },
      onMessage: (msg) => this.o.onMessage(room, msg),
      onClosed: (reason) => {
        this.room = null;
        this.inMatch = false;
        history.replaceState(null, '', location.pathname);
        this.o.onClosed(reason);
      },
    });
    this.room = room;
    history.replaceState(null, '', `${location.pathname}?room=${code}`);
    await room.connect();
  }

  private render(): void {
    const room = this.room;
    if (!room || this.inMatch) return;
    const body = document.createElement('div');
    el('div', 'room-code', body).textContent = room.code;
    const copy = el('button', 'btn', body);
    copy.textContent = 'Copy invite link';
    copy.style.marginTop = '8px';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?room=${room.code}`);
      this.o.ui.toast('Invite link copied');
    });
    if (this.o.note) {
      const p = el('p', '', body);
      p.style.marginTop = '12px';
      p.textContent = this.o.note;
    }
    const list = el('ul', 'players', body);
    for (const pl of room.players) {
      const li = el('li', '', list);
      const dot = el('i', '', li);
      dot.style.background = this.o.colors[pl.slot] ?? '#fff';
      li.insertAdjacentHTML('beforeend', `<span>${esc(pl.name)}${pl.host ? ' (host)' : ''}${pl.slot === room.slot ? ' · you' : ''}</span>`);
    }
    const enough = room.players.length >= this.o.minPlayers;
    const buttons = [];
    if (room.isHost) {
      buttons.push({
        label: enough ? 'Start match' : `Waiting for ${this.o.minPlayers - room.players.length} more…`,
        primary: true,
        onClick: () => {
          if (this.room && this.room.players.length >= this.o.minPlayers) this.o.onHostStart(this.room);
        },
      });
    }
    buttons.push({ label: 'Leave', onClick: () => this.o.onClosed('') });
    this.o.ui.show({
      kicker: 'ONLINE ROOM',
      title: room.isHost ? 'Invite your friends' : 'Waiting for the host…',
      body,
      buttons,
    });
    if (room.isHost && !enough) (document.querySelector('.card .btn--primary') as HTMLButtonElement | null)?.setAttribute('disabled', '');
  }

  private fail(err: unknown): void {
    this.leave();
    this.o.onClosed(err instanceof Error ? err.message : String(err));
  }
}

/** Reads ?room=CODE from the page URL (invite links). */
export const inviteCode = (): string | null => new URLSearchParams(location.search).get('room');
