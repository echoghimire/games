// game.<domain>: landing page, sign-up/login, and Stripe checkout + webhooks.
// Static pages live in ../public and are served by Workers static assets;
// this Worker only handles /api/* and /play.

import {
  clearSessionCookie,
  currentUser,
  hashPassword,
  hasAccess,
  sessionCookie,
  signSession,
  verifyPassword,
} from '../../../shared/auth.js'
import { json, redirect, sameOrigin, withSecurityHeaders } from '../../../shared/http.js'
import { createCheckoutSession, verifyWebhook } from '../../../shared/stripe.js'

const DAY = 86400
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (url.pathname === '/play') return play(request, env)
      if (url.pathname.startsWith('/api/')) return withSecurityHeaders(await api(request, env, url))
      return withSecurityHeaders(await env.ASSETS.fetch(request))
    } catch (err) {
      console.error(err)
      return json({ error: 'Something went wrong. Please try again.' }, 500)
    }
  },
}

async function play(request, env) {
  const user = await currentUser(env, request)
  if (!user) return redirect('/login?next=play')
  if (!hasAccess(user)) return redirect('/pay')
  return redirect(env.ARENA_URL)
}

async function api(request, env, url) {
  const route = `${request.method} ${url.pathname}`

  // Stripe calls this server-to-server, so it's exempt from the Origin check.
  if (route === 'POST /api/stripe/webhook') return stripeWebhook(request, env)

  if (request.method !== 'GET' && !sameOrigin(request, env)) return json({ error: 'Bad origin' }, 403)

  switch (route) {
    case 'GET /api/me':
      return me(request, env)
    case 'POST /api/signup':
      return signup(request, env)
    case 'POST /api/login':
      return login(request, env)
    case 'POST /api/logout':
      return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(env) })
    case 'POST /api/checkout':
      return checkout(request, env)
    case 'POST /api/dev/grant':
      return devGrant(request, env)
    default:
      return json({ error: 'Not found' }, 404)
  }
}

function publicUser(user) {
  return {
    email: user.email,
    name: user.display_name,
    paidUntil: user.paid_until,
    hasAccess: hasAccess(user),
  }
}

async function me(request, env) {
  const user = await currentUser(env, request)
  return json({ user: user ? publicUser(user) : null, arenaUrl: env.ARENA_URL, devMode: env.DEV_MODE === 'true' })
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

async function signup(request, env) {
  const { email = '', password = '', name = '' } = await readJson(request)
  const cleanEmail = String(email).trim().toLowerCase()
  const cleanName = String(name).trim().replace(/[^\w \-!.]/g, '').slice(0, 20)
  if (!EMAIL_RE.test(cleanEmail)) return json({ error: 'Enter a valid email address.' }, 400)
  if (String(password).length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400)
  if (!cleanName) return json({ error: 'Pick a player name.' }, 400)

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first()
  if (existing) return json({ error: 'An account with that email already exists. Log in instead.' }, 409)

  const user = {
    id: crypto.randomUUID(),
    email: cleanEmail,
    display_name: cleanName,
    session_version: 1,
  }
  await env.DB.prepare(
    'INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(user.id, user.email, user.display_name, await hashPassword(String(password)), Math.floor(Date.now() / 1000))
    .run()

  return json({ user: publicUser(user) }, 201, { 'set-cookie': sessionCookie(env, await signSession(env, user)) })
}

async function login(request, env) {
  const { email = '', password = '' } = await readJson(request)
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(String(email).trim().toLowerCase())
    .first()
  // Hash even when the user doesn't exist so response time doesn't reveal it.
  const ok = user
    ? await verifyPassword(String(password), user.password_hash)
    : (await hashPassword(String(password)), false)
  if (!ok) return json({ error: 'Wrong email or password.' }, 401)
  return json({ user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(env, await signSession(env, user)) })
}

async function checkout(request, env) {
  const user = await currentUser(env, request)
  if (!user) return json({ error: 'Log in first.' }, 401)
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) return json({ error: 'Payments are not configured yet.' }, 503)
  const session = await createCheckoutSession(env, user)
  return json({ url: session.url })
}

// Local development only: grants access without Stripe. Enabled only when
// DEV_MODE is "true" (set it in .dev.vars, never in production).
async function devGrant(request, env) {
  if (env.DEV_MODE !== 'true') return json({ error: 'Not found' }, 404)
  const user = await currentUser(env, request)
  if (!user) return json({ error: 'Log in first.' }, 401)
  await extendAccess(env, user.id, 30 * DAY)
  return json({ ok: true })
}

async function extendAccess(env, userId, seconds) {
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare('UPDATE users SET paid_until = MAX(COALESCE(paid_until, 0), ?) + ? WHERE id = ?')
    .bind(now, seconds, userId)
    .run()
}

async function stripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Webhook secret not configured' }, 503)
  const raw = await request.text()
  const event = await verifyWebhook(env, raw, request.headers.get('Stripe-Signature'))
  if (!event) return json({ error: 'Bad signature' }, 400)

  // Idempotency: Stripe retries deliveries, so skip events we've already applied.
  const inserted = await env.DB.prepare('INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)')
    .bind(event.id, event.type, Math.floor(Date.now() / 1000))
    .run()
  if (inserted.meta.changes === 0) return json({ received: true, duplicate: true })

  const obj = event.data.object
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = obj.client_reference_id || obj.metadata?.user_id
      if (!userId || obj.payment_status === 'unpaid') break
      if (obj.customer) {
        await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(obj.customer, userId).run()
      }
      // One-time pass: PASS_DAYS of access. Subscription: cover the first
      // month plus grace; invoice.paid then keeps it in step with billing.
      const days = obj.mode === 'subscription' ? 32 : Number(env.PASS_DAYS || 30)
      await extendAccess(env, userId, days * DAY)
      break
    }
    case 'invoice.paid': {
      const periodEnd = obj.lines?.data?.[0]?.period?.end
      if (!obj.customer || !periodEnd) break
      await env.DB.prepare('UPDATE users SET paid_until = MAX(COALESCE(paid_until, 0), ?) WHERE stripe_customer_id = ?')
        .bind(periodEnd + 2 * DAY, obj.customer)
        .run()
      break
    }
    case 'customer.subscription.deleted': {
      await env.DB.prepare('UPDATE users SET paid_until = ? WHERE stripe_customer_id = ?')
        .bind(Math.floor(Date.now() / 1000), obj.customer)
        .run()
      break
    }
  }
  return json({ received: true })
}
