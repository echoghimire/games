// One Durable Object per match. It doesn't run the game: the host's browser
// runs the Doom server (network id 1) and every other player's browser is a
// client. The room only relays packets between them over WebSockets.
//
// Wire format (from the engine's net_websockets.c), little-endian uint32s:
//   browser -> room: [to][from][payload]
//   room -> browser: [from][payload]
//
// Compared with Cloudflare's original router this one:
//   - uses the WebSocket Hibernation API, so idle lobbies cost nothing;
//   - binds each socket to the first network id it sends from and drops
//     packets that claim a different one (no impersonating other players);
//   - only lets the room's creator act as the server (id 1), so nobody can
//     hijack or reset someone else's match;
//   - caps players and per-socket packet rate, and expires abandoned rooms.

import { DurableObject } from 'cloudflare:workers'

export { ROOM_CODE_RE, newRoomCode } from './codes.js'

export const MAX_PLAYERS = 4 // vanilla Doom netgames support 4 players
const SERVER_UID = 1
const BROADCAST_UID = 0
const ROOM_TTL_MS = 6 * 60 * 60 * 1000
const MAX_PACKETS_PER_SECOND = 200 // Doom sends ~35 tics/s; leave headroom for bursts

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    // Per-socket rate limiting; resetting on hibernation wake-up is fine.
    this.rates = new Map()
  }

  async fetch(request) {
    const url = new URL(request.url)
    const userId = request.headers.get('x-user-id')
    const userName = request.headers.get('x-user-name') || 'Player'

    if (url.pathname === '/init' && request.method === 'POST') {
      const existing = await this.ctx.storage.get('room')
      if (existing && !existing.closed) return jsonResponse({ error: 'taken' }, 409)
      const { code, hostUserId, hostName, settings } = await request.json()
      const room = { code, hostUserId, hostName, settings, started: false, closed: false, createdAt: Date.now() }
      await this.ctx.storage.put('room', room)
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS)
      return jsonResponse({ code }, 201)
    }

    const room = await this.ctx.storage.get('room')
    if (!room || room.closed) return jsonResponse({ error: 'Room not found or already over.' }, 404)
    const isHost = userId === room.hostUserId

    if (url.pathname === '/info') {
      const players = this.ctx.getWebSockets().map(ws => {
        const a = ws.deserializeAttachment()
        return { name: a.name, host: a.isHost }
      })
      return jsonResponse({
        code: room.code,
        hostName: room.hostName,
        settings: room.settings,
        started: room.started,
        hostOnline: players.some(p => p.host),
        players,
        isHost,
      })
    }

    if (url.pathname === '/start' && request.method === 'POST') {
      if (!isHost) return jsonResponse({ error: 'Only the host can start the match.' }, 403)
      room.started = true
      await this.ctx.storage.put('room', room)
      return jsonResponse({ ok: true })
    }

    if (url.pathname === '/ws') {
      const sockets = this.ctx.getWebSockets()
      if (!isHost) {
        if (room.started) return jsonResponse({ error: 'This match has already started.' }, 409)
        if (!sockets.some(ws => ws.deserializeAttachment().isHost)) {
          return jsonResponse({ error: 'The host is not in the room yet.' }, 409)
        }
        const max = room.settings.players || MAX_PLAYERS
        if (sockets.length >= max) return jsonResponse({ error: 'This room is full.' }, 409)
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment({ userId, name: userName, isHost, uid: null })
      return new Response(null, { status: 101, webSocket: client })
    }

    return jsonResponse({ error: 'Not found' }, 404)
  }

  async webSocketMessage(ws, message) {
    if (typeof message === 'string' || message.byteLength < 8) return
    if (!this.allow(ws)) return

    const view = new DataView(message)
    const to = view.getUint32(0, true)
    const from = view.getUint32(4, true)
    const me = ws.deserializeAttachment()

    if (me.uid === null) {
      // First packet: claim a network id. Only the host may be the server.
      if ((from === SERVER_UID) !== me.isHost || from === BROADCAST_UID) {
        ws.close(1008, 'invalid network id')
        return
      }
      const taken = this.ctx.getWebSockets().some(other => other !== ws && other.deserializeAttachment().uid === from)
      if (taken) {
        ws.close(1008, 'network id in use, please rejoin')
        return
      }
      me.uid = from
      ws.serializeAttachment(me)
    } else if (from !== me.uid) {
      return // spoofed sender
    }

    if (to === BROADCAST_UID) {
      // The host's server announces itself with to=0 when it (re)starts: any
      // clients left over from a previous run must reconnect.
      if (me.isHost) {
        for (const other of this.ctx.getWebSockets()) {
          if (other !== ws && other.deserializeAttachment().uid !== null) other.close(1012, 'host restarted')
        }
      }
      return
    }

    for (const other of this.ctx.getWebSockets()) {
      if (other.deserializeAttachment().uid === to) {
        other.send(message.slice(4))
        return
      }
    }
  }

  async webSocketClose(ws, code, reason) {
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
    if (!me?.isHost) return
    // Without the host there's no server, so end the match for everyone.
    const room = await this.ctx.storage.get('room')
    if (room) {
      room.closed = true
      await this.ctx.storage.put('room', room)
    }
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) {
        try {
          other.close(1001, 'host left')
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
    return ++r.count <= MAX_PACKETS_PER_SECOND
  }

  async alarm() {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS)
      return
    }
    await this.ctx.storage.deleteAll()
  }
}
