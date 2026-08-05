-- RetireView starter schema
-- Applied idempotently on every backend boot (see src/db/migrate.js).
-- Contains only auth + security infrastructure. Add domain tables at the bottom.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  full_name             TEXT,
  role                  TEXT NOT NULL DEFAULT 'user'
                        CHECK (role IN ('admin', 'user')),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  last_login_at         TIMESTAMPTZ,
  -- Password hashing: 1 = legacy bcrypt, 2 = argon2id (auto-migrated on login)
  password_hash_version INTEGER DEFAULT 1,
  -- 2FA
  two_fa_enabled        BOOLEAN DEFAULT true,
  two_fa_email          TEXT,
  totp_enabled          BOOLEAN DEFAULT false,
  preferred_2fa         TEXT DEFAULT 'email_otp',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- REFRESH TOKENS
-- Stored server-side (hashed) for revocation capability.
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ============================================================
-- MIGRATION LEDGER
-- Used by src/db/migrations.js for one-off data migrations.
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          BIGSERIAL PRIMARY KEY,
  version     TEXT NOT NULL UNIQUE,
  description TEXT,
  applied_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO schema_migrations (version, description)
VALUES ('00000000000000', 'baseline — starter schema')
ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- 2FA — EMAIL OTP + TRUSTED IPS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_trusted_ips (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address  TEXT NOT NULL,
  label       TEXT,
  first_seen  TIMESTAMPTZ DEFAULT NOW(),
  last_seen   TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, ip_address)
);
CREATE INDEX IF NOT EXISTS idx_trusted_ips_user ON user_trusted_ips (user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_ips_lookup ON user_trusted_ips (user_id, ip_address);

CREATE TABLE IF NOT EXISTS auth_otp (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  ip_address  TEXT,
  attempts    INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_otp_user ON auth_otp (user_id, expires_at);

-- ============================================================
-- SECURITY MODEL — LOGIN HISTORY, IP BLOCKING, TOTP
-- ============================================================
CREATE TABLE IF NOT EXISTS user_login_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  email          TEXT,
  ip_address     TEXT NOT NULL,
  user_agent     TEXT,
  country        TEXT,
  city           TEXT,
  region         TEXT,
  ll_json        TEXT,
  success        BOOLEAN NOT NULL,
  failure_reason TEXT,
  two_fa_used    BOOLEAN DEFAULT false,
  two_fa_method  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON user_login_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_ip ON user_login_history (ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_created ON user_login_history (created_at DESC);

CREATE TABLE IF NOT EXISTS blocked_ips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address    TEXT NOT NULL UNIQUE,
  reason        TEXT NOT NULL,
  blocked_at    TIMESTAMPTZ DEFAULT NOW(),
  blocked_by    TEXT DEFAULT 'system',
  expires_at    TIMESTAMPTZ,
  attempt_count INTEGER DEFAULT 0,
  is_permanent  BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_address ON blocked_ips (ip_address);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_expires ON blocked_ips (expires_at);

CREATE TABLE IF NOT EXISTS ip_failed_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address      TEXT NOT NULL,
  attempted_at    TIMESTAMPTZ DEFAULT NOW(),
  email_attempted TEXT,
  failure_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_failed_attempts_ip_time ON ip_failed_attempts (ip_address, attempted_at DESC);

CREATE TABLE IF NOT EXISTS user_totp (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  secret       TEXT NOT NULL,
  backup_codes TEXT[] NOT NULL,
  enabled_at   TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_totp_user ON user_totp (user_id);

-- ============================================================
-- ADD YOUR APP TABLES BELOW THIS LINE
-- ============================================================

-- ============================================================
-- ACCOUNTS
-- One row per tracked account (brokerage, 401k, home equity, ...).
-- Balances are updated in place; snapshots capture history.
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL
              CHECK (type IN ('brokerage', 'composer', 'retirement', 'pension',
                              'real_estate', 'cash', 'other')),
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (user_id);

-- ============================================================
-- SNAPSHOTS
-- Point-in-time record of total net worth. One per user per day;
-- re-snapshotting the same day replaces it.
-- ============================================================
CREATE TABLE IF NOT EXISTS snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total       NUMERIC(14,2) NOT NULL,
  note        TEXT,
  snapped_at  DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapped_at)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON snapshots (user_id, snapped_at DESC);

-- Per-account balances captured with each snapshot
CREATE TABLE IF NOT EXISTS account_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  balance     NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_snapshot ON account_snapshots (snapshot_id);

-- ============================================================
-- GOALS
-- Retirement target. One per user (upserted from the Goal page).
-- expected_return and amounts are stored as entered; the nest-egg
-- math lives in the frontend calculator.
-- ============================================================
-- SnapTrade linkage (personal API key mode): synced accounts carry the
-- SnapTrade account id and refresh their balance on sync; manual accounts
-- have source='manual' and are never touched by sync.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS institution TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_external
  ON accounts (user_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS goals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  target_amount         NUMERIC(14,2) NOT NULL,
  target_annual_income  NUMERIC(14,2),
  retirement_years      INTEGER,
  expected_return       NUMERIC(6,4),
  ss_monthly            NUMERIC(14,2),
  target_date           DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
