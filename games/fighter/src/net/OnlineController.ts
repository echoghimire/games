import type { FighterConfig } from '../characters/FighterConfig';
import type { PlayerIndex } from '../game/GameEvents';
import { el } from '../ui/dom';
import { OnlineScreen } from '../ui/OnlineScreen';
import { delayForRtt, Lockstep } from './Lockstep';
import { NetSession, type ControlMessage } from './NetSession';

/** What the online flow needs from the game. */
export interface OnlineGame {
  readonly roster: readonly FighterConfig[];
  /** Start a match driven by `lockstep`. The lineup is [host, guest]. */
  startOnlineMatch(lineup: [FighterConfig, FighterConfig], lockstep: Lockstep): void;
  /** Abort the current online match (if any) and show the idle backdrop. */
  stopOnlineMatch(): void;
  /** Back to the local main menu. */
  showMainMenu(): void;
}

type Phase = 'idle' | 'connecting' | 'lobby' | 'match';

const PING_INTERVAL_MS = 1000;
const CHECKSUM_EVERY = 60;

/**
 * Runs an online match end to end: creating/joining a room, the lobby
 * (fighter picks, ready), starting matches and rematches in lockstep on both
 * sides, and desync detection.
 */
export class OnlineController {
  private phase: Phase = 'idle';
  private net: NetSession | null = null;
  private readonly screen: OnlineScreen;
  private readonly toastEl: HTMLDivElement;
  private readonly waitEl: HTMLDivElement;
  private toastTimer = 0;

  private role: 'host' | 'guest' = 'host';
  private myName = 'You';
  private peerName: string | null = null;
  private myPick = 0;
  private peerPick: number | null = null;
  private myReady = false;
  private peerReady = false;
  private myRematch = false;
  private peerRematch = false;
  private seq = 0;
  lockstep: Lockstep | null = null;
  private readonly sums = new Map<number, number>();
  private readonly peerSums = new Map<number, number>();
  private rtts: number[] = [];
  /** Checksum comparisons with the peer this match (for the debug overlay and tests). */
  readonly syncChecks = { ok: 0, bad: 0 };
  private pingTimer = 0;
  private stalledFor = 0;

