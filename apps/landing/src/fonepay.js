// Arena pass payments by Fonepay QR.
//
// The decoded text of KTM Tronix's static Fonepay QR comes from /admin (staff
// upload a photo of the QR and it is stored in the settings table) or, failing
// that, the FONEPAY_QR secret. For each purchase we turn it into a dynamic EMVCo
// QR with the pass price and a unique reference (shared/emvqr.js). The player
// pays with any Fonepay / mobile-banking app, then enters the transaction code
// from their receipt. KTM Tronix checks it against their Fonepay statement and
// approves it on /admin, which activates the pass.

import qrcode from 'qrcode-generator'
import { describeQr, toDynamicQr } from '../../../shared/emvqr.js'

const now = () => Math.floor(Date.now() / 1000)
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const TXN_RE = /^[A-Za-z0-9-]{4,40}$/
const REUSE_SECONDS = 24 * 3600

const QR_KEY = 'fonepay_qr'

// { payload, source: 'admin' | 'secret', updatedAt?, updatedBy? } or null.
export async function fonepayQr(env) {
  const row = await env.DB.prepare('SELECT value, updated_at, updated_by FROM settings WHERE key = ?1').bind(QR_KEY).first()
  if (row) return { payload: row.value, source: 'admin', updatedAt: row.updated_at, updatedBy: row.updated_by }
  if (env.FONEPAY_QR) return { payload: String(env.FONEPAY_QR).trim(), source: 'secret' }
  return null
}

export async function fonepayConfigured(env) {
  return Boolean(await fonepayQr(env))
}

// Checks a decoded QR before it's saved: it must be a valid EMVCo merchant QR
// that we can turn into a dynamic one.
export function checkQr(payload) {
  const text = String(payload || '').trim()
  if (!text) return { error: 'No QR text.' }
  if (text.length > 512) return { error: 'That QR is too long to be a merchant payment QR.' }
  let info
  try {
    info = describeQr(text)
    toDynamicQr(text, { amount: 1, reference: 'TEST' })
  } catch (err) {
    return { error: `Not a Fonepay / EMVCo merchant QR: ${err.message}` }
  }
  if (!info.crcOk) return { error: 'The QR checksum is wrong. Re-take the photo or paste the exact text.' }
  return { payload: text, info }
}

export async function saveFonepayQr(env, admin, body) {
  if (body.clear) {
    await env.DB.prepare('DELETE FROM settings WHERE key = ?1').bind(QR_KEY).run()
    return { ok: true }
  }
  const checked = checkQr(body.payload)
  if (checked.error) return { error: checked.error, status: 400 }
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  )
    .bind(QR_KEY, checked.payload, now(), admin.email)
    .run()
  return { ok: true, qr: checked.info }
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

function view(qr, env, p) {
  const amount = p.amount
  const payload = toDynamicQr(qr.payload, { amount, reference: p.reference, purpose: 'Tronix Arena pass' })
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
  const qr = await fonepayQr(env)
  if (!qr) return { error: 'Fonepay payments are not set up yet.', status: 503 }
  const open = await env.DB.prepare(
    `SELECT * FROM payments WHERE user_id = ?1 AND method = 'fonepay' AND status IN ('awaiting', 'submitted')
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(user.id)
    .first()
  if (open && (open.status === 'submitted' || now() - open.created_at < REUSE_SECONDS)) return { payment: view(qr, env, open) }

  const p = {
    id: crypto.randomUUID(),
    reference: newReference(),
    amount: passPrice(env).toFixed(2),
    status: 'awaiting',
  }
  toDynamicQr(qr.payload, { amount: p.amount, reference: p.reference }) // fail before saving if the stored QR is bad
  await env.DB.prepare(
    `INSERT INTO payments (id, user_id, reference, method, amount, status, created_at) VALUES (?1, ?2, ?3, 'fonepay', ?4, 'awaiting', ?5)`,
  )
    .bind(p.id, user.id, p.reference, p.amount, now())
    .run()
  return { payment: view(qr, env, p) }
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
