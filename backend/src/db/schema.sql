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

-- ============================================================
-- ACCOUNT TRANSFERS
-- Cash flows in/out of accounts. Used for TWR calculation so
-- that deposits and withdrawals don't inflate or deflate returns.
-- Positive amount = deposit/transfer_in; negative = withdrawal/transfer_out.
-- ============================================================
CREATE TABLE IF NOT EXISTS account_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount          NUMERIC(15,2) NOT NULL,
  transfer_type   TEXT NOT NULL
                  CHECK (transfer_type IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out')),
  transferred_at  DATE NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transfers_user    ON account_transfers (user_id);
CREATE INDEX IF NOT EXISTS idx_transfers_account ON account_transfers (account_id, transferred_at);

-- source: 'manual' (user-entered) | 'snaptrade' (auto-created from transaction sync)
-- snaptrade_tx_id: prevents duplicate transfers on re-sync
ALTER TABLE account_transfers
  ADD COLUMN IF NOT EXISTS source          TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS snaptrade_tx_id TEXT;

-- Partial unique index: allows NULLs for manual entries while deduplicating SnapTrade ones
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_snaptrade_tx
  ON account_transfers (snaptrade_tx_id) WHERE snaptrade_tx_id IS NOT NULL;

-- ============================================================
-- COMPOSER CREDENTIALS
-- Stores encrypted Composer Direct API key per user (at most
-- one row per user via the UNIQUE constraint on user_id).
-- key_secret_enc is AES-256-GCM ciphertext via secretCrypto.js.
-- ============================================================
CREATE TABLE IF NOT EXISTS composer_credentials (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id)
                             ON DELETE CASCADE UNIQUE,
  key_id         TEXT        NOT NULL,
  key_secret_enc TEXT        NOT NULL,
  synced_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_composer_creds_user ON composer_credentials (user_id);

-- ============================================================
-- CSV IMPORT — source tag on transactions
-- Distinguishes snaptrade, csv_import, and manual rows.
-- ============================================================
ALTER TABLE account_transactions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'snaptrade';

-- ============================================================
-- CSV IMPORT LOG
-- One row per file import; stores counts and warnings so the
-- Import page can show "Last imported: Aug 5 2026 · 312 txns".
-- Clearing this table does NOT delete the imported transactions.
-- ============================================================
CREATE TABLE IF NOT EXISTS csv_import_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename              TEXT,
  format                TEXT        NOT NULL DEFAULT 'fidelity',
  transactions_imported INTEGER     NOT NULL DEFAULT 0,
  snapshots_created     INTEGER     NOT NULL DEFAULT 0,
  accounts_matched      INTEGER     NOT NULL DEFAULT 0,
  accounts_unmatched    INTEGER     NOT NULL DEFAULT 0,
  date_earliest         DATE,
  date_latest           DATE,
  warnings              JSONB       NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_csv_import_log_user ON csv_import_log (user_id, created_at DESC);

-- ============================================================
-- TRACKING FLAGS
-- include_in_tracking: when false the account is still synced but excluded
--   from net-worth totals, snapshots, and performance charts.
-- fidelity_account_number: links a RetireView account to its Fidelity
--   account number so the CSV importer can match by number on re-imports.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS include_in_tracking    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fidelity_account_number TEXT;

-- ============================================================
-- ACCOUNT TRANSACTIONS
-- Individual trade/income/transfer events pulled from SnapTrade.
-- Keyed on (account_id, external_id) for idempotent re-syncs.
-- CONTRIBUTION and WITHDRAWAL rows automatically generate a
-- matching account_transfers row so TWR needs no manual input
-- for SnapTrade-linked accounts.
-- ============================================================
CREATE TABLE IF NOT EXISTS account_transactions (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID    NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  account_id       UUID    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_id      TEXT    NOT NULL,       -- SnapTrade activity id
  transaction_type TEXT    NOT NULL,       -- BUY, SELL, DIVIDEND, CONTRIBUTION, WITHDRAWAL, …
  amount           NUMERIC(15,2),          -- cash value; null for some equity trades
  price            NUMERIC(15,6),          -- per-unit price
  units            NUMERIC(15,6),          -- shares/units traded
  symbol           TEXT,                   -- ticker
  currency         TEXT    NOT NULL DEFAULT 'USD',
  transacted_at    DATE    NOT NULL,
  description      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_transactions_account
  ON account_transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date
  ON account_transactions (account_id, transacted_at DESC);

-- ============================================================
-- PORTFOLIO HISTORY
-- Daily NAV values per account, pulled from Composer API.
-- Provides dense time-series for the Performance page charts,
-- replacing sparse snapshots for Composer-sourced accounts.
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_history (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  history_date    DATE NOT NULL,
  portfolio_value NUMERIC(15,2) NOT NULL,
  source          TEXT NOT NULL DEFAULT 'composer',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, history_date)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_history_account
  ON portfolio_history(account_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_history_user_date
  ON portfolio_history(user_id, history_date);

-- ============================================================
-- ACCOUNT ALIASES
-- display_name: user-chosen friendly name shown in charts and
--   reports. Falls back to the system-assigned name column when null.
-- name stays as the canonical broker-assigned identifier so
--   sync services can always match on it.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- ============================================================
-- ACCOUNT ARCHIVE STATUS
-- archived_at: NULL = active account; timestamp = closed/archived.
-- Archived accounts are excluded from net worth but preserved
-- for historical charts and performance data.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

-- ============================================================
-- PROPERTIES
-- Real estate holdings tracked separately from liquid accounts.
-- estimated_value is updated in place; property_values keeps the
-- valuation history for charting.
-- ============================================================
CREATE TABLE IF NOT EXISTS properties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  property_type   TEXT NOT NULL DEFAULT 'residential'
                  CHECK (property_type IN ('residential', 'commercial', 'land', 'other')),
  address         TEXT,
  estimated_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  purchase_price  NUMERIC(15,2),
  purchase_date   DATE,
  mortgage_balance NUMERIC(15,2) DEFAULT 0,
  mortgage_payment NUMERIC(15,2) DEFAULT 0,
  mortgage_rate    NUMERIC(5,2),
  mortgage_maturity_date DATE,
  rental_income   NUMERIC(15,2) DEFAULT 0,
  rental_frequency TEXT DEFAULT 'monthly',
  notes           TEXT,
  is_primary_residence BOOLEAN DEFAULT false,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_properties_user ON properties(user_id);

CREATE TABLE IF NOT EXISTS property_values (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  estimated_value NUMERIC(15,2) NOT NULL,
  recorded_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  source          TEXT DEFAULT 'manual',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(property_id, recorded_date)
);
CREATE INDEX IF NOT EXISTS idx_property_values_property ON property_values(property_id);

-- ============================================================
-- RETIREMENT SCENARIOS
-- Named what-if projections for the Retirement page. One row per
-- scenario; is_active marks the one the Dashboard reads from.
-- Projection math lives in routes/scenarios.js.
-- ============================================================
CREATE TABLE IF NOT EXISTS retirement_scenarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT false,
  color           TEXT DEFAULT '#6366f1',

  -- Inputs
  current_age     INTEGER,
  retirement_age  INTEGER DEFAULT 67,
  life_expectancy INTEGER DEFAULT 90,

  -- Assets at retirement
  starting_portfolio NUMERIC(15,2),
  include_real_estate BOOLEAN DEFAULT false,
  real_estate_value   NUMERIC(15,2) DEFAULT 0,

  -- Return assumptions
  pre_retirement_return  NUMERIC(5,2) DEFAULT 10.0,
  post_retirement_return NUMERIC(5,2) DEFAULT 7.0,
  inflation_rate         NUMERIC(5,2) DEFAULT 3.0,

  -- Income sources
  social_security_monthly NUMERIC(15,2) DEFAULT 0,
  social_security_start_age INTEGER DEFAULT 67,
  pension_monthly         NUMERIC(15,2) DEFAULT 0,
  rental_income_monthly   NUMERIC(15,2) DEFAULT 0,
  other_income_monthly    NUMERIC(15,2) DEFAULT 0,

  -- Withdrawal strategy
  -- 'percentage' = withdraw X% per year
  -- 'fixed'      = withdraw fixed $ amount per year
  -- 'income_gap' = withdraw only what's needed above guaranteed income
  withdrawal_rate         NUMERIC(5,2) DEFAULT 4.0,
  withdrawal_type         TEXT DEFAULT 'percentage'
                          CHECK (withdrawal_type IN ('percentage', 'fixed', 'income_gap')),
  fixed_withdrawal_amount NUMERIC(15,2),

  -- Spending
  annual_spending_goal    NUMERIC(15,2),

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_retirement_scenarios_user ON retirement_scenarios(user_id);

-- Seed a default scenario for users that have none yet
INSERT INTO retirement_scenarios (user_id, name, is_active)
SELECT u.id, 'Moderate', true
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM retirement_scenarios rs WHERE rs.user_id = u.id
);

-- ============================================================
-- INCOME EVENTS
-- Dividend/interest/rental/capital-gain income entries for the
-- Income tracker page. Manual entries plus rows synced from
-- broker transaction feeds.
-- ============================================================
CREATE TABLE IF NOT EXISTS income_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL
                  CHECK (event_type IN ('dividend', 'interest', 'rental', 'capital_gain', 'other')),
  amount          NUMERIC(15,2) NOT NULL,
  symbol          TEXT,
  description     TEXT,
  event_date      DATE NOT NULL,
  tax_treatment   TEXT DEFAULT 'taxable'
                  CHECK (tax_treatment IN ('taxable', 'tax_deferred', 'tax_free')),
  source          TEXT DEFAULT 'manual',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_income_events_user ON income_events(user_id);
CREATE INDEX IF NOT EXISTS idx_income_events_date ON income_events(event_date);

-- ============================================================
-- EMAIL DIGEST PREFERENCES
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_digest_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS digest_frequency TEXT DEFAULT 'weekly';

-- ============================================================
-- HOUSEHOLD MEMBERS
-- Track spouse/partner/dependent financial data for combined view.
-- ============================================================
CREATE TABLE IF NOT EXISTS household_members (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  relationship            TEXT DEFAULT 'spouse',
  birth_year              INTEGER,
  current_age             INTEGER,
  employment_status       TEXT DEFAULT 'employed',
  monthly_income          NUMERIC(15,2) DEFAULT 0,
  social_security_monthly NUMERIC(15,2) DEFAULT 0,
  social_security_age     INTEGER DEFAULT 67,
  pension_monthly         NUMERIC(15,2) DEFAULT 0,
  retirement_age          INTEGER DEFAULT 67,
  estimated_assets        NUMERIC(15,2) DEFAULT 0,
  estimated_liabilities   NUMERIC(15,2) DEFAULT 0,
  include_in_combined     BOOLEAN DEFAULT true,
  notes                   TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_household_user ON household_members(user_id);

-- ============================================================
-- OTHER ASSETS
-- Business interests, IP, vehicles, collectibles, etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS other_assets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  asset_type          TEXT DEFAULT 'business',
  description         TEXT,
  estimated_value     NUMERIC(15,2) NOT NULL DEFAULT 0,
  ownership_pct       NUMERIC(5,2) DEFAULT 100.00,
  generates_income    BOOLEAN DEFAULT false,
  monthly_income      NUMERIC(15,2) DEFAULT 0,
  income_description  TEXT,
  expected_sale_age   INTEGER,
  expected_sale_value NUMERIC(15,2),
  notes               TEXT,
  archived_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_other_assets_user ON other_assets(user_id);

-- ============================================================
-- RETIREMENT SCENARIOS — spouse/partner income fields
-- ============================================================
ALTER TABLE retirement_scenarios
  ADD COLUMN IF NOT EXISTS include_spouse       BOOLEAN DEFAULT false;
ALTER TABLE retirement_scenarios
  ADD COLUMN IF NOT EXISTS spouse_ss_monthly    NUMERIC(15,2) DEFAULT 0;
ALTER TABLE retirement_scenarios
  ADD COLUMN IF NOT EXISTS spouse_ss_age        INTEGER DEFAULT 67;
ALTER TABLE retirement_scenarios
  ADD COLUMN IF NOT EXISTS spouse_pension_monthly NUMERIC(15,2) DEFAULT 0;
ALTER TABLE retirement_scenarios
  ADD COLUMN IF NOT EXISTS spouse_retirement_age  INTEGER DEFAULT 67;

-- ============================================================
-- PROPERTIES — partial ownership and selling-cost estimates
-- ============================================================
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS ownership_pct   NUMERIC(5,2) DEFAULT 100.00;
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) DEFAULT 6.00;
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS sale_costs      NUMERIC(15,2) DEFAULT 0;

-- ============================================================
-- MULTI-PROFILE HOUSEHOLD SUPPORT  (v0.5.0)
-- One login manages multiple profiles (self / spouse / partner
-- / dependent). Each profile has its own accounts, properties,
-- scenarios, etc. "Combined" view aggregates across all.
-- ============================================================

-- 1. PROFILES TABLE
CREATE TABLE IF NOT EXISTS profiles (
  id             SERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  relationship   TEXT DEFAULT 'self'
                 CHECK (relationship IN ('self','spouse','partner','dependent','other')),
  birth_year     INTEGER,
  is_primary     BOOLEAN DEFAULT false,
  color          TEXT DEFAULT '#6366f1',
  avatar_initial TEXT,        -- auto-set from name on insert/update if null
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

-- 2. SEED a primary profile for every existing user (idempotent)
INSERT INTO profiles (user_id, name, relationship, is_primary, color, avatar_initial)
SELECT
  u.id,
  COALESCE(NULLIF(SPLIT_PART(u.full_name, ' ', 1), ''), SPLIT_PART(u.email, '@', 1)),
  'self',
  true,
  '#6366f1',
  UPPER(LEFT(COALESCE(NULLIF(SPLIT_PART(u.full_name, ' ', 1), ''), SPLIT_PART(u.email, '@', 1)), 1))
FROM users u
WHERE u.id NOT IN (
  SELECT DISTINCT user_id FROM profiles WHERE is_primary = true
);

-- 3. ADD profile_id to every data table (nullable first, NOT NULL after migration)

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE other_assets
  ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE retirement_scenarios
  ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE income_events
  ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE portfolio_history
  ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE account_transfers
  ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

-- 4. MIGRATE existing rows to each user's primary profile
UPDATE accounts a
  SET profile_id = p.id
  FROM profiles p
  WHERE p.user_id = a.user_id AND p.is_primary = true AND a.profile_id IS NULL;

UPDATE properties a
  SET profile_id = p.id
  FROM profiles p
  WHERE p.user_id = a.user_id AND p.is_primary = true AND a.profile_id IS NULL;

UPDATE other_assets a
  SET profile_id = p.id
  FROM profiles p
  WHERE p.user_id = a.user_id AND p.is_primary = true AND a.profile_id IS NULL;

UPDATE retirement_scenarios a
  SET profile_id = p.id
  FROM profiles p
  WHERE p.user_id = a.user_id AND p.is_primary = true AND a.profile_id IS NULL;

UPDATE snapshots a
  SET profile_id = p.id
  FROM profiles p
  WHERE p.user_id = a.user_id AND p.is_primary = true AND a.profile_id IS NULL;

UPDATE goals a
  SET profile_id = p.id
  FROM profiles p
  WHERE p.user_id = a.user_id AND p.is_primary = true AND a.profile_id IS NULL;

UPDATE income_events a
  SET profile_id = p.id
  FROM profiles p
  WHERE p.user_id = a.user_id AND p.is_primary = true AND a.profile_id IS NULL;

UPDATE portfolio_history a
  SET profile_id = p.id
  FROM profiles p
  WHERE p.user_id = a.user_id AND p.is_primary = true AND a.profile_id IS NULL;

UPDATE account_transfers a
  SET profile_id = p.id
  FROM profiles p
  WHERE p.user_id = a.user_id AND p.is_primary = true AND a.profile_id IS NULL;

-- 5. ENFORCE NOT NULL on critical tables (safe after migration above)
ALTER TABLE accounts          ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE properties        ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE other_assets      ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE retirement_scenarios ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE snapshots         ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE income_events     ALTER COLUMN profile_id SET NOT NULL;
-- goals / portfolio_history / account_transfers remain nullable for safety

-- 6. FIX SNAPSHOTS unique constraint: was (user_id, snapped_at),
--    now must be (profile_id, snapped_at) to allow two profiles to
--    each have a snapshot on the same day.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'snapshots_user_id_snapped_at_key'
      AND conrelid = 'snapshots'::regclass
  ) THEN
    ALTER TABLE snapshots DROP CONSTRAINT snapshots_user_id_snapped_at_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_profile_date
  ON snapshots(profile_id, snapped_at);

-- 7. ADD INDEXES
CREATE INDEX IF NOT EXISTS idx_accounts_profile       ON accounts(profile_id);
CREATE INDEX IF NOT EXISTS idx_properties_profile     ON properties(profile_id);
CREATE INDEX IF NOT EXISTS idx_other_assets_profile   ON other_assets(profile_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_profile      ON retirement_scenarios(profile_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_profile      ON snapshots(profile_id);
CREATE INDEX IF NOT EXISTS idx_income_profile         ON income_events(profile_id);

-- ============================================================
-- RECURRING INCOME — persistent income streams (SS, pension,
-- employment, rental, annuity, etc.) used by the retirement
-- projection engine and the Income page.
-- ============================================================

CREATE TABLE IF NOT EXISTS recurring_income (
  id                    SERIAL PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id            INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  income_type           TEXT NOT NULL DEFAULT 'other'
                        CHECK (income_type IN (
                          'social_security','pension','annuity',
                          'rental','employment','other')),

  monthly_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- When does this income start?
  start_type            TEXT NOT NULL DEFAULT 'age'
                        CHECK (start_type IN ('now','age','date')),
  start_age             INTEGER,          -- used when start_type = 'age'
  start_date            DATE,             -- used when start_type = 'date'

  -- When does it end?
  end_type              TEXT NOT NULL DEFAULT 'lifetime'
                        CHECK (end_type IN ('lifetime','age','date','years')),
  end_age               INTEGER,          -- used when end_type = 'age'
  end_date              DATE,             -- used when end_type = 'date'
  end_years             INTEGER,          -- used when end_type = 'years' (certain period)

  -- Growth / COLA
  is_inflation_adjusted BOOLEAN NOT NULL DEFAULT false,
  annual_increase_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- 0 = fixed nominal; 2.5 = COLA; etc.

  -- Tax character
  tax_treatment         TEXT NOT NULL DEFAULT 'taxable'
                        CHECK (tax_treatment IN ('taxable','tax_deferred','tax_free')),

  -- What-if toggle (exclude from projections without deleting)
  is_active             BOOLEAN NOT NULL DEFAULT true,

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_income_user    ON recurring_income(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_income_profile ON recurring_income(profile_id);

-- ============================================================
-- CASH FLOW (v0.7.0) — gross income tracking + monthly expenses
-- ============================================================

-- Add gross_monthly_amount to recurring_income.
-- If null:  monthly_amount IS the net (take-home) amount.
-- If set:   monthly_amount = net, gross_monthly_amount = before-tax.
ALTER TABLE recurring_income
  ADD COLUMN IF NOT EXISTS gross_monthly_amount NUMERIC(15,2);

-- Monthly expenses for cash flow tracking.
CREATE TABLE IF NOT EXISTS monthly_expenses (
  id              SERIAL PRIMARY KEY,
  user_id         UUID NOT NULL
                  REFERENCES users(id)
                  ON DELETE CASCADE,
  profile_id      INTEGER
                  REFERENCES profiles(id)
                  ON DELETE CASCADE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'other',
  -- 'housing'|'utilities'|'insurance'|'food'|'transport'|
  -- 'healthcare'|'entertainment'|'travel'|'debt'|
  -- 'subscriptions'|'other'
  monthly_amount  NUMERIC(15,2) NOT NULL,

  -- Retirement behaviour
  continues_in_retirement  BOOLEAN DEFAULT true,
  retirement_amount        NUMERIC(15,2),
  -- null + continues=true → use monthly_amount
  -- set                   → use this in retirement

  -- Source tracking (prevents double-count with RE)
  source          TEXT DEFAULT 'manual',
  -- 'manual' | 'real_estate'
  source_id       TEXT,

  is_active       BOOLEAN DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user    ON monthly_expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_profile ON monthly_expenses(profile_id);
