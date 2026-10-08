// Games with leaderboards, shared by the landing and arena Workers.
// cap: highest score accepted from the browser (sanity check).
// server: scores are recorded by the game server, not posted by browsers.

export const GAMES = [
  { id: 'smash', title: 'Tower Smash', unit: 'points', cap: 100000 },
  { id: 'flyer', title: 'Sky Dash', unit: 'gates', cap: 10000 },
  { id: 'pong', title: 'Curve Clash', unit: 'points', cap: 1000 },
  { id: 'paint', title: 'Paint Clash', unit: 'tiles', cap: 784 },
  { id: 'coil', title: 'Coil', unit: 'points', cap: 10000000 },
  { id: 'maze', title: 'Maze Rush', unit: 'mazes', cap: 200 },
  { id: 'siege', title: 'Ghost Siege', unit: 'points', cap: 10000000 },
  { id: 'drakonas', title: 'Drakonas', unit: 'points', cap: 10000000 },
  { id: 'neverball', title: 'Neverball', unit: 'coins', cap: 5000 },
  { id: 'wpilot', title: 'WPilot', unit: 'round wins', server: true },
]

export const GAME_BY_ID = Object.fromEntries(GAMES.map(g => [g.id, g]))
