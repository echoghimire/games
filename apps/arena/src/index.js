// arena.<domain>: the game itself. Every request is checked for a paid
// session first; anyone else is sent to the landing site to log in or pay.

import { currentUser, hasAccess } from '../../../shared/auth.js'
import { json, redirect, sameOrigin, withSecurityHeaders } from '../../../shared/http.js'
import { MAX_PLAYERS, ROOM_CODE_RE, newRoomCode } from './room.js'
import { withScoresTable } from './scores.js'

export { Room } from './room.js'
export { FightRoom } from './fightroom.js'
export { PartyRoom } from './partyroom.js'
export { WPilotRoom } from './wpilotroom.js'

// WADs are uploaded to R2 under this version prefix (see scripts/upload-wads.sh)
// so the browser can cache them forever.
const WADS = new Set(['freedm.wad', 'freedoom1.wad', 'freedoom2.wad'])
const MODES = new Set(['deathmatch', 'altdeath', 'coop'])

// Mini-games with online rooms, and their player limits.
const PARTY_GAMES = { paint: 4, pong: 2 }
// Mini-games with leaderboards, and the highest score we accept (sanity cap).
const SCORE_GAMES = { smash: 100000, flyer: 10000, pong: 1000, paint: 784, coil: 10000000, maze: 200, siege: 10000000, drakonas: 10000000 }
// Leaderboards the game server keeps itself (WPilot round wins): read-only here.
const SERVER_SCORED = new Set(['wpilot'])
// WPilot: one always-open public arena plus private rooms by code.
const WPILOT_PUBLIC = 'PUBLIC'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      const user = await currentUser(env, request)
      if (!user || !hasAccess(user)) return denied(request, env, url, user)

      if (url.pathname.startsWith('/api/')) return withSecurityHeaders(await api(request, env, url, user))
      if (url.pathname.startsWith('/wads/')) return wad(request, env, url)
      // /r/CODE (deathmatch) and /f/CODE (fighter) are shareable invite links;
      // the page reads the code from the path.
      if (/^\/r\/[A-Za-z0-9]+$/.test(url.pathname)) {
        return withSecurityHeaders(await env.ASSETS.fetch(new Request(new URL('/', url), request)))
      }
      if (/^\/f\/[A-Za-z0-9]+$/.test(url.pathname)) {
        return withSecurityHeaders(await env.ASSETS.fetch(new Request(new URL('/fighter', url), request)))
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request))
    } catch (err) {
      console.error(err)
      return json({ error: 'Something went wrong.' }, 500)
    }
  },
}

function denied(request, env, url, user) {
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/wads/')) {
    return json({ error: user ? 'payment_required' : 'login_required' }, user ? 402 : 401)
  }
  if (!user) {
    const back = encodeURIComponent(url.pathname + url.search)
    return redirect(`${env.LANDING_URL}/login?next=arena&path=${back}`)
  }
  return redirect(`${env.LANDING_URL}/pay`)
}

function roomStub(env, code, ns = env.ROOMS) {
  return ns.get(ns.idFromName(code))
}

// Forwards a WebSocket upgrade to a room object, with the player's identity.
function upgradeToRoom(request, env, stub, headers) {
  if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected WebSocket' }, 426)
  // Browsers don't let pages set headers on WebSockets, so the Origin check
  // done for POSTs doesn't cover GET upgrades; check here instead
  // (cross-site WebSocket hijacking).
  if (!sameOrigin(request, env)) return json({ error: 'Bad origin' }, 403)
  const upgrade = new Request('https://room/ws', request)
  for (const [k, v] of Object.entries(headers)) upgrade.headers.set(k, v)
  return stub.fetch(upgrade)
}

// Creates a room with a fresh code. Codes are short, so retry on the rare
// collision with a live room.
async function createRoom(env, ns, user, extra = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newRoomCode()
    const res = await roomStub(env, code, ns).fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ code, hostUserId: user.id, hostName: user.display_name, ...extra }),
    })
    if (res.status === 201) return code
  }
  return null
}

