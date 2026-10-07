import * as THREE from 'three';
import type { AssetManager } from '../assets/AssetManager';
import { Character } from '../characters/Character';
import { Fighter } from '../characters/Fighter';
import type { FighterConfig } from '../characters/FighterConfig';
import { CombatSystem } from '../combat/CombatSystem';
import type { EventBus } from '../core/EventBus';
import { emptyFrame, type InputFrame } from '../input/Actions';
import type { InputSource } from '../input/InputSource';
import type { GameEvents } from './GameEvents';

export interface MatchSetup {
  readonly fighters: readonly [FighterConfig, FighterConfig];
  readonly inputs: readonly [InputSource, InputSource];
  readonly stageHalfWidth: number;
  readonly startGap: number;
}

/** Owns the two fighters, their visuals and the combat resolution for one match. */
export class Match {
  readonly fighters: readonly [Fighter, Fighter];
  readonly characters: readonly [Character, Character];
  readonly combat: CombatSystem;
  private readonly frames: [InputFrame, InputFrame] = [emptyFrame(), emptyFrame()];
  readonly focusA = new THREE.Vector3();
  readonly focusB = new THREE.Vector3();

  constructor(
    private readonly setup: MatchSetup,
    events: EventBus<GameEvents>,
    assets: AssetManager,
    scene: THREE.Scene,
  ) {
    const ctx = { events, stageHalfWidth: setup.stageHalfWidth };
    this.fighters = [new Fighter(0, setup.fighters[0], ctx), new Fighter(1, setup.fighters[1], ctx)];
    this.characters = [new Character(this.fighters[0], assets), new Character(this.fighters[1], assets)];
    for (const c of this.characters) scene.add(c.root);
    this.combat = new CombatSystem(events, () => setup.stageHalfWidth);
  }

  /** Place fighters at their start marks. */
  resetPositions(): void {
    const g = this.setup.startGap / 2;
    this.fighters[0].reset(-g, 1);
    this.fighters[1].reset(g, -1);
  }

  setInputEnabled(enabled: boolean): void {
    for (const f of this.fighters) f.inputEnabled = enabled;
  }

  fixedUpdate(): void {
    const [a, b] = this.fighters;
    this.setup.inputs[0].sample(this.frames[0]);
    this.setup.inputs[1].sample(this.frames[1]);
    a.update(this.frames[0], b);
    b.update(this.frames[1], a);
    this.combat.step(a, b);
  }

  render(frameDt: number, alpha: number): void {
    for (const c of this.characters) c.sync(frameDt, alpha);
    const [a, b] = this.characters;
    this.focusA.copy(a.root.position);
    this.focusB.copy(b.root.position);
  }

  dispose(): void {
    for (const c of this.characters) c.dispose();
  }
}
