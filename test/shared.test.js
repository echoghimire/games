import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'

import { hasAccess, hashPassword, readSession, signSession, verifyPassword } from '../shared/auth.js'
import { verifyWebhook } from '../shared/stripe.js'
import { ROOM_CODE_RE, newRoomCode } from '../apps/arena/src/codes.js'

const env = { SESSION_SECRET: 'test-secret', STRIPE_WEBHOOK_SECRET: 'whsec_test' }

function cookieRequest(value) {
  return new Request('https://arena.example.com/', { headers: { cookie: `arena_session=${value}` } })
}

test('passwords hash and verify', async () => {
  const stored = await hashPassword('hunter22')
  assert.ok(stored.startsWith('pbkdf2$100000$'))
  assert.equal(await verifyPassword('hunter22', stored), true)
  assert.equal(await verifyPassword('hunter23', stored), false)
})

test('session cookies round-trip and reject tampering', async () => {
  const value = await signSession(env, { id: 'u1', session_version: 3 })
  const session = await readSession(env, cookieRequest(value))
  assert.equal(session.uid, 'u1')
  assert.equal(session.sv, 3)

  const [payload, sig] = value.split('.')
  const forged = Buffer.from(JSON.stringify({ uid: 'admin', sv: 3, exp: 9e9 })).toString('base64url')
  assert.equal(await readSession(env, cookieRequest(`${forged}.${sig}`)), null)
  assert.equal(await readSession({ SESSION_SECRET: 'other' }, cookieRequest(value)), null)
  assert.equal(await readSession(env, cookieRequest(payload)), null)
})

test('hasAccess checks paid_until against now', () => {
  const now = Math.floor(Date.now() / 1000)
  assert.equal(hasAccess(null), false)
  assert.equal(hasAccess({ paid_until: null }), false)
  assert.equal(hasAccess({ paid_until: now - 1 }), false)
  assert.equal(hasAccess({ paid_until: now + 60 }), true)
})

test('Stripe webhook signatures', async () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' })
  const t = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex')

  assert.equal((await verifyWebhook(env, body, `t=${t},v1=${sig}`)).id, 'evt_1')
  assert.equal(await verifyWebhook(env, body, `t=${t},v1=${'0'.repeat(64)}`), null)
  assert.equal(await verifyWebhook(env, body + ' ', `t=${t},v1=${sig}`), null)
  assert.equal(await verifyWebhook(env, body, `t=${t},v1=${sig}`, t + 301), null, 'too old')
  assert.equal(await verifyWebhook(env, body, null), null)
})

test('room codes', () => {
  for (let i = 0; i < 200; i++) assert.match(newRoomCode(), ROOM_CODE_RE)
  assert.doesNotMatch('ABC10O', ROOM_CODE_RE)
})
