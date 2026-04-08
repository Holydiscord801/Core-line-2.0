-- 011_relax_jobs_source_enum.sql
-- Relax v2_jobs.source CHECK constraint to match the Core Line playbook
-- allowlist: LinkedIn, Indeed, Greenhouse, Workday, direct company pages.
--
-- Prior constraint (010 and earlier):
--   CHECK (source IN ('linkedin','indeed','google','glassdoor','manual','other'))
--
-- Problem: Greenhouse and Workday are first-class sources per the playbook
-- (see project_source_allowlist.md) but were not in the enum, forcing
-- BambooHR Director of SWE Payroll Services (2026-04-08) to be inserted
-- with source='other' instead of 'greenhouse'.
--
-- New allowlist adds: 'greenhouse', 'workday', 'direct'.
-- New allowlist drops: 'google', 'glassdoor' (not present in any live row
-- as of 2026-04-08 -- verified with SELECT DISTINCT source FROM v2_jobs
-- which returned only linkedin/manual/other).
-- New allowlist keeps: 'linkedin', 'indeed', 'manual', 'other' (legacy).

ALTER TABLE v2_jobs DROP CONSTRAINT IF EXISTS v2_jobs_source_check;

ALTER TABLE v2_jobs ADD CONSTRAINT v2_jobs_source_check
  CHECK (source IN (
    'linkedin',
    'indeed',
    'greenhouse',
    'workday',
    'direct',
    'manual',
    'other'
  ));
