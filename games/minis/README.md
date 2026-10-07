# Tronix Arena arcade games

Small games (Three.js and Canvas 2D, TypeScript, Vite), built into
`apps/arena/public/play/` and served behind the paywall at `/play/<game>/`.

| Game | Page | Online | Leaderboard |
|---|---|---|---|
| Paint Clash | `paint/` | 2–4 players, bots fill empty slots | tiles painted vs bots |
| Tower Smash | `smash/` | – | score |
| Curve Clash | `pong/` | 1v1 (first to 7) | points vs CPU |
| Sky Dash | `flyer/` | – | gates |
| Ghost Siege | `siege/` | – | score (tower defense, Casmo's MIT models) |
| Drakonas | `drakonas/` | – | score (shoot-'em-up, Casmo's MIT models) |

Adopted open-source games live in `public/` as plain files (Vite copies them as-is):

| Game | Page | Source | Leaderboard |
|---|---|---|---|
| Coil | `public/coil/` | hakimel/coil (MIT), trackers removed | score |
| Maze Rush | `public/maze/` | wwwtyro/Astray (public domain) + 3-minute timer, touch | mazes cleared |
| WPilot | `public/wpilot/` | jfd/wpilot client (MIT), new lobby, touch buttons | round wins (server-side) |

`public/tronix-hook.js` gives these plain pages the Arena bar (`Tronix.bar`) and the
leaderboard card (`Tronix.submit`). WPilot's game server is a port of `wpilots.js` in
`apps/arena/src/wpilot/` running in the `WPilotRoom` Durable Object: one public room
(`PUBLIC`) plus private rooms by code, simulated at 60 Hz while anyone is connected.

- `shared/ui.ts`: top bar, overlay cards, game-over card with the leaderboard.
- `shared/api.ts`: `/api/scores/<game>` and `/api/party/rooms` on the arena Worker.
- `shared/room.ts`, `shared/lobby.ts`: online rooms (`PartyRoom` Durable Object in
  `apps/arena/src/partyroom.js`), invite links `?room=CODE`.
- `shared/input.ts`: keyboard, hold/tap (mouse, touch, Space) and a touch joystick.

Online model: the host's browser runs the authoritative simulation (Curve Clash ball,
Paint Clash bots/bombs/timer/board); each player owns their own paddle or painter so
their own movement has no lag. Paint Clash sends the full board every second to keep
everyone identical.

Scores are reported by the browser, so a determined player could fake one with dev
tools. The server rejects impossible values; add server-side validation (replays or
signed runs) if leaderboard prizes ever matter.

Build: `npm run build:minis` (run automatically by `dev:arena` and `deploy:arena`).
The original games draw all art in code. Third-party assets (`public/siege-assets/`,
`public/drakonas-assets/`) carry their MIT licence files.
