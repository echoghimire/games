-- Best score per player per mini-game, for the leaderboards.
CREATE TABLE scores (
  game TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  best INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game, user_id)
);

CREATE INDEX scores_board ON scores (game, best DESC);
