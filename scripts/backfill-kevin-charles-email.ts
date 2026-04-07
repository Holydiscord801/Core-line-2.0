/**
 * scripts/backfill-kevin-charles-email.ts
 *
 * One-shot, idempotent backfill: set v2_contacts.email for the BambooHR
 * Kevin Charles row to kcharles@bamboohr.com.
 *
 * Why: hot signal 90235cde flagged that Kevin's email field was null in
 * v2_contacts even though the active interview thread shows the real
 * address kcharles@bamboohr.com. The IS NULL guard means re-running this
 * script after a successful update is a no-op.
 *
 * Run:
 *   npx ts-node --esm scripts/backfill-kevin-charles-email.ts
 *
 * Approved by Micah on 2026-04-07 as part of Phase 2b of the timeline
 * build (separate from Phase 2a contact link fix and Phase 2c migration).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try worktree-local .env first, then walk up to the parent repo .env.
// This makes the script run cleanly from the main repo OR from any worktree
// under .claude/worktrees/<name>/.
const envCandidates = [
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '..', '..', '..', '.env'),
];
for (const p of envCandidates) {
  if (existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const KEVIN_CHARLES_CONTACT_ID = '72390e9c-b8ef-4ed3-9cdd-1f132194a145';
const KEVIN_CHARLES_EMAIL = 'kcharles@bamboohr.com';

async function main() {
  console.log('=== Kevin Charles email backfill ===');
  console.log(`target contact_id: ${KEVIN_CHARLES_CONTACT_ID}`);
  console.log(`target email:      ${KEVIN_CHARLES_EMAIL}`);

  // Pre-check: confirm the row exists, belongs to BambooHR, and has email IS NULL.
  const { data: before, error: beforeErr } = await supabase
    .from('v2_contacts')
    .select('id, name, title, company, email, linkedin_url')
    .eq('id', KEVIN_CHARLES_CONTACT_ID)
    .single();

  if (beforeErr || !before) {
    console.error(`Could not load Kevin Charles row: ${beforeErr?.message || 'not found'}`);
    process.exit(1);
  }

  console.log('\nBefore:');
  console.log(`  name:     ${before.name}`);
  console.log(`  title:    ${before.title}`);
  console.log(`  company:  ${before.company}`);
  console.log(`  email:    ${before.email ?? '<null>'}`);
  console.log(`  linkedin: ${before.linkedin_url ?? '<null>'}`);

  if (before.name !== 'Kevin Charles' || before.company !== 'BambooHR') {
    console.error('Sanity check failed: row name/company does not match expected Kevin Charles at BambooHR. Aborting.');
    process.exit(1);
  }

  if (before.email === KEVIN_CHARLES_EMAIL) {
    console.log('\nNo change: email is already set to the target value. Idempotent no-op.');
    return;
  }

  if (before.email !== null) {
    console.error(`\nRefusing to overwrite an existing non-null email: "${before.email}". Aborting.`);
    process.exit(1);
  }

  // Update with explicit IS NULL guard so concurrent writes can't trample data.
  const { data: after, error: updateErr } = await supabase
    .from('v2_contacts')
    .update({ email: KEVIN_CHARLES_EMAIL })
    .eq('id', KEVIN_CHARLES_CONTACT_ID)
    .is('email', null)
    .select('id, name, email')
    .single();

  if (updateErr || !after) {
    console.error(`UPDATE failed: ${updateErr?.message || 'no row returned (guard tripped)'}`);
    process.exit(1);
  }

  console.log('\nAfter:');
  console.log(`  email:    ${after.email}`);
  console.log('\nDone. 1 row updated.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
