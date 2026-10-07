// arena.<domain>: the game itself. Every request is checked for a paid
// session first; anyone else is sent to the landing site to log in or pay.

import { currentUser, hasAccess } from '../../../shared/auth.js'
import { json, redirect, sameOrigin, withSecurityHeaders } from '../../../shared/http.js'
import { MAX_PLAYERS, ROOM_CODE_RE, newRoomCode } from './room.js'

export { Room } from './room.js'

// WADs are uploaded to R2 under this version prefix (see scripts/upload-wads.sh)
// so the browser can cache them forever.
const WADS = new Set(['freedm.wad', 'freedoom1.wad', 'freedoom2.wad'])
const MODES = new Set(['deathmatch', 'altdeath', 'coop'])

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      const user = await currentUser(env, request)
      if (!user || !hasAccess(user)) return denied(request, env, url, user)

      if (url.pathname.startsWith('/api/')) return withSecurityHeaders(await api(request, env, url, user))
      if (url.pathname.startsWith('/wads/')) return wad(request, env, url)
      // /r/CODE is a shareable invite link; the page reads the code from the path.
      if (/^\/r\/[A-Za-z0-9]+$/.test(url.pathname)) {
        return withSecurityHeaders(await env.ASSETS.fetch(new Request(new URL('/', url), request)))
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

function roomStub(env, code) {
  return env.ROOMS.get(env.ROOMS.idFromName(code))
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
    // Codes are short, so retry on the rare collision with a live room.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newRoomCode()
      const res = await roomStub(env, code).fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify({ code, hostUserId: user.id, hostName: user.display_name, settings }),
      })
      if (res.status === 201) return json({ code, settings }, 201)
    }
    return json({ error: 'Could not allocate a room, try again.' }, 503)
  }

  const m = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/ws|\/start)?$/)
  if (m) {
    const code = m[1].toUpperCase()
    if (!ROOM_CODE_RE.test(code)) return json({ error: 'Room not found' }, 404)
    const stub = roomStub(env, code)
    const headers = { 'x-user-id': user.id, 'x-user-name': user.display_name }

    if (m[2] === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected WebSocket' }, 426)
      // Browsers don't let pages set headers on WebSockets, so the Origin check
      // above is skipped for GET; do it here instead (cross-site WebSocket hijacking).
      if (!sameOrigin(request, env)) return json({ error: 'Bad origin' }, 403)
      const upgrade = new Request('https://room/ws', request)
      for (const [k, v] of Object.entries(headers)) upgrade.headers.set(k, v)
      return stub.fetch(upgrade)
    }
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
