import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPilotServer, MAX_PLAYERS } from '../apps/arena/src/wpilot/server.js'

// A fake socket that records what the server sends.
function socket() {
  return {
    sent: [],
    closed: false,
    send(text) {
      this.sent.push(JSON.parse(text))
    },
    close() {
      this.closed = true
    },
    ops() {
      return this.sent.map((m) => m[0])
    },
  }
}

// Runs the client side of the handshake: info -> connect -> join.
function joinPlayer(srv, user) {
  const ws = socket()
  const conn = srv.connect(ws, user)
  srv.message(conn, JSON.stringify([10]))
  srv.message(conn, JSON.stringify([17, '1.0']))
  srv.message(conn, JSON.stringify([18, { name: 'ignored', rate: 5000 }]))
  return { ws, conn }
}

test('players join with their arena name, not the one the client sends', () => {
  const srv = new WPilotServer()
  try {
    const a = joinPlayer(srv, { id: 'u1', name: 'Ace' })
    const b = joinPlayer(srv, { id: 'u2', name: 'Ace' })
    assert.deepEqual(a.ws.ops().slice(0, 3), [11, 14, 15])
    assert.equal(srv.info().players, 2)
    assert.deepEqual(srv.info().names.sort(), ['Ace', 'Ace 2'])
    // Renaming is ignored.
    srv.message(a.conn, JSON.stringify([2, [20, 'name', 'Hacker']]))
    assert.ok(!srv.info().names.includes('Hacker'))
  } finally {
    srv.stop()
  }
})

test('bad messages drop the connection; bad input values are ignored', () => {
  const srv = new WPilotServer()
  try {
    const a = joinPlayer(srv, { id: 'u1', name: 'Ace' })
    srv.message(a.conn, JSON.stringify([2, [19, 3, 'NaN']]))
    srv.message(a.conn, JSON.stringify([2, [19, 99, 0]]))
    assert.equal(a.conn.player.action, 0)
    srv.message(a.conn, '{not json')
    assert.ok(a.ws.closed)
    assert.equal(srv.info().players, 0)
    assert.equal(srv.gameloop, null) // nobody left, so the loop stops
  } finally {
    srv.stop()
  }
})

test('rooms are capped and leaving frees the slot', () => {
  const srv = new WPilotServer()
  try {
    const players = []
    for (let i = 0; i < MAX_PLAYERS; i++) players.push(joinPlayer(srv, { id: 'u' + i, name: 'P' + i }))
    const extra = joinPlayer(srv, { id: 'x', name: 'Late' })
    assert.ok(extra.ws.closed)
    assert.equal(srv.info().players, MAX_PLAYERS)
    srv.closed(players[0].conn)
    assert.equal(srv.info().players, MAX_PLAYERS - 1)
  } finally {
    srv.stop()
  }
})
