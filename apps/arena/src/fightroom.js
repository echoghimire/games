// One Durable Object per Iron Arena online match (exactly two players).
// The fight runs in both browsers in lockstep; this object only relays
// messages between the two sockets and tells each side who is connected.
//
// Messages from the room (JSON text):
//   { t: 'hello', role: 'host' | 'guest', you, peer }   on connect
//   { t: 'peer', joined: true | false, name }            when the other side joins/leaves
// Anything a player sends (JSON text or binary input frames) is forwarded
// verbatim to the other player.

import { DurableObject } from 'cloudflare:workers'

const ROOM_TTL_MS = 6 * 60 * 60 * 1000
const MAX_MESSAGES_PER_SECOND = 240 // 60 input frames/s plus control messages

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export class FightRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.rates = new Map()
  }

  async fetch(request) {
    const url = new URL(request.url)
    const userId = request.headers.get('x-user-id')
    const userName = request.headers.get('x-user-name') || 'Player'

    if (url.pathname === '/init' && request.method === 'POST') {
      const existing = await this.ctx.storage.get('room')
      if (existing && !existing.closed) return jsonResponse({ error: 'taken' }, 409)
      const { code, hostUserId, hostName } = await request.json()
      await this.ctx.storage.put('room', { code, hostUserId, hostName, closed: false, createdAt: Date.now() })
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS)
      return jsonResponse({ code }, 201)
    }

    const room = await this.ctx.storage.get('room')
    if (!room || room.closed) return jsonResponse({ error: 'Room not found or already over.' }, 404)

    const sockets = this.ctx.getWebSockets()
    const host = sockets.find(ws => ws.deserializeAttachment().role === 'host')
    const guest = sockets.find(ws => ws.deserializeAttachment().role === 'guest')

    if (url.pathname === '/info') {
      return jsonResponse({
        code: room.code,
        hostName: room.hostName,
        hostOnline: !!host,
        full: !!host && !!guest,
        isHost: userId === room.hostUserId,
      })
    }

    if (url.pathname === '/ws') {
      // The creator's first connection is the host; anyone else (including the
      // creator in a second tab, handy for testing) joins as the guest.
      let role
      if (userId === room.hostUserId && !host) role = 'host'
      else if (!guest && host) role = 'guest'
      else if (!host) return jsonResponse({ error: 'The host is not in the room yet.' }, 409)
      else return jsonResponse({ error: 'This room is full.' }, 409)

      const [client, server] = Object.values(new WebSocketPair())
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment({ role, name: userName })

      const other = role === 'host' ? guest : host
      server.send(JSON.stringify({ t: 'hello', role, you: userName, peer: other ? other.deserializeAttachment().name : null }))
      if (other) other.send(JSON.stringify({ t: 'peer', joined: true, name: userName }))
      return new Response(null, { status: 101, webSocket: client })
    }

    return jsonResponse({ error: 'Not found' }, 404)
  }

  async webSocketMessage(ws, message) {
    if (!this.allow(ws)) return
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) other.send(message)
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
    const others = this.ctx.getWebSockets().filter(o => o !== ws)
    if (me?.role === 'host') {
      // No host, no match: close the room and send the guest home.
      const room = await this.ctx.storage.get('room')
      if (room) {
        room.closed = true
        await this.ctx.storage.put('room', room)
      }
      for (const o of others) {
        try {
          o.send(JSON.stringify({ t: 'peer', joined: false, name: me.name, roomClosed: true }))
          o.close(1001, 'host left')
        } catch {}
      }
    } else {
      // The guest left; the host keeps the room and can wait for someone else.
      for (const o of others) {
        try {
          o.send(JSON.stringify({ t: 'peer', joined: false, name: me?.name }))
        } catch {}
      }
    }
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
