-- Migration 012: AI-first onboarding — pairing, trials, propagation versioning, audit trail
--
-- Implements the schema changes described in docs/proposals/onboarding-redesign.md:
--   §3.2  Pairing handshake    — v2_api_keys.paired_at
--   §8 Q4 Trial timer          — v2_users.trial_started_at / trial_ends_at / trial_length_days
--   §5.3  Propagation staleness — v2_users.preferences_version
--                                 v2_jobs.preferences_version_at_score
--   §5.5  Audit trail           — v2_profile_changes table + indexes
--
-- This migration is pure DDL. No triggers, no functions, no policies. All
-- column additions use ADD COLUMN IF NOT EXISTS and the new table/indexes use
-- IF NOT EXISTS so the migration can be re-run safely.
--
-- Rollback:
--   -- Undo in reverse order. Run inside a transaction.
--   BEGIN;
--     DROP INDEX IF EXISTS idx_v2_profile_changes_created_at;
--     DROP INDEX IF EXISTS idx_v2_profile_changes_user_id;
--     DROP TABLE IF EXISTS v2_profile_changes;
--     ALTER TABLE v2_jobs  DROP COLUMN IF EXISTS preferences_version_at_score;
--     ALTER TABLE v2_users DROP COLUMN IF EXISTS preferences_version;
--     ALTER TABLE v2_users DROP COLUMN IF EXISTS trial_length_days;
--     ALTER TABLE v2_users DROP COLUMN IF EXISTS trial_ends_at;
--     ALTER TABLE v2_users DROP COLUMN IF EXISTS trial_started_at;
--     ALTER TABLE v2_api_keys DROP COLUMN IF EXISTS paired_at;
--   COMMIT;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. AI pairing handshake (§3.2)
-- -----------------------------------------------------------------------------
-- paired_at is NULL until the user's AI client makes its first successful MCP
-- tool call. The backend sets it to NOW() inside authenticateApiKey() on that
-- first call. The frontend polls GET /api/auth/api-keys/:id/status and flips
-- the Connect-AI overlay off once paired_at is populated.

ALTER TABLE v2_api_keys
  ADD COLUMN IF NOT EXISTS paired_at TIMESTAMPTZ NULL;

-- -----------------------------------------------------------------------------
-- 2. Trial timer (§8 Q4)
-- -----------------------------------------------------------------------------
-- Trial clock starts on the first set_resume_text() call — the moment the AI
-- has enough context to deliver value. trial_length_days is a column (not a
-- code constant) so we can A/B test 7 vs 14 days per user or per cohort by
-- updating a row, with no redeploy. Launch default is 7 days.

ALTER TABLE v2_users
  ADD COLUMN IF NOT EXISTS trial_started_at  TIMESTAMPTZ NULL;

ALTER TABLE v2_users
  ADD COLUMN IF NOT EXISTS trial_ends_at     TIMESTAMPTZ NULL;

ALTER TABLE v2_users
  ADD COLUMN IF NOT EXISTS trial_length_days INT NOT NULL DEFAULT 7;

-- -----------------------------------------------------------------------------
-- 3. Propagation versioning (§5.3)
-- -----------------------------------------------------------------------------
-- preferences_version is a monotonic counter on v2_users, incremented on every
-- set_* MCP tool write. score_job snapshots the counter into v2_jobs at the
-- time the fit_score is computed, so readers can detect stale scores with:
--   WHERE preferences_version_at_score < v2_users.preferences_version
-- and re-score inline before responding (see §5.4 eventual-consistency safety
-- net).

ALTER TABLE v2_users
  ADD COLUMN IF NOT EXISTS preferences_version INT NOT NULL DEFAULT 0;

ALTER TABLE v2_jobs
  ADD COLUMN IF NOT EXISTS preferences_version_at_score INT NULL;

-- -----------------------------------------------------------------------------
-- 4. Audit trail (§5.5)
-- -----------------------------------------------------------------------------
-- Every set_* MCP tool inserts a row here before writing to v2_users. Answers
-- "why did the pipeline change and when?" — debugging signal, plus user trust
-- ("my AI won't rewrite my profile without leaving a trail"). source_tool is
-- the name of the MCP tool that caused the change (e.g. 'set_preferences',
-- 'set_resume_text'). Propagation outcome fields are filled in after the
-- synchronous fan-out completes.

CREATE TABLE IF NOT EXISTS v2_profile_changes (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  field_name                TEXT NOT NULL,
  old_value                 JSONB,
  new_value                 JSONB,
  source_tool               TEXT,
  triggered_propagation     BOOLEAN DEFAULT FALSE,
  propagation_completed_at  TIMESTAMPTZ,
  propagation_error         TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_profile_changes_user_id
  ON v2_profile_changes(user_id);

CREATE INDEX IF NOT EXISTS idx_v2_profile_changes_created_at
  ON v2_profile_changes(created_at DESC);

COMMIT;
