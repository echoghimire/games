// Player-facing community features: the logged-in dashboard, season
// leaderboards, the Hall of Legends, prize announcements and the free daily
// loot drop (raffle tickets for the monthly merch draw).

import { hasAccess } from '../../../shared/auth.js'
import { GAMES, GAME_BY_ID } from '../../../shared/games.js'
import { dayOf, seasonEndsAt, seasonOf, SEASON_RE } from '../../../shared/season.js'

const now = () => Math.floor(Date.now() / 1000)

// Free daily drop. Tickets enter the monthly merch raffle; nothing is sold.
export const DROP_TABLE = [
  { rarity: 'legendary', tickets: 15, weight: 2 },
  { rarity: 'epic', tickets: 6, weight: 10 },
  { rarity: 'rare', tickets: 3, weight: 28 },
  { rarity: 'common', tickets: 1, weight: 60 },
]

export function rollDrop(random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) {
  const total = DROP_TABLE.reduce((n, d) => n + d.weight, 0)
  let r = random * total
  for (const d of DROP_TABLE) {
    if ((r -= d.weight) < 0) return d
  }
  return DROP_TABLE.at(-1)
}

// Top `limit` per game, for a season ("YYYY-MM") or all time ("all").
export async function leaderboards(env, season, limit = 10) {
  const all = season === 'all'
  if (!all && !SEASON_RE.test(season)) throw new Error('Bad season')
  const sql = all
    ? `SELECT game, name, best FROM (SELECT game, name, best,
         ROW_NUMBER() OVER (PARTITION BY game ORDER BY best DESC, updated_at ASC) AS rn FROM scores) WHERE rn <= ?1`
    : `SELECT game, name, best, plays FROM (SELECT game, name, best, plays,
         ROW_NUMBER() OVER (PARTITION BY game ORDER BY best DESC, updated_at ASC) AS rn
         FROM season_scores WHERE season = ?2) WHERE rn <= ?1`
  const stmt = env.DB.prepare(sql)
  const rows = (await (all ? stmt.bind(limit) : stmt.bind(limit, season)).all()).results
  return GAMES.map(g => ({ ...publicGame(g), top: rows.filter(r => r.game === g.id).map(({ game, ...r }) => r) }))
}

function publicGame(g) {
  return { id: g.id, title: g.title, unit: g.unit }
}

export async function hallOfLegends(env) {
  const rows = (
    await env.DB.prepare(
      `SELECT season, game, rank, name, score, prize, status FROM winners
       ORDER BY season DESC, game, rank LIMIT 300`,
    ).all()
  ).results
  const seasons = []
  for (const r of rows) {
    let s = seasons.find(x => x.season === r.season)
    if (!s) seasons.push((s = { season: r.season, winners: [] }))
    s.winners.push({ ...r, title: r.game === 'raffle' ? 'Merch raffle' : GAME_BY_ID[r.game]?.title || r.game })
  }
  return seasons
}

export async function activeRewards(env) {
  return (
    await env.DB.prepare(
      `SELECT id, title, body, prize, game, season, image_url AS imageUrl, pinned, ends_at AS endsAt, created_at AS createdAt
       FROM rewards WHERE ends_at IS NULL OR ends_at > ?1 ORDER BY pinned DESC, created_at DESC LIMIT 20`,
    )
      .bind(now())
      .all()
  ).results
}

// Everything the logged-in home page shows about one player.
export async function dashboard(env, user) {
  const season = seasonOf()
  const today = dayOf()
  const [allTime, seasonal, drop, tickets, wins, payment] = await env.DB.batch([
    env.DB.prepare('SELECT game, best FROM scores WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('SELECT game, best, plays FROM season_scores WHERE user_id = ?1 AND season = ?2').bind(user.id, season),
    env.DB.prepare('SELECT rarity, tickets FROM drops WHERE user_id = ?1 AND day = ?2').bind(user.id, today),
    env.DB.prepare('SELECT COALESCE(SUM(tickets), 0) AS n FROM drops WHERE user_id = ?1 AND season = ?2').bind(user.id, season),
    env.DB.prepare('SELECT season, game, rank, prize, status FROM winners WHERE user_id = ?1 ORDER BY season DESC').bind(user.id),
    env.DB.prepare(
      'SELECT reference, status, amount, note, created_at AS createdAt FROM payments WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1',
    ).bind(user.id),
  ])

  // Ranks: how many players beat each of this player's bests.
  const rankStmts = []
  for (const r of allTime.results) {
    rankStmts.push(env.DB.prepare('SELECT COUNT(*) + 1 AS r FROM scores WHERE game = ?1 AND best > ?2').bind(r.game, r.best))
  }
  for (const r of seasonal.results) {
    rankStmts.push(
      env.DB.prepare('SELECT COUNT(*) + 1 AS r FROM season_scores WHERE season = ?1 AND game = ?2 AND best > ?3').bind(season, r.game, r.best),
    )
  }
  const ranks = rankStmts.length ? (await env.DB.batch(rankStmts)).map(x => x.results[0].r) : []

  const games = GAMES.map(g => ({ ...publicGame(g), best: null, rank: null, seasonBest: null, seasonRank: null, plays: 0 }))
  allTime.results.forEach((r, i) => Object.assign(games.find(g => g.id === r.game) || {}, { best: r.best, rank: ranks[i] }))
  seasonal.results.forEach((r, i) =>
    Object.assign(games.find(g => g.id === r.game) || {}, {
      seasonBest: r.best,
      seasonRank: ranks[allTime.results.length + i],
      plays: r.plays,
    }),
  )

  return {
    season,
    seasonEndsAt: seasonEndsAt(season),
    pass: { active: hasAccess(user), paidUntil: user.paid_until, payment: payment.results[0] || null },
    totals: {
      seasonPlays: games.reduce((n, g) => n + g.plays, 0),
      gamesPlayed: games.filter(g => g.best !== null).length,
      podiums: games.filter(g => g.seasonRank && g.seasonRank <= 3).length,
    },
    games,
    drop: { today: drop.results[0] || null, seasonTickets: tickets.results[0].n },
    wins: wins.results.map(w => ({ ...w, title: w.game === 'raffle' ? 'Merch raffle' : GAME_BY_ID[w.game]?.title || w.game })),
  }
}

export async function openDrop(env, user) {
  if (!hasAccess(user)) return { error: 'Daily drops are for players with an active arena pass.', status: 402 }
  const day = dayOf()
  const roll = rollDrop()
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO drops (user_id, day, season, rarity, tickets, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  )
    .bind(user.id, day, seasonOf(), roll.rarity, roll.tickets, now())
    .run()
  const opened = await env.DB.prepare('SELECT rarity, tickets FROM drops WHERE user_id = ?1 AND day = ?2').bind(user.id, day).first()
  const total = await env.DB.prepare('SELECT COALESCE(SUM(tickets), 0) AS n FROM drops WHERE user_id = ?1 AND season = ?2')
    .bind(user.id, seasonOf())
    .first()
  return { drop: opened, alreadyOpened: res.meta.changes === 0, seasonTickets: total.n }
}
