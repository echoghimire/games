import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';
import { Arena } from '../arena/Arena';
import { AudioManager } from '../audio/AudioManager';
import { EMBER_KEEP } from '../arena/arenas/emberKeep';
import { FightCamera } from '../camera/FightCamera';
import type { FighterConfig } from '../characters/FighterConfig';
import { ROSTER } from '../characters/fighters';
import { EventBus } from '../core/EventBus';
import { HitboxDebug } from '../debug/HitboxDebug';
import { EffectManager } from '../effects/EffectManager';
import { InputManager } from '../input/InputManager';
import { KeyboardInputSource, NullInputSource } from '../input/InputSource';
import { PLAYER1_KEYS, PLAYER2_KEYS, type KeyBinding } from '../input/KeyBindings';
import type { Lockstep } from '../net/Lockstep';
import { OnlineController, type OnlineGame } from '../net/OnlineController';
import { Renderer } from '../render/Renderer';
import { GameUI } from '../ui/GameUI';
import type { GameEvents } from './GameEvents';
import { GameLoop } from './GameLoop';
import { GameStateMachine } from './GameState';
import { Match } from './Match';
import { DEFAULT_RULES, type MatchRules } from './MatchRules';
import { RoundController } from './RoundController';

const START_GAP = 3.6;

/** Online, the local player can use either keyboard layout. */
const ONLINE_KEYS = Object.fromEntries(
  (Object.keys(PLAYER1_KEYS) as (keyof KeyBinding)[]).map((k) => [k, [...PLAYER1_KEYS[k], ...PLAYER2_KEYS[k]]]),
) as unknown as KeyBinding;

/** FNV-1a over the fighters' gameplay state; both peers must agree every check. */
function hashState(match: Match, tick: number): number {
  const nums = new Float64Array(1 + match.fighters.length * 8);
  nums[0] = tick;
  match.fighters.forEach((f, i) => {
    const o = 1 + i * 8;
    nums[o] = f.x;
    nums[o + 1] = f.y;
    nums[o + 2] = f.vx;
    nums[o + 3] = f.vy;
    nums[o + 4] = f.health;
    nums[o + 5] = f.facing;
    nums[o + 6] = f.hitStop;
    nums[o + 7] = f.state.length * 31 + f.state.charCodeAt(0);
  });
  let h = 0x811c9dc5;
  for (const b of new Uint8Array(nums.buffer)) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}

