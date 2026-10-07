-- Best score per player per mini-game, for the leaderboards.
-- IF NOT EXISTS: the arena Worker also creates this table on first use
-- (withScoresTable in apps/arena/src/index.js), so this must not fail if it is already there.
CREATE TABLE IF NOT EXISTS scores (
  game TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  best INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game, user_id)
);

CREATE INDEX IF NOT EXISTS scores_board ON scores (game, best DESC);
