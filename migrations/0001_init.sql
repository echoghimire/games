-- Users and their paid access. paid_until is a unix timestamp (seconds);
-- access to the arena is granted while paid_until > now.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  paid_until INTEGER,
  stripe_customer_id TEXT,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX users_stripe_customer ON users (stripe_customer_id);

-- Stripe webhook events already processed, so retries are idempotent.
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
