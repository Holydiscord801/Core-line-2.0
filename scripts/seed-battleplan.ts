/**
 * Core Line 2.0 -- Battle Plan Seed Script
 *
 * Seeds Micah's job search data into Supabase so the system starts with
 * a real battle plan rather than an empty database.
 *
 * Usage:  npx tsx scripts/seed-battleplan.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (project root)
 * or as environment variables.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Set them in .env at the project root or export them directly.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const userData = {
  email: 'micah.processmodel@gmail.com',
  full_name: 'Micah Baird',
  resume_text:
    'SVP Operations & Technology, 15+ years scaling teams from 50 to 500+, P&L ownership to $200M, built enterprise platforms processing 50M+ transactions/year. Deep expertise in process automation, digital transformation, and engineering leadership across fintech, healthtech, and SaaS.',
  preferences: {
    role_types: [
      'VP Engineering',
      'SVP Engineering',
      'CTO',
      'VP Technology',
      'Chief Digital Officer',
      'VP Operations',
    ],
    salary_floor: 180000,
    locations: ['Salt Lake City, UT', 'Draper, UT', 'Lehi, UT', 'Remote'],
    remote_ok: true,
    industries: ['fintech', 'healthtech', 'SaaS', 'enterprise', 'e-commerce'],
  },
  autopilot_enabled: false,
  review_window_hours: 4,
};

const jobsData = [
  {
    title: 'VP of Technology',
    company: 'BambooHR',
    url: 'https://www.bamboohr.com/careers',
    salary_min: 184000,
    salary_max: 269000,
    location: 'Draper, UT',
    remote: false,
    status: 'interviewing',
    fit_score: 92,
    match_score: 92,
    source: 'linkedin',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes: 'CTO track. Screener passed, moving to CTO review with Ryan Packer.',
  },
  {
    title: 'VP Software Engineering',
    company: 'Mutual of Omaha',
    url: 'https://www.mutualofomaha.com/careers',
    salary_min: 220000,
    salary_max: 325000,
    location: 'Remote',
    remote: true,
    status: 'applied',
    fit_score: 88,
    match_score: 88,
    source: 'linkedin',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes: 'Assessment sent. Foundations Questionnaire completed.',
  },
  {
    title: 'Director, Customer Operations',
    company: 'Scribd',
    url: 'https://www.scribd.com/careers',
    salary_min: null,
    salary_max: null,
    location: 'Remote',
    remote: true,
    status: 'applied',
    fit_score: 72,
    match_score: 72,
    source: 'linkedin',
    resume_variant: 'Operations Leadership',
    posting_status: 'live',
    notes: 'Outreach sent to Beck Kloss and CEO. Monitoring for response.',
  },
  {
    title: 'CTO / VP Engineering',
    company: 'Pattern',
    url: 'https://pattern.com/careers',
    salary_min: 150000,
    salary_max: 180000,
    location: 'Lehi, UT',
    remote: false,
    status: 'new',
    fit_score: 85,
    match_score: 85,
    source: 'linkedin',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes: 'Draft outreach ready for Ryan Byrd.',
    outreach_draft:
      'Ryan, I came across the CTO opening at Pattern and was immediately drawn to the e-commerce intelligence platform you are building. With 15+ years scaling engineering teams and enterprise platforms processing 50M+ transactions per year, I believe I could add significant value. Would you be open to a brief conversation?',
  },
  {
    title: 'CDIO',
    company: 'Parker Hannifin',
    url: 'https://www.parker.com/careers',
    salary_min: null,
    salary_max: null,
    location: 'Cleveland, OH',
    remote: false,
    status: 'new',
    fit_score: 75,
    match_score: 75,
    source: 'linkedin',
    resume_variant: 'Digital Transformation',
    posting_status: 'live',
    notes: 'Draft outreach ready for Dinu Parel.',
  },
  {
    title: 'VP of Engineering',
    company: 'LaunchDarkly',
    url: 'https://launchdarkly.com/careers',
    salary_min: 200000,
    salary_max: 280000,
    location: 'Remote',
    remote: true,
    status: 'applied',
    fit_score: 82,
    match_score: 82,
    source: 'linkedin',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes: 'Outreach sent to Cameron Etezadi. Waiting on response.',
  },
  {
    title: 'Head of Engineering',
    company: 'Gong',
    url: 'https://www.gong.io/careers',
    salary_min: 210000,
    salary_max: 290000,
    location: 'Remote',
    remote: true,
    status: 'applied',
    fit_score: 80,
    match_score: 80,
    source: 'linkedin',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes: 'Outreach sent to Jim Gearhart. Follow-up overdue.',
  },
  {
    title: 'VP Engineering',
    company: 'Billtrust',
    url: 'https://billtrust.com/careers',
    salary_min: 190000,
    salary_max: 260000,
    location: 'Remote',
    remote: true,
    status: 'applied',
    fit_score: 78,
    match_score: 78,
    source: 'linkedin',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes: 'Outreach sent to Grant Halloran. Follow-up due today.',
  },
  {
    title: 'CTO',
    company: 'Conspicuous',
    url: 'https://conspicuous.com/careers',
    salary_min: null,
    salary_max: null,
    location: 'Remote',
    remote: true,
    status: 'new',
    fit_score: 76,
    match_score: 76,
    source: 'manual',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes: 'D365 F&O angle. Draft ready for Tom Sharpless.',
  },
  {
    title: 'VP Engineering',
    company: 'Five9',
    url: 'https://www.five9.com/careers',
    salary_min: 195000,
    salary_max: 275000,
    location: 'Remote',
    remote: true,
    status: 'applied',
    fit_score: 77,
    match_score: 77,
    source: 'linkedin',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes: 'Application submitted. Monitoring for response.',
  },
  {
    title: 'VP Engineering',
    company: 'Chainguard',
    url: 'https://www.chainguard.dev/careers',
    salary_min: 200000,
    salary_max: 300000,
    location: 'Remote',
    remote: true,
    status: 'applied',
    fit_score: 83,
    match_score: 83,
    source: 'linkedin',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes: 'Outreach sent to Sarah. Supply chain security angle.',
  },
  {
    title: 'VP Engineering',
    company: 'Circle',
    url: 'https://www.circle.com/careers',
    salary_min: 200000,
    salary_max: 320000,
    location: 'Remote',
    remote: true,
    status: 'new',
    fit_score: 90,
    match_score: 90,
    source: 'linkedin',
    resume_variant: 'Engineering Leadership',
    posting_status: 'live',
    notes:
      'Top match. Li Fan (CTO) is the target contact. Fintech alignment is strong.',
    outreach_draft:
      'Li Fan, I saw the VP Engineering opening at Circle and was immediately drawn to the stablecoin infrastructure mission. With 15+ years building enterprise transaction platforms processing 50M+ transactions per year and deep fintech experience, I believe I could help Circle scale its engineering organization. Would you be open to a 15-minute conversation?',
  },
];

const contactsData = [
  {
    name: 'Kevin Charles',
    title: 'Principal TA',
    company: 'BambooHR',
    relationship_type: 'recruiter',
    linkedin_url: 'https://linkedin.com/in/kevincharles',
    warmth_score: 80,
    response_count: 3,
  },
  {
    name: 'Ryan Packer',
    title: 'CTO',
    company: 'BambooHR',
    relationship_type: 'hiring_manager',
    linkedin_url: 'https://linkedin.com/in/ryanpacker',
    warmth_score: 30,
    response_count: 0,
  },
  {
    name: 'Michael Lechtenberger',
    title: 'CIO',
    company: 'Mutual of Omaha',
    relationship_type: 'hiring_manager',
    linkedin_url: 'https://linkedin.com/in/michaellechtenberger',
    warmth_score: 40,
    response_count: 1,
  },
  {
    name: 'Beck Kloss',
    title: 'Head of CX',
    company: 'Scribd',
    relationship_type: 'hiring_manager',
    linkedin_url: 'https://linkedin.com/in/beckkloss',
    warmth_score: 10,
    response_count: 0,
  },
  {
    name: 'Ryan Byrd',
    title: 'CEO',
    company: 'Pattern',
    relationship_type: 'hiring_manager',
    linkedin_url: 'https://linkedin.com/in/ryanbyrd',
    warmth_score: 0,
    response_count: 0,
  },
  {
    name: 'Dinu Parel',
    title: 'VP Technology',
    company: 'Parker Hannifin',
    relationship_type: 'peer',
    linkedin_url: 'https://linkedin.com/in/dinuparel',
    warmth_score: 0,
    response_count: 0,
  },
  {
    name: 'Cameron Etezadi',
    title: 'CTO',
    company: 'LaunchDarkly',
    relationship_type: 'hiring_manager',
    linkedin_url: 'https://linkedin.com/in/camerone',
    warmth_score: 20,
    response_count: 0,
  },
  {
    name: 'Jim Gearhart',
    title: 'VP Engineering',
    company: 'Gong',
    relationship_type: 'peer',
    linkedin_url: 'https://linkedin.com/in/jimgearhart',
    warmth_score: 10,
    response_count: 0,
  },
  {
    name: 'Grant Halloran',
    title: 'CEO',
    company: 'Billtrust',
    relationship_type: 'hiring_manager',
    linkedin_url: 'https://linkedin.com/in/granthalloran',
    warmth_score: 10,
    response_count: 0,
  },
  {
    name: 'Tom Sharpless',
    title: 'CEO',
    company: 'Conspicuous',
    relationship_type: 'hiring_manager',
    linkedin_url: 'https://linkedin.com/in/tomsharpless',
    warmth_score: 0,
    response_count: 0,
  },
  {
    name: 'Li Fan',
    title: 'CTO',
    company: 'Circle',
    relationship_type: 'hiring_manager',
    linkedin_url: 'https://linkedin.com/in/lifan',
    warmth_score: 0,
    response_count: 0,
  },
  {
    name: 'Sarah Chen',
    title: 'VP Engineering',
    company: 'Chainguard',
    relationship_type: 'hiring_manager',
    linkedin_url: 'https://linkedin.com/in/sarahchen',
    warmth_score: 20,
    response_count: 0,
  },
];

// Outreach config: which contacts have sent outreach, with days-ago offset
// and the LinkedIn message that was sent.
const outreachConfig: Array<{
  contactName: string;
  daysAgo: number;
  message: string;
}> = [
  {
    contactName: 'Kevin Charles',
    daysAgo: 7,
    message:
      'Kevin, thanks for the conversation about the VP of Technology role at BambooHR. I am excited about the opportunity and looking forward to speaking with Ryan Packer.',
  },
  {
    contactName: 'Michael Lechtenberger',
    daysAgo: 5,
    message:
      'Michael, I recently applied for the VP Software Engineering role at Mutual of Omaha and wanted to connect directly. With 15+ years scaling engineering teams and enterprise platforms, I believe I could add significant value to your digital transformation initiatives.',
  },
  {
    contactName: 'Beck Kloss',
    daysAgo: 4,
    message:
      'Beck, I came across the Director of Customer Operations role at Scribd and was drawn to the mission. I bring 15+ years of operations leadership and would love to discuss how I could contribute.',
  },
  {
    contactName: 'Cameron Etezadi',
    daysAgo: 4,
    message:
      'Cameron, I saw the VP of Engineering opening at LaunchDarkly and was immediately interested. With deep experience building developer platforms and scaling engineering organizations, I would love to connect.',
  },
  {
    contactName: 'Jim Gearhart',
    daysAgo: 5,
    message:
      'Jim, I noticed the Head of Engineering role at Gong and wanted to reach out. I have 15+ years scaling engineering teams and building enterprise platforms, and I think there is a strong fit.',
  },
  {
    contactName: 'Grant Halloran',
    daysAgo: 3,
    message:
      'Grant, I applied for the VP Engineering position at Billtrust and wanted to connect directly. My background in fintech engineering leadership and enterprise platform scaling aligns well with what you are building.',
  },
  {
    contactName: 'Sarah Chen',
    daysAgo: 2,
    message:
      'Sarah, I saw the VP Engineering opening at Chainguard and was excited by the supply chain security mission. With 15+ years building enterprise platforms, I believe I could help scale the engineering organization.',
  },
];

// Follow-up config: which contacts get follow-ups, with due-date offsets
// The due date is computed as: outreach sent_at + 3 business days
// We express it as days from today so the seed is date-relative.
const followUpConfig: Array<{
  contactName: string;
  dueDaysFromToday: number;
  priority: 'high' | 'medium' | 'low';
}> = [
  // Overdue: Jim Gearhart (Gong) -- sent 5 days ago, due 2 days ago
  { contactName: 'Jim Gearhart', dueDaysFromToday: -2, priority: 'high' },
  // Overdue: Cameron Etezadi (LaunchDarkly) -- sent 4 days ago, due 1 day ago
  { contactName: 'Cameron Etezadi', dueDaysFromToday: -1, priority: 'high' },
  // Overdue: Dinu Parel (Parker Hannifin) -- sent 6 days ago, due 3 days ago
  // Note: Dinu does not have outreach in our set, so we create a follow-up without outreach
  // Actually per the spec, Dinu's follow-up is overdue (sent 6 days ago).
  // We will create outreach for Dinu as well to support this.
  // Due today: Grant Halloran (Billtrust) -- sent 3 days ago
  { contactName: 'Grant Halloran', dueDaysFromToday: 0, priority: 'medium' },
  // Upcoming: Sarah Chen (Chainguard) -- sent 2 days ago, due in 1 day
  { contactName: 'Sarah Chen', dueDaysFromToday: 1, priority: 'low' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0]; // DATE only
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed() {
  console.log('Seeding Core Line 2.0 battle plan data...\n');

  // -----------------------------------------------------------------------
  // 1. Create or update user
  // -----------------------------------------------------------------------
  console.log('[1/8] Upserting user...');
  const { data: user, error: userError } = await supabase
    .from('v2_users')
    .upsert(
      {
        email: userData.email,
        full_name: userData.full_name,
        resume_text: userData.resume_text,
        preferences: userData.preferences,
        autopilot_enabled: userData.autopilot_enabled,
        review_window_hours: userData.review_window_hours,
      },
      { onConflict: 'email', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (userError) {
    // email is not a unique constraint by default in the schema, so we may
    // need to handle this by doing a select-then-insert/update flow.
    // Try select first.
    const { data: existingUser } = await supabase
      .from('v2_users')
      .select('id')
      .eq('email', userData.email)
      .single();

    if (existingUser) {
      // Update in place
      await supabase
        .from('v2_users')
        .update({
          full_name: userData.full_name,
          resume_text: userData.resume_text,
          preferences: userData.preferences,
          autopilot_enabled: userData.autopilot_enabled,
          review_window_hours: userData.review_window_hours,
        })
        .eq('id', existingUser.id);

      console.log(`  Updated existing user: ${userData.full_name} (${existingUser.id})`);
      return runWithUserId(existingUser.id);
    }

    // Insert without auth_user_id (seed user, not a Supabase Auth user)
    const { data: newUser, error: insertError } = await supabase
      .from('v2_users')
      .insert({
        email: userData.email,
        full_name: userData.full_name,
        resume_text: userData.resume_text,
        preferences: userData.preferences,
        autopilot_enabled: userData.autopilot_enabled,
        review_window_hours: userData.review_window_hours,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('  Failed to create user:', insertError.message);
      process.exit(1);
    }

    console.log(`  Created user: ${userData.full_name} (${newUser!.id})`);
    return runWithUserId(newUser!.id);
  }

  console.log(`  Upserted user: ${userData.full_name} (${user.id})`);
  return runWithUserId(user.id);
}

async function runWithUserId(userId: string) {
  // -----------------------------------------------------------------------
  // 2. Generate API key
  // -----------------------------------------------------------------------
  console.log('[2/8] Generating API key...');
  const rawKey = 'cl_live_' + crypto.randomBytes(24).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 16);

  const { error: keyError } = await supabase.from('v2_api_keys').insert({
    user_id: userId,
    name: 'seed-key',
    key_hash: keyHash,
    key_prefix: keyPrefix,
  });

  if (keyError) {
    console.error('  API key insert failed:', keyError.message);
  } else {
    console.log(`  API key created: ${keyPrefix}...`);
  }

  // -----------------------------------------------------------------------
  // 3. Insert jobs
  // -----------------------------------------------------------------------
  console.log('[3/8] Inserting jobs...');

  // Clean existing jobs for this user to make script idempotent
  await supabase.from('v2_jobs').delete().eq('user_id', userId);

  const jobRows = jobsData.map((j) => ({
    user_id: userId,
    title: j.title,
    company: j.company,
    url: j.url,
    salary_min: j.salary_min,
    salary_max: j.salary_max,
    location: j.location,
    remote: j.remote,
    status: j.status,
    fit_score: j.fit_score,
    match_score: j.match_score,
    source: j.source,
    resume_variant: j.resume_variant,
    posting_status: j.posting_status,
    notes: j.notes,
    outreach_draft: (j as any).outreach_draft ?? null,
    applied_at:
      j.status === 'applied' || j.status === 'interviewing'
        ? daysAgo(7)
        : null,
  }));

  const { data: insertedJobs, error: jobsError } = await supabase
    .from('v2_jobs')
    .insert(jobRows)
    .select('id, company');

  if (jobsError) {
    console.error('  Jobs insert failed:', jobsError.message);
    process.exit(1);
  }

  console.log(`  Inserted ${insertedJobs!.length} jobs`);

  // Build company -> job ID lookup
  const companyToJobId: Record<string, string> = {};
  for (const job of insertedJobs!) {
    companyToJobId[job.company] = job.id;
  }

  // -----------------------------------------------------------------------
  // 4. Insert contacts
  // -----------------------------------------------------------------------
  console.log('[4/8] Inserting contacts...');

  // Clean existing contacts for this user
  await supabase.from('v2_contacts').delete().eq('user_id', userId);

  const contactRows = contactsData.map((c) => ({
    user_id: userId,
    name: c.name,
    title: c.title,
    company: c.company,
    linkedin_url: c.linkedin_url,
    relationship_type: c.relationship_type,
    warmth_score: c.warmth_score,
    response_count: c.response_count,
  }));

  const { data: insertedContacts, error: contactsError } = await supabase
    .from('v2_contacts')
    .insert(contactRows)
    .select('id, name, company');

  if (contactsError) {
    console.error('  Contacts insert failed:', contactsError.message);
    process.exit(1);
  }

  console.log(`  Inserted ${insertedContacts!.length} contacts`);

  // Build name -> contact lookup and company -> contact IDs
  const nameToContact: Record<string, { id: string; company: string }> = {};
  for (const c of insertedContacts!) {
    nameToContact[c.name] = { id: c.id, company: c.company };
  }

  // -----------------------------------------------------------------------
  // 5. Link contacts to jobs (v2_job_contacts)
  // -----------------------------------------------------------------------
  console.log('[5/8] Linking contacts to jobs...');

  const jobContactRows: Array<{
    job_id: string;
    contact_id: string;
    relevance_notes: string;
  }> = [];

  for (const c of insertedContacts!) {
    const jobId = companyToJobId[c.company];
    if (jobId) {
      jobContactRows.push({
        job_id: jobId,
        contact_id: c.id,
        relevance_notes: `${c.name} at ${c.company}`,
      });
    }
  }

  const { error: jcError } = await supabase
    .from('v2_job_contacts')
    .insert(jobContactRows);

  if (jcError) {
    console.error('  Job-contact links failed:', jcError.message);
  } else {
    console.log(`  Linked ${jobContactRows.length} contact-job pairs`);
  }

  // -----------------------------------------------------------------------
  // 6. Create outreach records
  // -----------------------------------------------------------------------
  console.log('[6/8] Creating outreach records...');

  // Clean existing outreach for this user
  await supabase.from('v2_outreach').delete().eq('user_id', userId);

  // Add Dinu Parel outreach (needed for the overdue follow-up)
  const allOutreach = [
    ...outreachConfig,
    {
      contactName: 'Dinu Parel',
      daysAgo: 6,
      message:
        'Dinu, I noticed the CDIO role at Parker Hannifin and wanted to connect. With deep experience in digital transformation and enterprise platform engineering, I think there is a strong alignment. Would you be open to a quick conversation?',
    },
  ];

  const outreachRows = allOutreach.map((o) => {
    const contact = nameToContact[o.contactName];
    if (!contact) {
      console.warn(`  Warning: contact "${o.contactName}" not found, skipping outreach`);
      return null;
    }
    const jobId = companyToJobId[contact.company] ?? null;
    return {
      user_id: userId,
      job_id: jobId,
      contact_id: contact.id,
      channel: 'linkedin' as const,
      message_text: o.message,
      sent_at: daysAgo(o.daysAgo),
      response_received: false,
      outcome: 'no_response' as const,
    };
  }).filter(Boolean);

  const { data: insertedOutreach, error: outreachError } = await supabase
    .from('v2_outreach')
    .insert(outreachRows)
    .select('id, contact_id');

  if (outreachError) {
    console.error('  Outreach insert failed:', outreachError.message);
  } else {
    console.log(`  Created ${insertedOutreach!.length} outreach records`);
  }

  // Update last_contacted_at on contacts that received outreach
  for (const o of allOutreach) {
    const contact = nameToContact[o.contactName];
    if (contact) {
      await supabase
        .from('v2_contacts')
        .update({ last_contacted_at: daysAgo(o.daysAgo) })
        .eq('id', contact.id);
    }
  }

  // -----------------------------------------------------------------------
  // 7. Create follow-up reminders
  // -----------------------------------------------------------------------
  console.log('[7/8] Creating follow-up reminders...');

  // Clean existing follow-ups for this user
  await supabase.from('v2_followups').delete().eq('user_id', userId);

  // Add Dinu Parel follow-up (overdue, sent 6 days ago, due 3 days ago)
  const allFollowUps = [
    ...followUpConfig,
    { contactName: 'Dinu Parel', dueDaysFromToday: -3, priority: 'high' as const },
  ];

  const followUpRows = allFollowUps.map((f) => {
    const contact = nameToContact[f.contactName];
    if (!contact) {
      console.warn(`  Warning: contact "${f.contactName}" not found, skipping follow-up`);
      return null;
    }
    const jobId = companyToJobId[contact.company] ?? null;
    return {
      user_id: userId,
      job_id: jobId,
      contact_id: contact.id,
      due_date: daysFromToday(f.dueDaysFromToday),
      reason: `Follow up on LinkedIn outreach to ${f.contactName} at ${contact.company}`,
      priority: f.priority,
      status: 'pending' as const,
      timer_type: 'outreach_linkedin' as const,
      business_days_window: 3,
    };
  }).filter(Boolean);

  const { error: followUpError } = await supabase
    .from('v2_followups')
    .insert(followUpRows);

  if (followUpError) {
    console.error('  Follow-ups insert failed:', followUpError.message);
  } else {
    console.log(`  Created ${followUpRows.length} follow-up reminders`);
  }

  // -----------------------------------------------------------------------
  // 8. Create today's battle plan
  // -----------------------------------------------------------------------
  console.log('[8/8] Creating today\'s battle plan...');

  // Clean existing battle plan for today
  await supabase
    .from('v2_battle_plans')
    .delete()
    .eq('user_id', userId)
    .eq('plan_date', today());

  const overdueFollowUps = allFollowUps
    .filter((f) => f.dueDaysFromToday < 0)
    .map((f) => ({
      contact: f.contactName,
      company: nameToContact[f.contactName]?.company ?? 'Unknown',
      days_overdue: Math.abs(f.dueDaysFromToday),
    }));

  const dueTodayFollowUps = allFollowUps
    .filter((f) => f.dueDaysFromToday === 0)
    .map((f) => ({
      contact: f.contactName,
      company: nameToContact[f.contactName]?.company ?? 'Unknown',
    }));

  const planData = {
    generated_by: 'seed-battleplan',
    priorities: [
      {
        rank: 1,
        action: 'Prepare for BambooHR CTO review with Ryan Packer',
        company: 'BambooHR',
        urgency: 'high',
      },
      {
        rank: 2,
        action: 'Send follow-up messages to overdue contacts',
        contacts: overdueFollowUps,
        urgency: 'high',
      },
      {
        rank: 3,
        action: 'Follow up with Grant Halloran at Billtrust (due today)',
        contacts: dueTodayFollowUps,
        urgency: 'medium',
      },
      {
        rank: 4,
        action: 'Send outreach to Circle (Li Fan) and Pattern (Ryan Byrd)',
        urgency: 'medium',
      },
      {
        rank: 5,
        action: 'Verify posting status on all active jobs',
        urgency: 'low',
      },
    ],
    stats: {
      total_active_jobs: jobsData.length,
      interviewing: jobsData.filter((j) => j.status === 'interviewing').length,
      applied: jobsData.filter((j) => j.status === 'applied').length,
      new_leads: jobsData.filter((j) => j.status === 'new').length,
      overdue_followups: overdueFollowUps.length,
      due_today: dueTodayFollowUps.length,
    },
  };

  const { error: planError } = await supabase.from('v2_battle_plans').insert({
    user_id: userId,
    plan_date: today(),
    jobs_found: jobsData.length,
    contacts_identified: contactsData.length,
    plan_data: planData,
    ai_prompt_used: 'Seeded from scripts/seed-battleplan.ts',
  });

  if (planError) {
    console.error('  Battle plan insert failed:', planError.message);
  } else {
    console.log('  Battle plan created for today');
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n--- SEED COMPLETE ---');
  console.log(`API Key (save this!): ${rawKey}`);
  console.log(`User: ${userData.full_name} (${userId})`);
  console.log(`Jobs: ${jobsData.length}`);
  console.log(`Contacts: ${contactsData.length}`);
  console.log(`Outreach records: ${allOutreach.length}`);
  console.log(`Follow-up reminders: ${allFollowUps.length}`);
  console.log(`Battle plan: ${today()}`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
