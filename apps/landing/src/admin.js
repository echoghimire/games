// KTM Tronix staff tools (/admin). Admins are the accounts whose email is in
// the ADMIN_EMAILS variable (comma-separated).

import { describeQr } from '../../../shared/emvqr.js'
import { GAMES } from '../../../shared/games.js'
import { seasonOf, SEASON_RE } from '../../../shared/season.js'
import { fonepayQr, passPrice } from './fonepay.js'

const DAY = 86400
const now = () => Math.floor(Date.now() / 1000)
const WINNER_STATUSES = ['pending', 'contacted', 'shipped']

export function isAdmin(env, user) {
  if (!user) return false
  const list = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(user.email.toLowerCase())
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n)

export async function overview(env) {
  const season = seasonOf()
  const [pending, recent, rewards, seasons, winners, tickets] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.reference, p.amount, p.txn_code AS txnCode, p.status, p.submitted_at AS submittedAt, p.created_at AS createdAt,
              u.email, u.display_name AS name, u.paid_until AS paidUntil
       FROM payments p JOIN users u ON u.id = p.user_id WHERE p.status = 'submitted' ORDER BY p.submitted_at`,
    ),
    env.DB.prepare(
      `SELECT p.reference, p.amount, p.txn_code AS txnCode, p.status, p.reviewed_at AS reviewedAt, p.reviewed_by AS reviewedBy, p.note,
              u.email, u.display_name AS name
       FROM payments p JOIN users u ON u.id = p.user_id WHERE p.status IN ('approved', 'rejected')
       ORDER BY p.reviewed_at DESC LIMIT 30`,
    ),
    env.DB.prepare('SELECT * FROM rewards ORDER BY created_at DESC LIMIT 50'),
    env.DB.prepare(
      `SELECT s.season, COUNT(DISTINCT s.user_id) AS players, SUM(s.plays) AS plays,
              (SELECT COUNT(*) FROM winners w WHERE w.season = s.season AND w.game != 'raffle') AS winners,
              (SELECT COUNT(*) FROM winners w WHERE w.season = s.season AND w.game = 'raffle') AS raffleWinners
       FROM season_scores s GROUP BY s.season ORDER BY s.season DESC LIMIT 24`,
    ),
    env.DB.prepare(
      `SELECT w.*, u.email FROM winners w LEFT JOIN users u ON u.id = w.user_id ORDER BY w.season DESC, w.game, w.rank LIMIT 200`,
    ),
    env.DB.prepare(
      `SELECT d.user_id AS userId, u.display_name AS name, u.email, SUM(d.tickets) AS tickets
       FROM drops d JOIN users u ON u.id = d.user_id WHERE d.season = ?1 GROUP BY d.user_id ORDER BY tickets DESC LIMIT 50`,
    ).bind(season),
  ])

  const stored = await fonepayQr(env)
  let qr = null
  if (stored) {
    try {
      qr = describeQr(stored.payload)
    } catch (err) {
      qr = { error: String(err.message) }
    }
    Object.assign(qr, { source: stored.source, updatedAt: stored.updatedAt || null, updatedBy: stored.updatedBy || null })
  }
  return {
    season,
    games: GAMES.map(g => ({ id: g.id, title: g.title })),
    config: { fonepay: Boolean(stored), qr, price: passPrice(env), passDays: Number(env.PASS_DAYS || 30) },
    pending: pending.results,
    recent: recent.results,
    rewards: rewards.results,
    seasons: seasons.results,
    winners: winners.results,
    tickets: tickets.results,
  }
}

export async function reviewPayment(env, admin, body) {
  const id = clip(body.id, 64)
  if (body.action === 'approve') {
    const p = await env.DB.prepare(`SELECT user_id FROM payments WHERE id = ?1 AND status = 'submitted'`).bind(id).first()
    if (!p) return { error: 'Payment is not waiting for review.', status: 409 }
    const t = now()
    const days = Number(env.PASS_DAYS || 30)
    // Both in one batch: the status guard makes a double click a no-op.
    const [upd] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE payments SET status = 'approved', reviewed_at = ?1, reviewed_by = ?2 WHERE id = ?3 AND status = 'submitted'`,
      ).bind(t, admin.email, id),
      env.DB.prepare(
        `UPDATE users SET paid_until = MAX(COALESCE(paid_until, 0), ?1) + ?2
         WHERE id = ?3 AND EXISTS (SELECT 1 FROM payments WHERE id = ?4 AND reviewed_at = ?1 AND status = 'approved')`,
      ).bind(t, days * DAY, p.user_id, id),
    ])
    if (upd.meta.changes === 0) return { error: 'Payment was already reviewed.', status: 409 }
    return { ok: true }
  }
  if (body.action === 'reject') {
    const res = await env.DB.prepare(
      `UPDATE payments SET status = 'rejected', reviewed_at = ?1, reviewed_by = ?2, note = ?3, txn_code = NULL
       WHERE id = ?4 AND status = 'submitted'`,
    )
      .bind(now(), admin.email, clip(body.note, 200) || 'We could not find this payment.', id)
      .run()
    if (res.meta.changes === 0) return { error: 'Payment is not waiting for review.', status: 409 }
    return { ok: true }
  }
  return { error: 'Unknown action', status: 400 }
}

