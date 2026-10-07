// One Durable Object per mini-game online room (Paint Clash: up to 4
// players, Curve Clash: 2). The host's browser runs the game; this object
// relays JSON messages between players and keeps the roster.
//
// Players send JSON text: { t: 'type', to?: slot, ...payload }. The room
// adds `from` (the sender's slot) and forwards it to `to`, or to everyone
// else when `to` is missing. The room itself sends:
//   { t: 'welcome', slot, host, game, max, players }   on connect
//   { t: 'roster', players }                          when someone joins/leaves
//   { t: 'closed' }                                   when the host leaves

import { DurableObject } from 'cloudflare:workers'

const ROOM_TTL_MS = 6 * 60 * 60 * 1000
const MAX_MESSAGES_PER_SECOND = 120
const MAX_MESSAGE_BYTES = 16 * 1024

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export class PartyRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.rates = new Map()
  }

  players() {
    return this.ctx
      .getWebSockets()
      .map(ws => ws.deserializeAttachment())
      .filter(Boolean)
      .map(a => ({ slot: a.slot, name: a.name, host: a.slot === 0 }))
      .sort((a, b) => a.slot - b.slot)
  }

  broadcast(msg, except) {
    const text = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) {
        try {
          ws.send(text)
        } catch {}
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url)
    const userId = request.headers.get('x-user-id')
    const userName = request.headers.get('x-user-name') || 'Player'

    if (url.pathname === '/init' && request.method === 'POST') {
      const existing = await this.ctx.storage.get('room')
      if (existing && !existing.closed) return jsonResponse({ error: 'taken' }, 409)
      const { code, hostUserId, hostName, game, max } = await request.json()
      await this.ctx.storage.put('room', { code, hostUserId, hostName, game, max, closed: false, createdAt: Date.now() })
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS)
      return jsonResponse({ code }, 201)
    }

    const room = await this.ctx.storage.get('room')
    if (!room || room.closed) return jsonResponse({ error: 'Room not found or already over.' }, 404)
    const players = this.players()
    const hostOnline = players.some(p => p.host)

    if (url.pathname === '/info') {
      return jsonResponse({
        code: room.code,
        game: room.game,
        hostName: room.hostName,
        hostOnline,
        players,
        max: room.max,
        full: players.length >= room.max,
      })
    }

    if (url.pathname === '/ws') {
      let slot
      if (userId === room.hostUserId && !hostOnline) slot = 0
      else if (!hostOnline) return jsonResponse({ error: 'The host is not in the room yet.' }, 409)
      else {
        const taken = new Set(players.map(p => p.slot))
        for (let s = 1; s < room.max; s++) {
          if (!taken.has(s)) {
            slot = s
            break
          }
        }
        if (slot === undefined) return jsonResponse({ error: 'This room is full.' }, 409)
      }

      const [client, server] = Object.values(new WebSocketPair())
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment({ slot, name: userName })
      const roster = this.players()
      server.send(JSON.stringify({ t: 'welcome', slot, host: slot === 0, game: room.game, max: room.max, players: roster }))
      this.broadcast({ t: 'roster', players: roster }, server)
      return new Response(null, { status: 101, webSocket: client })
    }

    return jsonResponse({ error: 'Not found' }, 404)
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES || !this.allow(ws)) return
    let msg
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return
    const me = ws.deserializeAttachment()
    msg.from = me.slot // never trust a sender-supplied slot
    const text = JSON.stringify(msg)
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue
      if (typeof msg.to === 'number' && other.deserializeAttachment()?.slot !== msg.to) continue
      try {
        other.send(text)
      } catch {}
    }
  }

  async webSocketClose(ws) {
    await this.onLeave(ws)
  }

  async webSocketError(ws) {
    await this.onLeave(ws)
  }

  async onLeave(ws) {
    this.rates.delete(ws)
    const me = ws.deserializeAttachment()
    try {
      ws.close(1000, 'bye')
    } catch {}
    if (me?.slot === 0) {
      const room = await this.ctx.storage.get('room')
      if (room) {
        room.closed = true
        await this.ctx.storage.put('room', room)
      }
      this.broadcast({ t: 'closed' }, ws)
      for (const o of this.ctx.getWebSockets()) {
        if (o !== ws) {
          try {
            o.close(1001, 'host left')
          } catch {}
        }
      }
      return
    }
    this.broadcast({ t: 'roster', players: this.players().filter(p => p.slot !== me?.slot) }, ws)
  }

  allow(ws) {
    const now = Date.now()
    let r = this.rates.get(ws)
    if (!r || now - r.start >= 1000) {
      r = { start: now, count: 0 }
      this.rates.set(ws, r)
    }
    return ++r.count <= MAX_MESSAGES_PER_SECOND
  }

  async alarm() {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS)
      return
    }
    await this.ctx.storage.deleteAll()
  }
}
