/**
 * scripts/backfill-bamboo-email-thread.ts
 *
 * One-shot, idempotent backfill: insert the BambooHR interview email thread
 * (Gmail thread 19d45d364e2f01d5) into v2_outreach as a new sequence with
 * three child attempts so the Phase 3 timeline UI renders both the LinkedIn
 * DM and the email exchange on the BambooHR job card.
 *
 * Why this is needed: the email-check-job-responses cron uses Gmail scanning
 * via the connected AI, and as of 2026-04-08 the thread had not landed in
 * v2_outreach. Micah only saw the one legacy LinkedIn DM on the timeline
 * despite having a live interview thread in Gmail. This script backfills the
 * thread directly so the morning view matches reality. The related ingest
 * bug in src/utils/email-monitor.ts (processSentOutreach not setting
 * sequence_id and using a stale channel enum) is patched in the same commit,
 * so future scans will land correctly.
 *
 * The script is idempotent: it checks for an existing email sequence on the
 * same (job, contact) pair before inserting, and skips cleanly if a
 * backfill has already run.
 *
 * Run:
 *   npx tsx scripts/backfill-bamboo-email-thread.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Target ids, verified live against Supabase on 2026-04-08.
const BAMBOO_JOB_ID = 'b06faa85-a221-4c1e-9c7f-9f9b4628669a';
const KEVIN_CHARLES_CONTACT_ID = '72390e9c-b8ef-4ed3-9cdd-1f132194a145';
const USER_ID = '349f82a7-2fd8-4d14-b309-ec94fb352b7a';
const GMAIL_THREAD_ID = '19d45d364e2f01d5';

const SEQUENCE_INTENT = `BambooHR interview scheduling thread (Gmail ${GMAIL_THREAD_ID})`;

// The three messages from the Gmail thread. Extracted verbatim on 2026-04-08
// via the Gmail MCP. Kevin's message is stored as an inbound attempt so the
// body is visible in the timeline even though v2_outreach was originally
// designed as an outbound-only table. The convention is:
//   - inbound messages use subject_line prefix "[inbound] "
//   - delivery_status 'delivered' for anything Gmail confirms sent or received
//   - delivery_status 'queued' for anything still in Drafts
type AttemptInput = {
  attempt_number: number;
  channel: 'email';
  delivery_status: 'delivered' | 'sent' | 'queued';
  sent_at: string;
  subject_line: string;
  message_text: string;
};

const ATTEMPTS: AttemptInput[] = [
  {
    attempt_number: 1,
    channel: 'email',
    delivery_status: 'delivered',
    sent_at: '2026-03-31T21:36:12+00:00',
    subject_line: '[inbound] BambooHR - Interview Details!',
    message_text:
      "From: Kevin Charles <kcharles@bamboohr.com>\n" +
      "To: micah.processmodel@gmail.com\n\n" +
      "Hi MICAH,\n\n" +
      "Thanks for submitting your availability for the VP of Engineering position! I'm excited to chat with you soon.\n\n" +
      "You're confirmed for your zoom interview on:\n" +
      "Date/Time: Apr 1, 2026 9:00am-9:30am MDT\n" +
      "Interviewers: Kevin Charles\n\n" +
      "Zoom: https://bamboohr.zoom.us/j/93732935775\n\n" +
      "A few things for you:\n" +
      "* During our interview, I would love to dive into our company values (see attachment) and hear your thoughts on them.\n" +
      "* To help you feel ready, please take a moment to check out our AI Guidelines for Candidates page.\n" +
      "* Our workplace is pretty relaxed, but we recommend business casual for your interview.\n" +
      "* Additionally, I have attached an overview document of our benefits.\n" +
      "* BambooHR has an amazing office in Draper, UT.\n\n" +
      "If you need to reschedule, or any questions come up before your interview, reach out any time!\n\n" +
      "Thanks!\n\n" +
      "Kevin Charles\n" +
      "Talent Acquisition Partner | BambooHR\n\n" +
      "Attachments: BambooHR_by_the_Numbers_2025.pdf, Benefits_Overview_2025.pdf, Values_One_Page.docx",
  },
  {
    attempt_number: 2,
    channel: 'email',
    delivery_status: 'delivered',
    sent_at: '2026-04-07T19:18:09+00:00',
    subject_line: 'Re: BambooHR - Interview Details!',
    message_text:
      "Kevin,\n\n" +
      "Had to laugh this week, after telling you we had no snow this year, we got dumped on overnight. Gone the next day. Classic Utah. The mountains still look like summer.\n\n" +
      "Anyway, just checking in. Really enjoyed our conversation and I have been looking forward to hearing about next steps. Wanted to make sure I stayed on your radar.\n\n" +
      "Happy to provide anything else you need.\n\n" +
      "Micah",
  },
  {
    attempt_number: 3,
    channel: 'email',
    delivery_status: 'queued',
    sent_at: '2026-04-08T17:06:27+00:00',
    subject_line: '[draft] Re: BambooHR - Interview Details!',
    message_text:
      "Draft reply queued in Gmail (not yet sent) as of 2026-04-08 11:06 MT. Body mirrors the 4/7 check in while Micah waits for Kevin's response before sending.",
  },
];

async function main() {
  console.log('=== BambooHR email thread backfill ===');
  console.log(`job_id:       ${BAMBOO_JOB_ID}`);
  console.log(`contact_id:   ${KEVIN_CHARLES_CONTACT_ID}`);
  console.log(`user_id:      ${USER_ID}`);
  console.log(`gmail thread: ${GMAIL_THREAD_ID}`);
  console.log();

  // Sanity check: confirm the job and contact exist.
  const [{ data: job, error: jobErr }, { data: contact, error: contactErr }] = await Promise.all([
    supabase.from('v2_jobs').select('id, title, company, status').eq('id', BAMBOO_JOB_ID).single(),
    supabase.from('v2_contacts').select('id, name, email, email_status').eq('id', KEVIN_CHARLES_CONTACT_ID).single(),
  ]);

  if (jobErr || !job) {
    console.error(`Could not load Bamboo job: ${jobErr?.message || 'not found'}`);
    process.exit(1);
  }
  if (contactErr || !contact) {
    console.error(`Could not load Kevin Charles contact: ${contactErr?.message || 'not found'}`);
    process.exit(1);
  }

  console.log(`Job:     ${job.title} at ${job.company} (status: ${job.status})`);
  console.log(`Contact: ${contact.name} <${contact.email ?? 'no-email'}> email_status=${contact.email_status ?? 'null'}`);
  console.log();

  // Idempotency check: if a sequence with our intent already exists for this
  // (job, contact) pair, skip.
  const { data: existingSeqs, error: existingErr } = await supabase
    .from('v2_outreach_sequences')
    .select('id, intent, created_at')
    .eq('user_id', USER_ID)
    .eq('job_id', BAMBOO_JOB_ID)
    .eq('contact_id', KEVIN_CHARLES_CONTACT_ID)
    .eq('intent', SEQUENCE_INTENT);

  if (existingErr) {
    console.error(`Failed to check for existing sequence: ${existingErr.message}`);
    process.exit(1);
  }

  if (existingSeqs && existingSeqs.length > 0) {
    console.log(`Sequence with intent "${SEQUENCE_INTENT}" already exists (id: ${existingSeqs[0].id}).`);
    console.log('Idempotent no-op. Nothing to insert.');
    return;
  }

  // Create the sequence. The recompute trigger will update last_attempted_at
  // / last_delivered_at / preferred_channel / status after the child inserts.
  const { data: newSeq, error: seqInsertErr } = await supabase
    .from('v2_outreach_sequences')
    .insert({
      user_id: USER_ID,
      job_id: BAMBOO_JOB_ID,
      contact_id: KEVIN_CHARLES_CONTACT_ID,
      intent: SEQUENCE_INTENT,
      status: 'active',
      first_attempted_at: ATTEMPTS[0].sent_at,
      last_attempted_at: ATTEMPTS[ATTEMPTS.length - 1].sent_at,
    })
    .select('id')
    .single();

  if (seqInsertErr || !newSeq) {
    console.error(`Failed to insert sequence: ${seqInsertErr?.message || 'no row returned'}`);
    process.exit(1);
  }

  console.log(`Inserted sequence ${newSeq.id}`);

  // Insert the three attempts as children of the new sequence.
  const attemptRows = ATTEMPTS.map(a => ({
    user_id: USER_ID,
    job_id: BAMBOO_JOB_ID,
    contact_id: KEVIN_CHARLES_CONTACT_ID,
    sequence_id: newSeq.id,
    attempt_number: a.attempt_number,
    channel: a.channel,
    delivery_status: a.delivery_status,
    sent_at: a.sent_at,
    subject_line: a.subject_line,
    message_text: a.message_text,
    response_received: false,
  }));

  const { data: insertedAttempts, error: attemptsErr } = await supabase
    .from('v2_outreach')
    .insert(attemptRows)
    .select('id, attempt_number, channel, delivery_status, sent_at');

  if (attemptsErr || !insertedAttempts) {
    console.error(`Failed to insert attempts: ${attemptsErr?.message || 'no rows returned'}`);
    process.exit(1);
  }

  console.log(`Inserted ${insertedAttempts.length} attempts:`);
  for (const a of insertedAttempts) {
    console.log(`  #${a.attempt_number} ${a.channel} ${a.delivery_status} @ ${a.sent_at}`);
  }

  // Mark Kevin's email as verified since the thread proves the address is
  // live and receiving mail.
  if (contact.email === 'kcharles@bamboohr.com' && contact.email_status !== 'verified') {
    const { error: contactUpdateErr } = await supabase
      .from('v2_contacts')
      .update({ email_status: 'verified' })
      .eq('id', KEVIN_CHARLES_CONTACT_ID);
    if (contactUpdateErr) {
      console.warn(`Could not update contact email_status: ${contactUpdateErr.message}`);
    } else {
      console.log('Updated Kevin Charles email_status to verified.');
    }
  }

  // Read back the sequence so we can see the trigger-computed fields.
  const { data: finalSeq } = await supabase
    .from('v2_outreach_sequences')
    .select('id, status, preferred_channel, last_attempted_at, last_delivered_at')
    .eq('id', newSeq.id)
    .single();

  console.log('\nSequence after recompute trigger:');
  console.log(JSON.stringify(finalSeq, null, 2));
  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
