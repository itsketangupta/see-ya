CREATE TABLE IF NOT EXISTS submissions (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  project TEXT NOT NULL,
  link TEXT NOT NULL,
  project_type TEXT,
  description TEXT,
  code_url TEXT,
  demo_url TEXT,
  readme_url TEXT,
  screenshot_url TEXT,
  hackatime_project TEXT,
  hackatime_url TEXT,
  hackatime_time_url TEXT,
  ai_used BOOLEAN NOT NULL DEFAULT FALSE,
  ai_description TEXT,
  other_hc_program TEXT,
  hours NUMERIC(6,2) NOT NULL CHECK (hours >= 1 AND hours <= 200),
  rgb INTEGER NOT NULL CHECK (rgb >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'changes_needed', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  hackclub_sub TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  hackatime_url TEXT,
  hackatime_connected BOOLEAN NOT NULL DEFAULT FALSE,
  hackatime_token TEXT,
  hackatime_user_id TEXT,
  slack_id TEXT,
  verification_status TEXT,
  ysws_eligible BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  grant_id TEXT NOT NULL,
  grant_name TEXT NOT NULL,
  cost INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  email TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'fulfilled', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_status_check CHECK (status IN ('draft', 'pending', 'approved', 'changes_needed', 'rejected'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS project_type TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS code_url TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS demo_url TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS readme_url TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS hackatime_project TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS hackatime_url TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS hackatime_time_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_user_id TEXT;
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_rgb_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_rgb_check CHECK (rgb >= 0);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ai_used BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ai_description TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS other_hc_program TEXT;

CREATE INDEX IF NOT EXISTS submissions_status_created_idx ON submissions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
