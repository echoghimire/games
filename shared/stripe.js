// Minimal Stripe client for Workers: Checkout Session creation and webhook
// signature verification, using fetch + WebCrypto (no SDK needed).

import { hex, hmac, timingSafeEqual } from './auth.js'

const SIGNATURE_TOLERANCE_SECONDS = 300

function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (typeof v === 'object') formEncode(v, key, out)
    else out.append(key, String(v))
  }
  return out
}

export async function createCheckoutSession(env, user) {
  const mode = env.STRIPE_MODE === 'subscription' ? 'subscription' : 'payment'
  const params = {
    mode,
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': 1,
    success_url: `${env.LANDING_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.LANDING_URL}/pay?cancelled=1`,
    client_reference_id: user.id,
    metadata: { user_id: user.id },
  }
  if (user.stripe_customer_id) params.customer = user.stripe_customer_id
  else {
    params.customer_email = user.email
    if (mode === 'payment') params.customer_creation = 'always'
  }
  if (mode === 'subscription') params.subscription_data = { metadata: { user_id: user.id } }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(params),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`stripe: ${body.error?.message || res.status}`)
  return body
}

// Verifies the Stripe-Signature header ("t=...,v1=...,v1=...") against the raw
// body and returns the parsed event, or null if it doesn't check out.
export async function verifyWebhook(env, rawBody, header, now = Math.floor(Date.now() / 1000)) {
  if (!header) return null
  let timestamp = null
  const signatures = []
  for (const part of header.split(',')) {
    const [k, v] = part.split('=')
    if (k === 't') timestamp = Number(v)
    if (k === 'v1') signatures.push(v)
  }
  if (!timestamp || signatures.length === 0) return null
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return null
  const expected = hex(await hmac(env.STRIPE_WEBHOOK_SECRET, `${timestamp}.${rawBody}`))
  if (!signatures.some(s => timingSafeEqual(s, expected))) return null
  return JSON.parse(rawBody)
}
