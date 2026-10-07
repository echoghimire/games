// Arena pass payments by Fonepay QR.
//
// FONEPAY_QR (a secret) holds the decoded text of KTM Tronix's static
// Fonepay QR. For each purchase we turn it into a dynamic EMVCo QR with the
// pass price and a unique reference (shared/emvqr.js). The player pays with
// any Fonepay / mobile-banking app, then enters the transaction code from
// their receipt. KTM Tronix checks it against their Fonepay statement and
// approves it on /admin, which activates the pass.

import qrcode from 'qrcode-generator'
import { toDynamicQr } from '../../../shared/emvqr.js'

const now = () => Math.floor(Date.now() / 1000)
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const TXN_RE = /^[A-Za-z0-9-]{4,40}$/
const REUSE_SECONDS = 24 * 3600

export function fonepayConfigured(env) {
  return Boolean(env.FONEPAY_QR)
}

export function passPrice(env) {
  return Number(env.PASS_PRICE_NPR || 500)
}

function newReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return 'TRX' + [...bytes].map(b => REF_ALPHABET[b % REF_ALPHABET.length]).join('')
}

export function qrSvg(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text, 'Byte')
  qr.make()
  return qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true })
}

function view(env, p) {
  const amount = p.amount
  const payload = toDynamicQr(env.FONEPAY_QR, { amount, reference: p.reference, purpose: 'Tronix Arena pass' })
  return {
    reference: p.reference,
    amount,
    currency: 'NPR',
    days: Number(env.PASS_DAYS || 30),
    status: p.status,
    note: p.note || null,
    payload,
    svg: qrSvg(payload),
  }
}

// Returns the player's open payment (reused for a day), or starts one.
export async function startPayment(env, user) {
  if (!fonepayConfigured(env)) return { error: 'Fonepay payments are not set up yet.', status: 503 }
  const open = await env.DB.prepare(
    `SELECT * FROM payments WHERE user_id = ?1 AND method = 'fonepay' AND status IN ('awaiting', 'submitted')
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(user.id)
    .first()
  if (open && (open.status === 'submitted' || now() - open.created_at < REUSE_SECONDS)) return { payment: view(env, open) }

  const p = {
    id: crypto.randomUUID(),
    reference: newReference(),
    amount: passPrice(env).toFixed(2),
    status: 'awaiting',
  }
  toDynamicQr(env.FONEPAY_QR, { amount: p.amount, reference: p.reference }) // fail before saving if the QR secret is bad
  await env.DB.prepare(
    `INSERT INTO payments (id, user_id, reference, method, amount, status, created_at) VALUES (?1, ?2, ?3, 'fonepay', ?4, 'awaiting', ?5)`,
  )
    .bind(p.id, user.id, p.reference, p.amount, now())
    .run()
  return { payment: view(env, p) }
}

export async function submitTransaction(env, user, body) {
  const reference = String(body.reference || '').trim().toUpperCase()
  const txnCode = String(body.txnCode || '').trim().toUpperCase()
  if (!TXN_RE.test(txnCode)) return { error: 'Enter the transaction code from your payment receipt (letters and numbers).', status: 400 }
  try {
    const res = await env.DB.prepare(
      `UPDATE payments SET txn_code = ?1, status = 'submitted', submitted_at = ?2, note = NULL
       WHERE user_id = ?3 AND reference = ?4 AND status IN ('awaiting', 'rejected')`,
    )
      .bind(txnCode, now(), user.id, reference)
      .run()
    if (res.meta.changes === 0) return { error: 'Payment not found, or it is already being checked.', status: 404 }
  } catch (err) {
    if (/UNIQUE/i.test(String(err?.message))) return { error: 'That transaction code has already been used.', status: 409 }
    throw err
  }
  return { ok: true }
}

export async function latestPayment(env, user) {
  const p = await env.DB.prepare(
    `SELECT reference, status, amount, note, txn_code AS txnCode, created_at AS createdAt, submitted_at AS submittedAt
     FROM payments WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(user.id)
    .first()
  return p || null
}
