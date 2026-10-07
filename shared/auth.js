// Session cookies, password hashing and access checks shared by the landing
// and arena Workers. Both Workers bind the same D1 database (DB) and the same
// SESSION_SECRET, so a cookie set on game.<domain> is valid on arena.<domain>.

const enc = new TextEncoder()

export const SESSION_COOKIE = 'arena_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

// Workers' WebCrypto caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000

export function b64url(bytes) {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, c => c.charCodeAt(0))
}

export function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hmacKey(secret) {
  if (!secret) throw new Error('Missing secret: set SESSION_SECRET (and STRIPE_WEBHOOK_SECRET for payments)')
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
}

export async function hmac(secret, data) {
  return crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data))
}

export async function hashPassword(password, saltBytes = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  )
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(saltBytes)}$${b64url(bits)}`
}

export async function verifyPassword(password, stored) {
  const [scheme, , salt] = stored.split('$')
  if (scheme !== 'pbkdf2') return false
  const candidate = await hashPassword(password, fromB64url(salt))
  return timingSafeEqual(candidate, stored)
}

// Cookie value: base64url(JSON payload) + "." + base64url(HMAC). The payload
// carries the user's session version so logging out everywhere is one UPDATE.
export async function signSession(env, user) {
  const payload = b64url(
    enc.encode(
      JSON.stringify({ uid: user.id, sv: user.session_version, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
    ),
  )
  const sig = b64url(await hmac(env.SESSION_SECRET, payload))
  return `${payload}.${sig}`
}

export async function readSession(env, request) {
  const raw = getCookie(request, SESSION_COOKIE)
  if (!raw) return null
  const [payload, sig] = raw.split('.')
  if (!payload || !sig) return null
  const expected = b64url(await hmac(env.SESSION_SECRET, payload))
  if (!timingSafeEqual(sig, expected)) return null
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)))
    if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null
    return data
  } catch {
    return null
  }
}

// Returns the signed-in user row, or null. Rejects sessions issued before the
// user's last "log out everywhere" (session_version bump).
export async function currentUser(env, request) {
  const session = await readSession(env, request)
  if (!session) return null
  const user = await env.DB.prepare(
    'SELECT id, email, display_name, paid_until, session_version, stripe_customer_id FROM users WHERE id = ?',
  )
    .bind(session.uid)
    .first()
  if (!user || user.session_version !== session.sv) return null
  return user
}

export function hasAccess(user) {
  return !!user && typeof user.paid_until === 'number' && user.paid_until > Math.floor(Date.now() / 1000)
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

export function sessionCookie(env, value, maxAge = SESSION_TTL_SECONDS) {
  const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : ''
  const secure = env.COOKIE_INSECURE === 'true' ? '' : '; Secure'
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${domain}${secure}`
}

export function clearSessionCookie(env) {
  return sessionCookie(env, '', 0)
}