export async function saveReward(env, body) {
  const title = clip(body.title, 120)
  const text = clip(body.body, 1500)
  if (!title || !text) return { error: 'Title and text are required.', status: 400 }
  const game = GAMES.some(g => g.id === body.game) ? body.game : null
  const season = SEASON_RE.test(body.season || '') ? body.season : null
  const imageUrl = /^https:\/\/[^\s"'<>]+$/.test(body.imageUrl || '') ? body.imageUrl : null
  const endsAt = body.endsAt ? Math.floor(new Date(body.endsAt).getTime() / 1000) || null : null
  const id = body.id ? clip(body.id, 64) : crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO rewards (id, title, body, prize, game, season, image_url, pinned, ends_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT (id) DO UPDATE SET title = excluded.title, body = excluded.body, prize = excluded.prize, game = excluded.game,
       season = excluded.season, image_url = excluded.image_url, pinned = excluded.pinned, ends_at = excluded.ends_at`,
  )
    .bind(id, title, text, clip(body.prize, 120), game, season, imageUrl, body.pinned ? 1 : 0, endsAt, now())
    .run()
  return { ok: true, id }
}

export async function deleteReward(env, body) {
  await env.DB.prepare('DELETE FROM rewards WHERE id = ?1').bind(clip(body.id, 64)).run()
  return { ok: true }
}

// Writes the top `places` of every game in a season to the Hall of Legends.
// Re-running fills in missing places only (existing rows keep their status).
export async function finalizeSeason(env, body) {
  const season = String(body.season || '')
  if (!SEASON_RE.test(season)) return { error: 'Pick a season (YYYY-MM).', status: 400 }
  if (season >= seasonOf() && !body.force) return { error: 'This season is still running. Tick "force" to close it early.', status: 409 }
  const places = Math.min(Math.max(Number(body.places) || 3, 1), 10)
  const prizes = body.prizes || {}
  const rows = (
    await env.DB.prepare(
      `SELECT game, user_id, name, best, rn FROM (
         SELECT game, user_id, name, best, ROW_NUMBER() OVER (PARTITION BY game ORDER BY best DESC, updated_at ASC) AS rn
         FROM season_scores WHERE season = ?1) WHERE rn <= ?2`,
    )
      .bind(season, places)
      .all()
  ).results
  if (!rows.length) return { error: 'No scores in that season.', status: 404 }
  const t = now()
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO winners (id, season, game, rank, user_id, name, score, prize, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9)`,
  )
  const res = await env.DB.batch(
    rows.map(r => stmt.bind(crypto.randomUUID(), season, r.game, r.rn, r.user_id, r.name, r.best, clip(prizes[r.rn], 120), t)),
  )
  return { ok: true, added: res.reduce((n, x) => n + x.meta.changes, 0) }
}

// Draws a raffle winner for a season, weighted by loot-drop tickets.
// Earlier raffle winners of the same season are excluded.
export async function drawRaffle(env, body) {
  const season = String(body.season || '')
  if (!SEASON_RE.test(season)) return { error: 'Pick a season (YYYY-MM).', status: 400 }
  const pool = (
    await env.DB.prepare(
      `SELECT d.user_id, u.display_name AS name, SUM(d.tickets) AS tickets FROM drops d JOIN users u ON u.id = d.user_id
       WHERE d.season = ?1 AND d.user_id NOT IN (SELECT user_id FROM winners WHERE season = ?1 AND game = 'raffle')
       GROUP BY d.user_id`,
    )
      .bind(season)
      .all()
  ).results
  if (!pool.length) return { error: 'Nobody (left) with tickets in that season.', status: 404 }
  const total = pool.reduce((n, p) => n + p.tickets, 0)
  let r = (crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * total
  const winner = pool.find(p => (r -= p.tickets) < 0) || pool.at(-1)
  const rank =
    ((await env.DB.prepare(`SELECT MAX(rank) AS m FROM winners WHERE season = ?1 AND game = 'raffle'`).bind(season).first()).m || 0) + 1
  await env.DB.prepare(
    `INSERT INTO winners (id, season, game, rank, user_id, name, score, prize, status, created_at)
     VALUES (?1, ?2, 'raffle', ?3, ?4, ?5, ?6, ?7, 'pending', ?8)`,
  )
    .bind(crypto.randomUUID(), season, rank, winner.user_id, winner.name, winner.tickets, clip(body.prize, 120), now())
    .run()
  return { ok: true, winner: { name: winner.name, tickets: winner.tickets, of: total } }
}

export async function updateWinner(env, body) {
  const fields = []
  const args = []
  if (body.status !== undefined) {
    if (!WINNER_STATUSES.includes(body.status)) return { error: 'Bad status', status: 400 }
    fields.push('status = ?')
    args.push(body.status)
  }
  if (body.prize !== undefined) {
    fields.push('prize = ?')
    args.push(clip(body.prize, 120))
  }
  if (!fields.length) return { error: 'Nothing to change', status: 400 }
  await env.DB.prepare(`UPDATE winners SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...args, clip(body.id, 64))
    .run()
  return { ok: true }
}
