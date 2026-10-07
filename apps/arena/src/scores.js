// The scores table comes from migrations/0002_scores.sql. If that migration
// was never applied to the live database, every leaderboard request would
// fail; create the table on first use instead.
export async function withScoresTable(env, fn) {
  try {
    return await fn()
  } catch (err) {
    if (!/no such table: scores/i.test(String(err?.message ?? err))) throw err
    await env.DB.batch([
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS scores (game TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
         best INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (game, user_id))`,
      ),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS scores_board ON scores (game, best DESC)'),
    ])
    return await fn()
  }
}
