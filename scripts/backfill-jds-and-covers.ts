#!/usr/bin/env npx ts-node --esm
/**
 * Backfill Script — Fetch missing JDs and generate cover letters for all qualifying jobs.
 *
 * Usage:
 *   npx ts-node --esm scripts/backfill-jds-and-covers.ts [--user-id <uuid>] [--min-score <n>] [--dry-run]
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fetchJobDescription } from '../src/utils/jd-scraper.js';
import { generateCoverLetterText } from '../src/utils/cover-letter-generator.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let userId: string | null = null;
  let minScore = 70;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--user-id' && args[i + 1]) { userId = args[++i]; }
    else if (args[i] === '--min-score' && args[i + 1]) { minScore = parseInt(args[++i], 10); }
    else if (args[i] === '--dry-run') { dryRun = true; }
  }

  return { userId, minScore, dryRun };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { userId, minScore, dryRun } = parseArgs();

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  Core Line 2.0 — JD & Cover Letter Backfill  ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`  Min fit score: ${minScore}`);
  console.log(`  User filter:   ${userId || 'all users'}`);
  console.log(`  Dry run:       ${dryRun}`);
  console.log('');

  // ── Phase 1: Fetch missing JDs ──────────────────────────────────────────

  let jdQuery = supabase
    .from('v2_jobs')
    .select('id, user_id, title, company, url, cover_letter')
    .gte('fit_score', minScore)
    .is('job_description', null)
    .not('url', 'is', null)
    .order('fit_score', { ascending: false });

  if (userId) jdQuery = jdQuery.eq('user_id', userId);

  const { data: jobsNeedingJd, error: jdErr } = await jdQuery;
  if (jdErr) { console.error('Query error:', jdErr.message); process.exit(1); }

  console.log(`Phase 1: ${jobsNeedingJd?.length || 0} jobs need JD fetch\n`);

  let jdFetched = 0;
  let jdFailed = 0;

  for (const job of jobsNeedingJd || []) {
    process.stdout.write(`  [JD] ${job.company} — ${job.title} ... `);

    if (dryRun) {
      console.log('(dry run, skipped)');
      continue;
    }

    try {
      const result = await fetchJobDescription(job.url!);
      if (result.text) {
        await supabase
          .from('v2_jobs')
          .update({ job_description: result.text })
          .eq('id', job.id);
        jdFetched++;
        console.log(`✓ ${result.source} (${result.text.length} chars)`);
      } else {
        jdFailed++;
        console.log(`✗ ${result.error || 'no content'}`);
      }
    } catch (err: any) {
      jdFailed++;
      console.log(`✗ ${err.message}`);
    }

    // Rate limit: 600ms between requests
    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`\n  JD Results: ${jdFetched} fetched, ${jdFailed} failed\n`);

  // ── Phase 2: Generate missing cover letters ─────────────────────────────

  let clQuery = supabase
    .from('v2_jobs')
    .select('id, user_id, title, company, job_description, location, fit_score')
    .gte('fit_score', minScore)
    .not('job_description', 'is', null)
    .is('cover_letter', null);

  if (userId) clQuery = clQuery.eq('user_id', userId);

  const { data: jobsNeedingCl, error: clErr } = await clQuery;
  if (clErr) { console.error('Query error:', clErr.message); process.exit(1); }

  console.log(`Phase 2: ${jobsNeedingCl?.length || 0} jobs need cover letters\n`);

  // Cache user profiles to avoid repeated lookups
  const profileCache = new Map<string, any>();
  let clGenerated = 0;
  let clSkipped = 0;

  for (const job of jobsNeedingCl || []) {
    process.stdout.write(`  [CL] ${job.company} — ${job.title} ... `);

    if (dryRun) {
      console.log('(dry run, skipped)');
      continue;
    }

    // Get or cache user profile
    if (!profileCache.has(job.user_id)) {
      const { data: profile } = await supabase
        .from('v2_users')
        .select('full_name, resume_text, profile_data')
        .eq('id', job.user_id)
        .single();
      profileCache.set(job.user_id, profile);
    }

    const profile = profileCache.get(job.user_id);
    if (!profile?.resume_text) {
      clSkipped++;
      console.log('✗ no resume text for this user');
      continue;
    }

    try {
      const coverLetter = generateCoverLetterText(profile, job);
      await supabase
        .from('v2_jobs')
        .update({ cover_letter: coverLetter })
        .eq('id', job.id);
      clGenerated++;
      console.log(`✓ (${coverLetter.length} chars)`);
    } catch (err: any) {
      console.log(`✗ ${err.message}`);
    }
  }

  console.log(`\n  CL Results: ${clGenerated} generated, ${clSkipped} skipped (no profile)\n`);

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║  BACKFILL COMPLETE                            ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  JDs fetched:          ${String(jdFetched).padStart(4)}                  ║`);
  console.log(`║  JDs failed:           ${String(jdFailed).padStart(4)}                  ║`);
  console.log(`║  Cover letters:        ${String(clGenerated).padStart(4)}                  ║`);
  console.log(`║  Skipped (no profile): ${String(clSkipped).padStart(4)}                  ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