async function api(request, env, url, user) {
  if (request.method !== 'GET' && !sameOrigin(request, env)) return json({ error: 'Bad origin' }, 403)

  if (request.method === 'GET' && url.pathname === '/api/me') {
    return json({ name: user.display_name, email: user.email, paidUntil: user.paid_until, landingUrl: env.LANDING_URL })
  }

  if (request.method === 'POST' && url.pathname === '/api/rooms') {
    let body = {}
    try {
      body = await request.json()
    } catch {}
    const settings = {
      wad: WADS.has(body.wad) ? body.wad : 'freedm.wad',
      mode: MODES.has(body.mode) ? body.mode : 'deathmatch',
      map: Math.min(Math.max(parseInt(body.map, 10) || 1, 1), 32),
      skill: Math.min(Math.max(parseInt(body.skill, 10) || 3, 1), 5),
      monsters: !!body.monsters,
      timelimit: Math.min(Math.max(parseInt(body.timelimit, 10) || 0, 0), 60),
      players: Math.min(Math.max(parseInt(body.players, 10) || MAX_PLAYERS, 2), MAX_PLAYERS),
    }
    const code = await createRoom(env, env.ROOMS, user, { settings })
    if (code) return json({ code, settings }, 201)
    return json({ error: 'Could not allocate a room, try again.' }, 503)
  }

  // Mini-game rooms (Paint Clash, Curve Clash), see partyroom.js.
  if (request.method === 'POST' && url.pathname === '/api/party/rooms') {
    let body = {}
    try {
      body = await request.json()
    } catch {}
    const max = PARTY_GAMES[body.game]
    if (!max) return json({ error: 'Unknown game' }, 400)
    const code = await createRoom(env, env.PARTIES, user, { game: body.game, max })
    if (code) return json({ code }, 201)
    return json({ error: 'Could not allocate a room, try again.' }, 503)
  }
  const pr = url.pathname.match(/^\/api\/party\/rooms\/([^/]+)(\/ws)?$/)
  if (pr) {
    const code = pr[1].toUpperCase()
    if (!ROOM_CODE_RE.test(code)) return json({ error: 'Room not found' }, 404)
    const stub = roomStub(env, code, env.PARTIES)
    const headers = { 'x-user-id': user.id, 'x-user-name': user.display_name }
    if (pr[2] === '/ws') return upgradeToRoom(request, env, stub, headers)
    if (request.method === 'GET') return stub.fetch('https://room/info', { headers })
  }

  // Leaderboards: best score per player per game.
  const sc = url.pathname.match(/^\/api\/scores\/([a-z]+)$/)
  if (sc) {
    const game = sc[1]
    const cap = SCORE_GAMES[game]
    if (!cap && !SERVER_SCORED.has(game)) return json({ error: 'Unknown game' }, 404)
    if (request.method === 'POST' && !cap) return json({ error: 'Scores for this game come from the game server' }, 403)
    let body = {}
    if (request.method === 'POST') {
      try {
        body = await request.json()
      } catch {}
    }
    return withScoresTable(env, async () => {
      if (request.method === 'POST') {
        const score = Number(body.score)
        if (!Number.isInteger(score) || score < 0 || score > cap) return json({ error: 'Invalid score' }, 400)
        await env.DB.prepare(
          `INSERT INTO scores (game, user_id, name, best, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (game, user_id) DO UPDATE SET
             best = MAX(best, excluded.best), name = excluded.name,
             updated_at = CASE WHEN excluded.best > best THEN excluded.updated_at ELSE updated_at END`,
        )
          .bind(game, user.id, user.display_name, score, Math.floor(Date.now() / 1000))
          .run()
      }
      if (request.method === 'POST' || request.method === 'GET') return json(await leaderboard(env, game, user))
      return json({ error: 'Not found' }, 404)
    }).catch(err => {
      console.error('scores', err)
      return json({ error: `database error: ${String(err?.message ?? err).slice(0, 160)}` }, 500)
    })
  }

  // Health check for the live site: is the database reachable, which tables
  // exist, and which games this deployment knows (shows if a deploy is stale).
  if (request.method === 'GET' && url.pathname === '/api/health') {
    const report = { worker: 'arena', games: Object.keys(SCORE_GAMES).concat([...SERVER_SCORED]), database: {} }
    try {
      const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      report.database.tables = tables.results.map(t => t.name)
      if (report.database.tables.includes('scores')) {
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores').first()
        report.database.scoreRows = n.n
      }
      report.database.ok = true
    } catch (err) {
      report.database.ok = false
      report.database.error = String(err?.message ?? err)
    }
    report.durableObjects = { ROOMS: !!env.ROOMS, FIGHTS: !!env.FIGHTS, PARTIES: !!env.PARTIES, WPILOT: !!env.WPILOT }
    return json(report)
  }

  // WPilot rooms run the game server in a Durable Object (wpilotroom.js).
  // Private rooms need no setup: any well-formed code is a room.
  if (request.method === 'POST' && url.pathname === '/api/wpilot/rooms') {
    return json({ code: newRoomCode() }, 201)
  }
  const wp = url.pathname.match(/^\/api\/wpilot\/rooms\/([^/]+)(\/ws)?$/)
  if (wp) {
    const code = wp[1].toUpperCase()
    if (code !== WPILOT_PUBLIC && !ROOM_CODE_RE.test(code)) return json({ error: 'Room not found' }, 404)
    const stub = roomStub(env, code, env.WPILOT)
    const headers = { 'x-user-id': user.id, 'x-user-name': user.display_name }
    if (wp[2] === '/ws') return upgradeToRoom(request, env, stub, headers)
    if (request.method === 'GET') return stub.fetch('https://room/info', { headers })
  }

  // Iron Arena (fighter) online rooms: two players, see fightroom.js.
  if (request.method === 'POST' && url.pathname === '/api/fight/rooms') {
    const code = await createRoom(env, env.FIGHTS, user)
    if (code) return json({ code }, 201)
    return json({ error: 'Could not allocate a room, try again.' }, 503)
  }
  const f = url.pathname.match(/^\/api\/fight\/rooms\/([^/]+)(\/ws)?$/)
  if (f) {
    const code = f[1].toUpperCase()
    if (!ROOM_CODE_RE.test(code)) return json({ error: 'Room not found' }, 404)
    const stub = roomStub(env, code, env.FIGHTS)
    const headers = { 'x-user-id': user.id, 'x-user-name': user.display_name }
    if (f[2] === '/ws') return upgradeToRoom(request, env, stub, headers)
    if (request.method === 'GET') return stub.fetch('https://room/info', { headers })
  }

  const m = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/ws|\/start)?$/)
  if (m) {
    const code = m[1].toUpperCase()
    if (!ROOM_CODE_RE.test(code)) return json({ error: 'Room not found' }, 404)
    const stub = roomStub(env, code)
    const headers = { 'x-user-id': user.id, 'x-user-name': user.display_name }

    if (m[2] === '/ws') return upgradeToRoom(request, env, stub, headers)
    if (m[2] === '/start' && request.method === 'POST') {
      return stub.fetch('https://room/start', { method: 'POST', headers })
    }
    if (!m[2] && request.method === 'GET') {
      return stub.fetch('https://room/info', { headers })
    }
  }

  return json({ error: 'Not found' }, 404)
}

// Streams a WAD from R2. Path: /wads/<version>/<file>. Versioned URLs are
// immutable, so let the browser keep them for a year.
async function wad(request, env, url) {
  const [, , version, name] = url.pathname.split('/')
  if (!version || !WADS.has(name)) return json({ error: 'Not found' }, 404)
  const obj = await env.WADS.get(`${version}/${name}`)
  if (!obj) return json({ error: 'Not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('content-type', 'application/octet-stream')
  headers.set('content-length', String(obj.size))
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'private, max-age=31536000, immutable')
  return new Response(obj.body, { headers })
}

async function leaderboard(env, game, user) {
  const top = await env.DB.prepare('SELECT name, best FROM scores WHERE game = ? ORDER BY best DESC, updated_at ASC LIMIT 20')
    .bind(game)
    .all()
  const mine = await env.DB.prepare('SELECT best FROM scores WHERE game = ? AND user_id = ?').bind(game, user.id).first()
  let rank = null
  if (mine) {
    const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE game = ? AND best > ?')
      .bind(game, mine.best)
      .first()
    rank = above.n + 1
  }
  return { top: top.results, me: mine ? { best: mine.best, rank } : null }
}
