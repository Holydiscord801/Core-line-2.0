-- Core Line 2.0: Extended user profile data for cover letter personalization
-- Adds profile_data JSONB to v2_users for career highlights, skills, contact info

ALTER TABLE v2_users ADD COLUMN IF NOT EXISTS profile_data JSONB DEFAULT '{}';

-- Index for quick access
CREATE INDEX IF NOT EXISTS idx_v2_users_profile_data ON v2_users USING GIN (profile_data);

-- Seed Micah's profile data (update email/user record if already exists)
-- This is a reference only; actual seeding should happen via the onboarding flow
COMMENT ON COLUMN v2_users.profile_data IS 'Extended profile: { career_highlights, key_achievements, contact_email, contact_phone, skills }';