  constructor(
    uiRoot: HTMLElement,
    private readonly game: OnlineGame,
  ) {
    this.screen = new OnlineScreen(uiRoot, {
      onPick: (d) => this.pick(d),
      onReady: () => this.toggleReady(),
      onLeave: () => this.leave(),
    });
    this.toastEl = el('div', 'online-toast', '', uiRoot);
    this.waitEl = el('div', 'online-wait', 'Waiting for opponent…', uiRoot);
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  get inMatch(): boolean {
    return this.phase === 'match' && this.lockstep !== null;
  }

  get localSlot(): PlayerIndex {
    return this.role === 'host' ? 0 : 1;
  }

  // ---------------------------------------------------------------- entry points

  async host(): Promise<void> {
    if (this.active) return;
    this.phase = 'connecting';
    try {
      const res = await fetch('/api/fight/rooms', { method: 'POST', headers: { 'content-type': 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !body.code) throw new Error(body.error ?? `Could not create a room (${res.status}).`);
      await this.connect(body.code);
    } catch (err) {
      this.fail(err);
    }
  }

  async join(rawCode: string): Promise<void> {
    if (this.active) return;
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      this.toast('Room codes are 6 letters or numbers.');
      return;
    }
    this.phase = 'connecting';
    try {
      const res = await fetch(`/api/fight/rooms/${code}`);
      const info = (await res.json().catch(() => ({}))) as { error?: string; hostOnline?: boolean; full?: boolean };
      if (!res.ok) throw new Error(info.error ?? 'Room not found.');
      if (!info.hostOnline) throw new Error('The host is not in that room right now.');
      if (info.full) throw new Error('That room already has two players.');
      await this.connect(code);
    } catch (err) {
      this.fail(err);
    }
  }

  /** Leave the room and go back to the local main menu. */
  leave(): void {
    this.net?.send({ t: 'leave' });
    this.net?.close();
    this.reset();
    this.game.stopOnlineMatch();
    this.game.showMainMenu();
  }

  requestRematch(): void {
    if (this.phase !== 'match') return;
    this.myRematch = true;
    this.net?.send({ t: 'rematch' });
    this.toast(this.peerRematch ? 'Starting rematch…' : 'Rematch requested. Waiting for your opponent…', 4000);
    this.maybeStartRematch();
  }

  /** Called by the game after every simulated online tick. */
  afterTick(frame: number, hash: () => number): void {
    if (frame % CHECKSUM_EVERY !== 0) return;
    const h = hash();
    this.sums.set(frame, h);
    this.net?.send({ t: 'sum', seq: this.seq, frame, hash: h });
    this.compareSum(frame);
  }

  /** Called every rendered frame; shows a hint if the peer's inputs stop arriving. */
  update(dt: number, stalled: boolean): void {
    this.stalledFor = stalled ? this.stalledFor + dt : 0;
    this.waitEl.classList.toggle('online-wait--on', this.inMatch && this.stalledFor > 0.3);
  }

  // ---------------------------------------------------------------- connection

  private async connect(code: string): Promise<void> {
    this.net = new NetSession({
      onControl: (m) => this.onControl(m),
      onInput: (seq, frame, packed) => {
        if (seq === this.seq) this.lockstep?.receive(frame, packed);
      },
      onClose: (reason) => {
        this.reset();
        this.game.stopOnlineMatch();
        this.game.showMainMenu();
        this.toast(reason === 'host left' ? 'The host closed the room.' : `Disconnected: ${reason}`, 5000);
      },
    });
    this.screen.setRoom(code, `${location.origin}/f/${code}`);
    this.screen.setStatus('Connecting…');
    this.screen.show(true);
    history.replaceState(null, '', `/f/${code}`);
    await this.net.connect(code);
    this.pingTimer = window.setInterval(() => this.net?.send({ t: 'ping', ts: performance.now() }), PING_INTERVAL_MS);
  }

  private onControl(m: ControlMessage): void {
    switch (m.t) {
      case 'hello':
        this.role = m.role;
        this.myName = m.you;
        this.peerName = m.peer;
        this.phase = 'lobby';
        if (this.peerName) this.sendLobbyState();
        this.refreshLobby();
        break;
      case 'peer':
        if (m.joined) {
          this.peerName = m.name;
          this.sendLobbyState();
          this.toast(`${m.name} joined the room.`);
        } else {
          const wasInMatch = this.phase === 'match';
          this.peerName = null;
          this.peerPick = null;
          this.peerReady = false;
          this.myReady = false;
          if (wasInMatch) {
            this.endMatch();
            this.game.stopOnlineMatch();
          }
          this.toast(`${m.name} left the room.`, 4000);
          this.showLobby();
        }
        this.refreshLobby();
        break;
      case 'ping':
        this.net?.send({ t: 'pong', ts: m.ts });
        break;
      case 'pong':
        this.rtts.push(performance.now() - m.ts);
        if (this.rtts.length > 8) this.rtts.shift();
        this.refreshLobby();
        break;
      case 'pick':
        this.peerPick = Math.max(0, this.game.roster.findIndex((f) => f.id === m.fighter));
        this.refreshLobby();
        break;
      case 'ready':
        this.peerReady = m.ready;
        this.refreshLobby();
        this.maybeStart();
        break;
      case 'start':
        if (this.role === 'guest') this.begin(m.seq, m.p1, m.p2, m.delay);
        break;
      case 'rematch':
        this.peerRematch = true;
        if (!this.myRematch) this.toast(`${this.peerName ?? 'Your opponent'} wants a rematch. Press REMATCH.`, 5000);
        this.maybeStartRematch();
        break;
      case 'sum':
        if (m.seq === this.seq) {
          this.peerSums.set(m.frame, m.hash);
          this.compareSum(m.frame);
        }
        break;
      case 'leave':
        break;
    }
  }

  // ---------------------------------------------------------------- lobby

  private pick(delta: number): void {
    if (this.myReady) return;
    const n = this.game.roster.length;
    this.myPick = (this.myPick + delta + n) % n;
    this.net?.send({ t: 'pick', fighter: this.game.roster[this.myPick]!.id });
    this.refreshLobby();
  }

  private toggleReady(): void {
    if (!this.peerName) return;
    this.myReady = !this.myReady;
    this.net?.send({ t: 'ready', ready: this.myReady });
    this.refreshLobby();
    this.maybeStart();
  }

  private sendLobbyState(): void {
    this.net?.send({ t: 'pick', fighter: this.game.roster[this.myPick]!.id });
    this.net?.send({ t: 'ready', ready: this.myReady });
  }

  private get rtt(): number {
    if (this.rtts.length === 0) return 100;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  private refreshLobby(): void {
    const roster = this.game.roster;
    this.screen.setCard(0, roster[this.myPick] ?? null, `${this.myName} (YOU)`, this.myReady);
    this.screen.setCard(
      1,
      this.peerName && this.peerPick !== null ? (roster[this.peerPick] ?? null) : null,
      this.peerName ?? 'OPPONENT',
      this.peerReady,
    );
    this.screen.setPickEnabled(!this.myReady);
    if (!this.peerName) {
      this.screen.setStatus(
        this.role === 'host'
          ? 'Send the room code or invite link to your opponent. Waiting for them to join…'
          : 'Connecting…',
      );
      this.screen.setReadyButton('READY', false);
      return;
    }
    const ping = this.rtts.length ? ` · ping ${Math.round(this.rtt)} ms` : '';
    if (this.myReady && this.peerReady) this.screen.setStatus(`Both ready. Starting…${ping}`);
    else if (this.myReady) this.screen.setStatus(`Waiting for ${this.peerName} to get ready…${ping}`);
    else this.screen.setStatus(`Pick your fighter and press READY.${ping}`);
    this.screen.setReadyButton(this.myReady ? 'NOT READY' : 'READY', true);
  }

  private showLobby(): void {
    this.phase = 'lobby';
    this.myRematch = this.peerRematch = false;
    this.refreshLobby();
    this.screen.show(true);
  }

  // ---------------------------------------------------------------- match start

  /** Host only: start once both players are ready. */
  private maybeStart(): void {
    if (this.role !== 'host' || this.phase !== 'lobby' || !this.myReady || !this.peerReady) return;
    this.hostStart(this.myPick, this.peerPick ?? 0);
  }

  private maybeStartRematch(): void {
    if (this.role !== 'host' || this.phase !== 'match' || !this.myRematch || !this.peerRematch) return;
    this.hostStart(this.myPick, this.peerPick ?? 0);
  }

  private hostStart(hostPick: number, guestPick: number): void {
    const roster = this.game.roster;
    const p1 = roster[hostPick]!.id;
    const p2 = roster[guestPick]!.id;
    const seq = this.seq + 1;
    const delay = delayForRtt(this.rtt);
    this.net?.send({ t: 'start', seq, p1, p2, delay });
    this.begin(seq, p1, p2, delay);
  }

  private begin(seq: number, p1: string, p2: string, delay: number): void {
    const find = (id: string): FighterConfig => this.game.roster.find((f) => f.id === id) ?? this.game.roster[0]!;
    this.seq = seq;
    this.sums.clear();
    this.peerSums.clear();
    this.syncChecks.ok = this.syncChecks.bad = 0;
    this.myReady = this.peerReady = false;
    this.myRematch = this.peerRematch = false;
    this.phase = 'match';
    this.lockstep = new Lockstep(this.localSlot, delay, (frame, packed) => this.net?.sendInput(seq, frame, packed));
    this.screen.show(false);
    this.game.startOnlineMatch([find(p1), find(p2)], this.lockstep);
  }

  private endMatch(): void {
    this.lockstep = null;
    this.waitEl.classList.remove('online-wait--on');
  }

  private compareSum(frame: number): void {
    const mine = this.sums.get(frame);
    const theirs = this.peerSums.get(frame);
    if (mine === undefined || theirs === undefined) return;
    this.sums.delete(frame);
    this.peerSums.delete(frame);
    if (mine === theirs) this.syncChecks.ok++;
    else this.syncChecks.bad++;
    if (mine !== theirs) {
      console.error(`[online] desync at tick ${frame}: ${mine} vs ${theirs}`);
      this.toast('Out of sync with your opponent. Finish the round, then rematch.', 6000);
    }
  }

  // ---------------------------------------------------------------- helpers

  private reset(): void {
    window.clearInterval(this.pingTimer);
    this.endMatch();
    this.net = null;
    this.phase = 'idle';
    this.peerName = null;
    this.peerPick = null;
    this.myReady = this.peerReady = false;
    this.myRematch = this.peerRematch = false;
    this.rtts = [];
    this.screen.show(false);
    history.replaceState(null, '', '/fighter');
  }

  private fail(err: unknown): void {
    this.net?.close();
    this.reset();
    this.game.showMainMenu();
    this.toast(err instanceof Error ? err.message : String(err), 5000);
  }

  toast(text: string, ms = 3000): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('online-toast--on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('online-toast--on'), ms);
  }
}
