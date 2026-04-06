-- Core Line 2.0: Add apply_links JSONB column to v2_jobs
-- Supports multiple apply source URLs per job (LinkedIn, Indeed, Greenhouse, etc.)

ALTER TABLE v2_jobs ADD COLUMN IF NOT EXISTS apply_links JSONB DEFAULT '[]'::jsonb;

-- Index for querying jobs that have apply links
CREATE INDEX IF NOT EXISTS idx_v2_jobs_apply_links ON v2_jobs USING gin(apply_links);