/** Composition root: creates every system, wires them through the event bus and runs the state machine. */
export class Game implements OnlineGame {
  readonly roster = ROSTER;
  readonly online: OnlineController;
  private onlineLockstep: Lockstep | null = null;
  private readonly onlineKeys: KeyboardInputSource;
  readonly events = new EventBus<GameEvents>();
  private readonly renderer: Renderer;
  private readonly scene = new THREE.Scene();
  private readonly assets = new AssetManager();
  private readonly fightCamera = new FightCamera();
  private readonly loop: GameLoop;
  private readonly input = new InputManager();
  private readonly hitboxDebug = new HitboxDebug();
  private readonly states = new GameStateMachine();
  private readonly ui: GameUI;
  private readonly rules: MatchRules = DEFAULT_RULES;
  private readonly projectTmp = new THREE.Vector3();
  private arena: Arena | null = null;
  private effects: EffectManager | null = null;
  private audio: AudioManager | null = null;
  match: Match | null = null;
  round: RoundController | null = null;
  private lineup: [FighterConfig, FighterConfig];
  private resultDelay = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
  ) {
    const [first, second] = ROSTER;
    if (!first) throw new Error('Empty roster');
    this.lineup = [first, second ?? first];

    this.renderer = new Renderer({ canvas: this.canvas });
    this.renderer.attachCamera(this.fightCamera.camera);
    this.loop = new GameLoop({
      fixedUpdate: () => this.fixedUpdate(),
      render: (dt, alpha) => this.render(dt, alpha),
      canStep: () => !this.onlineLockstep || !this.states.is('match') || this.onlineLockstep.canStep(),
    });
    this.onlineKeys = new KeyboardInputSource(this.input, ONLINE_KEYS);
    this.scene.add(this.hitboxDebug.root);

    this.ui = new GameUI(uiRoot, this.events, (x, y) => this.project(x, y), ROSTER, {
      onStart: (p1, p2) => {
        this.audio?.uiConfirm();
        this.lineup = [p1, p2];
        this.states.go('match');
      },
      onNavigate: () => this.audio?.uiSelect(),
      onRematch: () => {
        this.audio?.uiConfirm();
        if (this.online.active) this.online.requestRematch();
        else this.states.go('match');
      },
      onMenu: () => {
        this.audio?.uiSelect();
        if (this.online.active) this.online.leave();
        else this.states.go('menu');
      },
      onHostOnline: () => {
        this.audio?.uiConfirm();
        this.ui.showMenu(false);
        void this.online.host();
      },
      onJoinOnline: (code) => {
        this.audio?.uiConfirm();
        this.ui.showMenu(false);
        void this.online.join(code);
      },
    });
    this.online = new OnlineController(uiRoot, this);

    this.states.onEnter('menu', () => this.enterMenu());
    this.states.onEnter('match', () => this.enterMatch());
    this.states.onEnter('result', () => this.enterResult());

    this.events.on('roundEnd', () => {
      if (this.round) this.ui.setWins(this.round.wins);
    });
    this.events.on('matchEnd', () => {
      this.resultDelay = 0.6;
    });
    this.events.on('hit', (e) => this.fightCamera.shake.add(e.attack.shake));
    this.events.on('throw', () => this.fightCamera.shake.add(0.5));
    this.events.on('ko', () => this.fightCamera.shake.add(0.8));

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') {
        e.preventDefault();
        this.hitboxDebug.toggle();
      }
      if (e.code === 'Escape' && this.states.is('match')) {
        // Online, Esc leaves the room; the opponent goes back to the lobby.
        if (this.online.active) this.online.leave();
        else this.states.go('menu');
      }
      if (e.code === 'KeyM') this.audio?.toggleMute();
    });
  }

  async init(): Promise<void> {
    await this.assets.loadAll((loaded, total) => this.ui.setLoading(loaded / total));
    this.arena = new Arena(EMBER_KEEP, this.assets);
    this.arena.build(this.scene, this.renderer.webgl);

    this.effects = new EffectManager(this.assets, this.events, this.arena.halfWidth);
    this.effects.setFireEmitters(this.arena.flameEmitters);
    this.scene.add(this.effects.root);

    this.audio = new AudioManager(this.arena.halfWidth);
    await this.audio.load(this.assets);
    this.audio.bind(this.events);
    this.audio.playMusic('musicBattle');
    // Compile shaders up-front to avoid a hitch on the first frame of the fight.
    this.createMatch(false);
    this.renderer.webgl.compile(this.scene, this.fightCamera.camera);
    this.ui.hideLoading();
    this.states.go('menu');
    this.loop.start();
  }

  // ------------------------------------------------------------- states

  private enterMenu(): void {
    this.ui.showHud(false);
    this.ui.hideResult();
    this.createMatch(false);
    this.ui.showMenu(true);
    this.audio?.setMusicLevel(0.45);
  }

  private enterMatch(): void {
    this.ui.showMenu(false);
    this.ui.hideResult();
    this.createMatch(true);
    this.ui.setupMatch(this.lineup, this.rules.roundsToWin);
    this.ui.showHud(true);
    this.round?.start();
  }

  private enterResult(): void {
    const winner = this.round?.matchWinner ?? null;
    const slot = this.online.localSlot;
    this.ui.showResult(winner, this.lineup, this.online.active ? (slot === 0 ? ['YOU', 'OPPONENT'] : ['OPPONENT', 'YOU']) : undefined);
  }

  // ------------------------------------------------------------- online

  startOnlineMatch(lineup: [FighterConfig, FighterConfig], lockstep: Lockstep): void {
    this.lineup = lineup;
    this.onlineLockstep = lockstep;
    this.resultDelay = 0;
    this.states.go('match');
  }

  stopOnlineMatch(): void {
    this.onlineLockstep = null;
    this.resultDelay = 0;
    this.ui.showHud(false);
    this.ui.hideResult();
    this.ui.showMenu(false);
    this.createMatch(false);
  }

  showMainMenu(): void {
    this.states.go('menu');
  }

  /** Opened from an invite link: skip the menu and join that room. */
  joinInvite(code: string): void {
    this.ui.showMenu(false);
    void this.online.join(code);
  }

  /** Snapshot for automated tests and debugging. */
  debugSnapshot(): object {
    return {
      state: this.states.state,
      online: this.online.active,
      tick: this.onlineLockstep?.frame ?? null,
      syncChecks: { ...this.online.syncChecks },
      round: this.round ? { phase: this.round.phase, wins: [...this.round.wins] } : null,
      fighters: this.match?.fighters.map((f) => ({ x: f.x, y: f.y, health: f.health, state: f.state })) ?? [],
    };
  }

  /** Builds a match for the current lineup. Without `playable`, it's the idle menu backdrop. */
  private createMatch(playable: boolean): void {
    const arena = this.arena;
    if (!arena) return;
    this.match?.dispose();
    this.match = new Match(
      {
        fighters: this.lineup,
        inputs: !playable
          ? [new NullInputSource(), new NullInputSource()]
          : this.onlineLockstep
            ? this.onlineLockstep.sources
            : [new KeyboardInputSource(this.input, PLAYER1_KEYS), new KeyboardInputSource(this.input, PLAYER2_KEYS)],
        stageHalfWidth: arena.halfWidth,
        startGap: START_GAP,
      },
      this.events,
      this.assets,
      this.scene,
    );
    this.round = playable ? new RoundController(this.match, this.rules, this.events) : null;
    this.effects?.clearTransient();
    this.match.resetPositions();
    this.match.render(0, 1);
    this.fightCamera.snap(this.match.focusA, this.match.focusB);
    this.loop.timeScale = 1;
  }

  // ------------------------------------------------------------- loop

  private fixedUpdate(): void {
    const match = this.match;
    const lockstep = this.onlineLockstep;
    const lockstepTick = lockstep !== null && this.states.is('match');
    // Online: both players' inputs for this tick come from the lockstep buffer.
    if (lockstepTick) lockstep.step((out) => this.onlineKeys.sample(out));
    if (match) {
      match.fixedUpdate();
      this.round?.update();
      this.loop.timeScale = this.round?.timeScale ?? 1;
    }
    if (lockstepTick && match) this.online.afterTick(lockstep.frame, () => hashState(match, lockstep.frame));
    this.input.endTick();
  }

  private render(dt: number, alpha: number): void {
    this.arena?.update(dt);
    if (this.effects) {
      this.effects.setViewport(this.renderer.webgl.domElement.clientHeight, this.fightCamera.camera);
      this.effects.update(dt);
    }
    const match = this.match;
    if (match) {
      match.render(dt, alpha);
      this.fightCamera.update(dt, match.focusA, match.focusB);
      this.hitboxDebug.update(match.fighters);
    }
    if (this.resultDelay > 0) {
      this.resultDelay -= dt;
      if (this.resultDelay <= 0 && this.states.is('match')) this.states.go('result');
    }
    this.ui.update(dt);
    const lockstep = this.onlineLockstep;
    this.online.update(dt, lockstep !== null && this.states.is('match') && !lockstep.canStep());
    this.renderer.render(this.scene, this.fightCamera.camera);
    this.renderer.adapt(dt);
  }

  private project(x: number, y: number): { x: number; y: number } {
    const v = this.projectTmp.set(x, y, 0).project(this.fightCamera.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }
}
