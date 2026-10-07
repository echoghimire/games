// Creates any missing tables (same statements as migrations/0002 and 0003),
// once per Worker instance. The live database once ran without a migration
// and every leaderboard failed; this keeps that from happening again.

import scoresSql from '../migrations/0002_scores.sql'
import rewardsSql from '../migrations/0003_rewards_payments.sql'

let ready = null

function statements(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
}

export function ensureSchema(env) {
  if (!ready) {
    ready = env.DB.batch(statements(scoresSql + '\n' + rewardsSql).map(s => env.DB.prepare(s))).catch(err => {
      ready = null // try again on the next request
      throw err
    })
  }
  return ready
}
