# Iron Arena in Tronix Arena

This directory is **Iron Arena** by Andrea Acanfora
(https://github.com/AndreaAcanfora/iron-arena, commit ae37606), used and
modified **with the author's permission**. The original repository has no
open-source licence, so this code is **not** covered by an open-source licence
either: don't copy it into other projects without asking the author. Every
third-party asset is CC0; see [ASSETS.md](ASSETS.md).

## Changes for Tronix Arena

- **Online 1v1** (`src/net/`): delay-based lockstep. Each tick the local
  player's input is scheduled a few ticks ahead (chosen from the measured ping)
  and sent to the opponent through a two-player room on the arena Worker
  (`apps/arena/src/fightroom.js`). A tick only runs once both inputs are known,
  so both browsers simulate exactly the same fight. Every second both sides
  compare a checksum of the fighters' state to detect desyncs.
- `src/game/GameLoop.ts`: optional `canStep()` gate so the loop waits for the
  network instead of running ahead.
- `src/game/Game.ts`: online mode (lockstep inputs, either key layout for the
  local player, "YOU WIN" results, Esc leaves the room, rematch through the
  room), plus `window.__fighterDebug()` for tests.
- `src/ui/MenuScreen.ts`, `src/ui/OnlineScreen.ts`: host / join-by-code
  buttons and the online lobby (fighter picks, ready, invite link).
- `src/main.ts`: `/f/<CODE>` invite links join that room directly.
- `vite.config.ts`: builds into `apps/arena/public/fighter/`, served at `/fighter/`.

## Building

From the repository root: `npm run build:fighter` (also run automatically by
`npm run dev:arena` and `npm run deploy:arena`). `npm run dev:fighter` starts
the original standalone dev server (local play only; online needs the Worker).
