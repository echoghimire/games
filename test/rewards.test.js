import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayOf, previousSeason, seasonEndsAt, seasonOf } from '../shared/season.js'
import { DROP_TABLE, rollDrop } from '../apps/landing/src/community.js'

test('seasons follow Nepal time (UTC+5:45)', () => {
  // 30 Sep 18:14 UTC = 1 Oct 00:00 NPT is already October.
  assert.equal(seasonOf(Date.UTC(2026, 8, 30, 18, 15)), '2026-10')
  assert.equal(seasonOf(Date.UTC(2026, 8, 30, 18, 14)), '2026-09')
  assert.equal(dayOf(Date.UTC(2026, 9, 7, 20, 0)), '2026-10-08')
  assert.equal(previousSeason('2026-01'), '2025-12')
  assert.equal(seasonEndsAt('2026-10'), Date.UTC(2026, 10, 1) - (5 * 60 + 45) * 60000)
})

test('daily drop odds match the table', () => {
  const counts = {}
  for (let i = 0; i < 1000; i++) {
    const d = rollDrop((i + 0.5) / 1000)
    counts[d.rarity] = (counts[d.rarity] || 0) + 1
  }
  const total = DROP_TABLE.reduce((n, d) => n + d.weight, 0)
  for (const d of DROP_TABLE) assert.equal(counts[d.rarity], (1000 * d.weight) / total)
})
