// One Durable Object per WPilot room: the public arena ("PUBLIC") or a
// private room code. Unlike the other rooms, this one runs the game itself:
// the WPilot server (wpilot/server.js) simulates the world at 60 Hz while
// anyone is connected and streams state to every pilot.
//
// The sockets are not hibernatable on purpose: the game loop keeps the object
// awake while people play, and it stops (letting the object sleep) as soon as
// the last pilot leaves.

import { DurableObject } from 'cloudflare:workers'
import { WPilotServer } from './wpilot/server.js'
import { withScoresTable } from './scores.js'

const MAX_MESSAGES_PER_SECOND = 200
const MAX_MESSAGE_BYTES = 4 * 1024

export class WPilotRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.server = new WPilotServer({
      name: 'Tronix Arena',
      onRoundWon: (winners) => this.recordWins(winners),
    })
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/info') {
      return new Response(JSON.stringify(this.server.info()), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    if (url.pathname !== '/ws' || request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Not found', { status: 404 })
    }

    const user = { id: request.headers.get('x-user-id'), name: request.headers.get('x-user-name') || 'Pilot' }
    const { 0: client, 1: socket } = new WebSocketPair()
    socket.accept()
    const conn = this.server.connect(socket, user)

    let windowStart = Date.now()
    let count = 0
    socket.addEventListener('message', (event) => {
      const now = Date.now()
      if (now - windowStart >= 1000) {
        windowStart = now
        count = 0
      }
      if (++count > MAX_MESSAGES_PER_SECOND) return this.server.kill(conn, 'Too many messages')
      if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_BYTES) {
        return this.server.kill(conn, 'Bad message')
      }
      this.server.message(conn, event.data)
    })
    socket.addEventListener('close', () => this.server.closed(conn))
    socket.addEventListener('error', () => this.server.closed(conn))

    return new Response(null, { status: 101, webSocket: client })
  }

  // Round wins go on the WPilot leaderboard (one point per round won).
  recordWins(winners) {
    if (!this.env.DB) return
    const now = Math.floor(Date.now() / 1000)
    const stmt = this.env.DB.prepare(
      `INSERT INTO scores (game, user_id, name, best, updated_at) VALUES ('wpilot', ?1, ?2, 1, ?3)
       ON CONFLICT (game, user_id) DO UPDATE SET best = best + 1, name = excluded.name, updated_at = excluded.updated_at`,
    )
    const writes = winners.filter((w) => w.userId).map((w) => stmt.bind(w.userId, w.name, now))
    if (writes.length) {
      this.ctx.waitUntil(withScoresTable(this.env, () => this.env.DB.batch(writes)).catch((err) => console.error(err)))
    }
  }
}
