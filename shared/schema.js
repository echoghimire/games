// Creates any missing tables (same statements as migrations/0002-0004),
// once per Worker instance. The live database once ran without a migration
// and every leaderboard failed; this keeps that from happening again.

import scoresSql from '../migrations/0002_scores.sql'
import rewardsSql from '../migrations/0003_rewards_payments.sql'
import settingsSql from '../migrations/0004_settings.sql'

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
    ready = env.DB.batch(statements([scoresSql, rewardsSql, settingsSql].join('\n')).map(s => env.DB.prepare(s))).catch(err => {
      ready = null // try again on the next request
      throw err
    })
  }
  return ready
}
