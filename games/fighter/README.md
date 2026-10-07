# Iron Arena

A 3D arcade fighting game (2.5D) for the browser, built with **Three.js + TypeScript + Vite**.
This is a playable vertical slice: two original fighters, a dark-fantasy arena, a frame-data combat system,
combos, grabs, rounds, VFX, audio and a full UI.

**Play online:** https://andreaacanfora.github.io/iron-arena/ (deployed by GitHub Actions on every push to `main`).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build in dist/
npm run typecheck
npm run fetch-assets   # re-download third-party CC0 assets (see ASSETS.md)
```

## Controls

| Action | Player 1 | Player 2 |
|---|---|---|
| Move | A / D | ← / → |
| Jump / Crouch | W / S | ↑ / ↓ |
| Light / Heavy / Kick | J / K / L | Num1 / Num2 / Num3 (or 1 / 2 / 3) |
| Block | I | Num5 (or 5) |
| Grab | U | Num4 (or 4) |

- Double-tap forward to **dash**. Keep holding forward to **run**.
- Double-tap back to **backdash**. Its first frames are strike-invulnerable, so it works as the dodge.
- Hold **Down** while attacking for crouching moves: low punch, uppercut launcher and sweep. Sweeps are **low**, so block them crouching.
- Jump attacks are **overheads**, so block them standing.
- Combos ("dial-a-combo", press the next button during the previous hit):
  - Brakk: `L L H` Skull Splitter, `L L K` Whirlwind
  - Vesna: `L L K` Viper Spin, `L K H` Ashfall
- Both fighters grabbing at the same moment breaks the grab.
- `Enter` starts the fight or a rematch. `Esc` goes back to the menu. `M` mutes. `F1` toggles the hitbox overlay.

## Architecture

```text
src/
  game/        Game (composition root), GameLoop (fixed 60 Hz step + interpolated render),
               GameState (app FSM), Match, RoundController, MatchRules, GameEvents
  core/        EventBus: typed pub/sub that decouples gameplay from audio/VFX/UI
  input/       Actions (bit flags), KeyBindings (rebindable data), InputManager, InputSource
  characters/  Fighter (gameplay FSM), Character (visual), AnimationController, AnimKeys,
               FighterConfig, fighters/ (roster data: brakk.ts, vesna.ts, kaykitShared.ts)
  combat/      types (AttackDefinition, ComboDefinition…), AttackSystem (frame phases, MoveList),
               Hitbox (2D shapes + overlap tests), Hurtbox, ComboSystem, CombatSystem
  camera/      FightCamera: side view, midpoint, distance zoom (clamped), sway, shake
  effects/     EffectManager, ParticleSystem (GPU points, pooled), HitEffect, ScreenShake
  audio/       AudioManager: Web Audio buses, event-driven SFX, music
  arena/       Arena (builder), ArenaConfig, arenas/emberKeep.ts (data)
  ui/          GameUI, HealthBar, RoundUI, CombatText, MenuScreen, ResultScreen
  assets/      AssetManager (GLTF/DRACO/HDR/texture/audio cache), AssetManifest
  render/      Renderer (WebGL setup, resize, adaptive resolution)
  debug/       HitboxDebug (F1), PoseViewer (dev only: /?poses=Clip@0.5,Other@1)
```

Key principles:

- **The simulation is deterministic and fixed-step.** `Fighter` and `CombatSystem` advance in 60 Hz ticks from
  `InputFrame` bitmasks and never touch Three.js. Rendering interpolates between ticks. This is the foundation
  for AI, replays and rollback netcode later.
- **Gameplay and presentation are separate.** Gameplay emits typed events (`hit`, `block`, `ko`, …).
  `EffectManager`, `AudioManager`, `GameUI` and the camera subscribe to them.
- **Everything is data-driven.** Fighters, attacks (startup/active/recovery, damage, hit/block stun, knockback,
  hitbox, height), grabs, combos, arenas, keybindings and match rules are plain typed objects.

## Extending

- **New fighter:** add a GLB to `public/assets/characters`, register it in `AssetManifest.MODELS`, write a
  `FighterConfig`. Copy `src/characters/fighters/vesna.ts` as a starting point and map its clips in `animations`.
  Then add it to `ROSTER`. The menu cards cycle through the roster automatically.
- **New attack:** add an `AttackDefinition` to the fighter's `attacks`. Each stance/button pair uses the first match.
  Attacks that are only combo finishers are referenced by id from `combos`.
- **New combo:** add a `ComboDefinition` (`inputs`, `finisher`, `damageMultiplier`).
- **Best of 3 / timer:** change `DEFAULT_RULES` in `src/game/MatchRules.ts` (`roundsToWin: 2`).
  The round pips and announcer already handle multiple rounds.
- **New arena:** write an `ArenaConfig` like `arenas/emberKeep.ts`.
- **AI / gamepad / network players:** implement `InputSource.sample(out: InputFrame)` and pass it to `Match`.
- **Rebinding:** `KeyBindings.ts` maps actions to `KeyboardEvent.code` arrays.

## Performance notes

- There is one shadow-casting directional light with a tight frustum (2048×1024 map). Torch lights don't cast shadows.
- Particles are point sprites with one draw call per system. They use fixed pools and typed arrays, so nothing is allocated per frame.
- Pixel ratio is capped at 2 and lowered automatically if FPS stays under 50.
- Shaders are precompiled before the first fight. Skeleton bone textures are disposed on rematch, so there are no texture leaks.
- A typical fight is about 60 draw calls and about 26k triangles.

## Assets

Every third-party asset is CC0. See [ASSETS.md](ASSETS.md) for sources, authors, licenses and alternatives.
No Mortal Kombat names, models or other content are used.
