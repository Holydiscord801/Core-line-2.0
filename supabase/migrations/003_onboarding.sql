-- Core Line 2.0: Onboarding support
-- Adds onboarding_complete flag to track whether a user has finished setup.

ALTER TABLE v2_users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT false;

-- Index for quick lookup of incomplete onboarding
CREATE INDEX IF NOT EXISTS idx_v2_users_onboarding ON v2_users(onboarding_complete) WHERE onboarding_complete = false;
