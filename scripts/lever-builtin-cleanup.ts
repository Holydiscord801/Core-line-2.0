/**
 * scripts/lever-builtin-cleanup.ts
 *
 * One-shot audit and remediation: find all v2_jobs whose URL points to
 * lever.co or builtin.com and either replace with an allowed source or
 * archive with a reason note.
 *
 * Allowed sources: linkedin, indeed, greenhouse, workday, direct company careers page.
 * Blacklisted: lever.co, builtin.com (always behind the actual hiring cycle).
 *
 * Run:
 *   npx ts-node --esm scripts/lever-builtin-cleanup.ts
 * or compile and run the dist file.
 *
 * Executed manually on 2026-04-07. Results recorded in:
 *   /home/micah/clawd/dispatch-share/lever-builtin-cleanup-2026-04-07.md
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TERMINAL_STATUSES = new Set(['applied', 'interviewing', 'offer', 'rejected']);
const ARCHIVE_NOTE = 'removed 2026-04-07 per source allowlist (Lever/Built In blacklisted, no replacement found)';

// Replacements discovered by searching LinkedIn, Greenhouse, Workday, and direct company pages.
const REPLACEMENTS: Record<string, { url: string; source: string }> = {
  // Aclima - VP of Engineering
  '060e95a6-b2c2-43c7-97b1-5be1f1c594e3': {
    url: 'https://www.linkedin.com/jobs/view/vice-president-of-engineering-at-aclima-inc-4045324959',
    source: 'linkedin',
  },
  // Antenna - VP Engineering
  'b8685664-829c-48f3-b067-91dd9973d2ff': {
    url: 'https://job-boards.greenhouse.io/antenna/jobs/5762515004',
    source: 'other', // greenhouse not in legacy source enum, closest valid value
  },
  // AcuityMD - Director/VP Data Engineering
  '530377ce-0a41-4eee-8d5b-5c3906f7fa8d': {
    url: 'https://job-boards.greenhouse.io/acuitymd/jobs/5753747004',
    source: 'other',
  },
  // CoStar Group (LoopNet) - VP Software Engineering
  'a5b0a616-fc6a-4538-bb2b-51345e7503f2': {
    url: 'https://costar.wd1.myworkdayjobs.com/CoStarCareers/job/Orange-County---CA/LoopNet---Vice-President--Software-Engineering_R36502',
    source: 'other', // workday not in legacy source enum
  },
};

async function main() {
  const start = Date.now();

  // Phase 1: Fetch all lever.co and builtin.com jobs
  const [leverRes, builtinRes] = await Promise.all([
    supabase
      .from('v2_jobs')
      .select('id, company, title, source, url, status, notes')
      .ilike('url', '%lever.co%'),
    supabase
      .from('v2_jobs')
      .select('id, company, title, source, url, status, notes')
      .ilike('url', '%builtin%'),
  ]);

  const allJobs = [
    ...(leverRes.data ?? []),
    ...(builtinRes.data ?? []),
  ];

  console.log('\n=== PHASE 1: AUDIT ===');
  console.log(`Found ${allJobs.length} jobs on blacklisted sources.\n`);
  console.table(allJobs.map(j => ({
    id: j.id.slice(0, 8),
    company: j.company,
    title: j.title.slice(0, 40),
    status: j.status,
    url: (j.url ?? '').slice(0, 60),
  })));

  // Phase 2: Replace active jobs where a replacement URL is known
  console.log('\n=== PHASE 2: REPLACEMENTS ===');
  let replaced = 0;
  for (const job of allJobs) {
    if (TERMINAL_STATUSES.has(job.status)) {
      console.log(`SKIP (terminal) ${job.company} - ${job.title} [${job.status}]`);
      continue;
    }
    const replacement = REPLACEMENTS[job.id];
    if (!replacement) continue;

    const { error } = await supabase
      .from('v2_jobs')
      .update({
        url: replacement.url,
        source: replacement.source,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    if (error) {
      console.error(`FAILED to replace ${job.company}: ${error.message}`);
    } else {
      console.log(`REPLACED ${job.company} - ${job.title}`);
      console.log(`  old: ${job.url}`);
      console.log(`  new: ${replacement.url} (${replacement.source})`);
      replaced++;
    }
  }

  // Phase 3: Archive active jobs with no replacement
  console.log('\n=== PHASE 3: ARCHIVE ===');
  let archived = 0;
  for (const job of allJobs) {
    if (TERMINAL_STATUSES.has(job.status)) continue;
    if (REPLACEMENTS[job.id]) continue;

    const existingNotes = job.notes ? `${job.notes}\n\n${ARCHIVE_NOTE}` : ARCHIVE_NOTE;
    const { error } = await supabase
      .from('v2_jobs')
      .update({
        status: 'closed',
        notes: existingNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    if (error) {
      console.error(`FAILED to archive ${job.company}: ${error.message}`);
    } else {
      console.log(`ARCHIVED ${job.company} - ${job.title} (was: ${job.url})`);
      archived++;
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Audited:  ${allJobs.length}`);
  console.log(`Terminal: ${allJobs.filter(j => TERMINAL_STATUSES.has(j.status)).length} (left unchanged)`);
  console.log(`Replaced: ${replaced}`);
  console.log(`Archived: ${archived}`);
  console.log(`Elapsed:  ${elapsed}s`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
