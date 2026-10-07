// Monthly seasons on Nepal time (UTC+5:45, no daylight saving): the
// "2026-10" season runs from 1 October 00:00 to 31 October 23:59 in Kathmandu.

const NPT_OFFSET = (5 * 60 + 45) * 60 * 1000

export function seasonOf(ms = Date.now()) {
  return new Date(ms + NPT_OFFSET).toISOString().slice(0, 7)
}

// Calendar day in Nepal, for once-a-day things (the daily loot drop).
export function dayOf(ms = Date.now()) {
  return new Date(ms + NPT_OFFSET).toISOString().slice(0, 10)
}

export function previousSeason(season) {
  const [y, m] = season.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// Milliseconds until the season ends, for countdowns.
export function seasonEndsAt(season) {
  const [y, m] = season.split('-').map(Number)
  return Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - NPT_OFFSET
}

export const SEASON_RE = /^\d{4}-(0[1-9]|1[0-2])$/
