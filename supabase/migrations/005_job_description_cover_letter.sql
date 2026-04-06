-- Core Line 2.0: Add job_description and cover_letter columns to v2_jobs
-- Supports storing full job descriptions and AI-generated cover letters

ALTER TABLE v2_jobs ADD COLUMN IF NOT EXISTS job_description TEXT;
ALTER TABLE v2_jobs ADD COLUMN IF NOT EXISTS cover_letter TEXT;
