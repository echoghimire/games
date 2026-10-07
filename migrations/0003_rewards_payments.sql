-- Seasons, rewards, Hall of Legends, daily loot drops and Fonepay payments.
-- Kept in sync with shared/schema.js, which the Workers also run on first
-- use (IF NOT EXISTS), so a missed migration cannot break the site.

CREATE TABLE IF NOT EXISTS season_scores (
  season TEXT NOT NULL,          -- "YYYY-MM", Nepal time
  game TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  best INTEGER NOT NULL,
  plays INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season, game, user_id)
);
CREATE INDEX IF NOT EXISTS season_scores_board ON season_scores (season, game, best DESC);
CREATE INDEX IF NOT EXISTS season_scores_user ON season_scores (user_id);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  prize TEXT NOT NULL DEFAULT '',
  game TEXT,                     -- null = all games / general
  season TEXT,                   -- null = not tied to a season
  image_url TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER,               -- hide after this time (unix seconds)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS winners (
  id TEXT PRIMARY KEY,
  season TEXT NOT NULL,
  game TEXT NOT NULL,            -- a game id, or "raffle"
  rank INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  prize TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | contacted | shipped
  created_at INTEGER NOT NULL,
  UNIQUE (season, game, rank)
);

CREATE TABLE IF NOT EXISTS drops (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,             -- "YYYY-MM-DD", Nepal time
  season TEXT NOT NULL,
  rarity TEXT NOT NULL,
  tickets INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS drops_season ON drops (season, user_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,          -- "fonepay"
  amount TEXT NOT NULL,
  txn_code TEXT,
  status TEXT NOT NULL,          -- awaiting | submitted | approved | rejected
  note TEXT,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS payments_user ON payments (user_id, created_at);
CREATE INDEX IF NOT EXISTS payments_status ON payments (status, submitted_at);
CREATE UNIQUE INDEX IF NOT EXISTS payments_txn ON payments (txn_code) WHERE txn_code IS NOT NULL;
