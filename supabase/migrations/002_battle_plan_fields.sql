-- Core Line 2.0: Battle Plan Field Additions
-- Adds columns needed for the battle plan workflow, warmth tracking,
-- Gmail integration, and follow-up timer system.

-- v2_jobs: battle plan fields
ALTER TABLE v2_jobs ADD COLUMN IF NOT EXISTS match_score INT;
ALTER TABLE v2_jobs ADD COLUMN IF NOT EXISTS resume_variant TEXT;
ALTER TABLE v2_jobs ADD COLUMN IF NOT EXISTS posting_status TEXT DEFAULT 'live';
ALTER TABLE v2_jobs ADD COLUMN IF NOT EXISTS posting_verified_at TIMESTAMPTZ;
ALTER TABLE v2_jobs ADD COLUMN IF NOT EXISTS outreach_draft TEXT;

-- v2_contacts: warmth tracking
ALTER TABLE v2_contacts ADD COLUMN IF NOT EXISTS warmth_score INT DEFAULT 0;
ALTER TABLE v2_contacts ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
ALTER TABLE v2_contacts ADD COLUMN IF NOT EXISTS response_count INT DEFAULT 0;

-- v2_outreach: Gmail tracking
ALTER TABLE v2_outreach ADD COLUMN IF NOT EXISTS gmail_draft_id TEXT;
ALTER TABLE v2_outreach ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
ALTER TABLE v2_outreach ADD COLUMN IF NOT EXISTS subject_line TEXT;

-- v2_followups: timer system
ALTER TABLE v2_followups ADD COLUMN IF NOT EXISTS timer_type TEXT DEFAULT 'outreach_email';
ALTER TABLE v2_followups ADD COLUMN IF NOT EXISTS business_days_window INT DEFAULT 3;

-- Autopilot mode support
ALTER TABLE v2_users ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE v2_users ADD COLUMN IF NOT EXISTS review_window_hours INT DEFAULT 4;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_v2_jobs_posting_status ON v2_jobs(posting_status);
CREATE INDEX IF NOT EXISTS idx_v2_jobs_match_score ON v2_jobs(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_v2_contacts_warmth ON v2_contacts(warmth_score DESC);
CREATE INDEX IF NOT EXISTS idx_v2_followups_timer_type ON v2_followups(timer_type);
CREATE INDEX IF NOT EXISTS idx_v2_outreach_gmail_message ON v2_outreach(gmail_message_id);

-- Add CHECK constraint for timer_type
ALTER TABLE v2_followups ADD CONSTRAINT chk_timer_type
  CHECK (timer_type IS NULL OR timer_type IN (
    'application', 'outreach_email', 'outreach_linkedin',
    'linkedin_connection', 'interview_thankyou', 'general_followup'
  ));

-- Add CHECK constraint for posting_status
ALTER TABLE v2_jobs ADD CONSTRAINT chk_posting_status
  CHECK (posting_status IS NULL OR posting_status IN ('live', 'dead', 'expired', 'unknown'));
