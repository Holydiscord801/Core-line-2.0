import { supabase } from '../lib/supabase.js';
import { addBusinessDays, TIMER_DEFAULTS, type TimerType } from './timers.js';

/**
 * Core Line 2.0 - Email Monitoring Utilities
 *
 * The email monitoring cycle:
 * 1. check_email_responses MCP tool returns pending outreach
 * 2. AI checks Gmail for replies to those threads
 * 3. AI calls mark_outreach_response with outcomes
 * 4. These utilities handle the DB updates and cascading effects
 */

/**
 * Process a positive email response.
 * Updates outreach, contact warmth, and optionally job status.
 */
export async function processPositiveResponse(
  userId: string,
  outreachId: string,
  responseText: string,
  isInterview: boolean
): Promise<void> {
  // Update outreach record
  await supabase
    .from('v2_outreach')
    .update({
      response_received: true,
      response_text: responseText,
      response_at: new Date().toISOString(),
      outcome: isInterview ? 'interview_scheduled' : 'positive',
    })
    .eq('id', outreachId)
    .eq('user_id', userId);

  // Get the outreach to find contact and job
  const { data: outreach } = await supabase
    .from('v2_outreach')
    .select('contact_id, job_id')
    .eq('id', outreachId)
    .single();

  if (!outreach) return;

  // Update contact warmth
  if (outreach.contact_id) {
    const warmthDelta = isInterview ? 25 : 20;
    const { data: contact } = await supabase
      .from('v2_contacts')
      .select('warmth_score, response_count')
      .eq('id', outreach.contact_id)
      .single();

    if (contact) {
      await supabase
        .from('v2_contacts')
        .update({
          warmth_score: Math.min(100, (contact.warmth_score || 0) + warmthDelta),
          last_contacted_at: new Date().toISOString(),
          response_count: (contact.response_count || 0) + 1,
        })
        .eq('id', outreach.contact_id);
    }

    // Cancel pending follow-ups for this contact
    await supabase
      .from('v2_followups')
      .update({ status: 'done' })
      .eq('contact_id', outreach.contact_id)
      .eq('user_id', userId)
      .eq('status', 'pending');
  }

  // Update job status if interview
  if (isInterview && outreach.job_id) {
    await supabase
      .from('v2_jobs')
      .update({ status: 'interviewing' })
      .eq('id', outreach.job_id)
      .eq('user_id', userId);
  }
}

/**
 * Process a rejection/negative response.
 * Updates outreach, job status, archives follow-ups.
 */
export async function processNegativeResponse(
  userId: string,
  outreachId: string,
  responseText: string
): Promise<void> {
  await supabase
    .from('v2_outreach')
    .update({
      response_received: true,
      response_text: responseText,
      response_at: new Date().toISOString(),
      outcome: 'negative',
    })
    .eq('id', outreachId)
    .eq('user_id', userId);

  const { data: outreach } = await supabase
    .from('v2_outreach')
    .select('contact_id, job_id')
    .eq('id', outreachId)
    .single();

  if (!outreach) return;

  // Slight warmth reduction (still a response)
  if (outreach.contact_id) {
    const { data: contact } = await supabase
      .from('v2_contacts')
      .select('warmth_score, response_count')
      .eq('id', outreach.contact_id)
      .single();

    if (contact) {
      await supabase
        .from('v2_contacts')
        .update({
          warmth_score: Math.max(0, (contact.warmth_score || 0) - 5),
          response_count: (contact.response_count || 0) + 1,
          last_contacted_at: new Date().toISOString(),
        })
        .eq('id', outreach.contact_id);
    }

    // Cancel pending follow-ups
    await supabase
      .from('v2_followups')
      .update({ status: 'done' })
      .eq('contact_id', outreach.contact_id)
      .eq('user_id', userId)
      .eq('status', 'pending');
  }

  // Mark job as rejected
  if (outreach.job_id) {
    await supabase
      .from('v2_jobs')
      .update({ status: 'rejected' })
      .eq('id', outreach.job_id)
      .eq('user_id', userId);
  }
}

/**
 * Create a follow-up reminder based on timer type.
 */
export async function createFollowup(
  userId: string,
  jobId: string | null,
  contactId: string | null,
  timerType: TimerType,
  reason: string
): Promise<void> {
  const window = TIMER_DEFAULTS[timerType];
  const dueDate = addBusinessDays(new Date(), window);

  await supabase
    .from('v2_followups')
    .insert({
      user_id: userId,
      job_id: jobId,
      contact_id: contactId,
      due_date: dueDate.toISOString().split('T')[0],
      reason,
      priority: 'medium',
      status: 'pending',
      timer_type: timerType,
      business_days_window: window,
    });
}

/**
 * Find contacts linked to multiple jobs in the pipeline.
 * This powers the "Sarah knows people at 3 other companies" feature.
 */
export async function findCrossJobContacts(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('v2_job_contacts')
    .select(`
      contact_id,
      v2_contacts!inner (id, name, title, company, warmth_score, user_id),
      v2_jobs!inner (id, title, company, status, user_id)
    `)
    .eq('v2_contacts.user_id', userId);

  if (error || !data) return [];

  // Group by contact
  const contactMap = new Map<string, { contact: any; jobs: any[] }>();
  for (const row of data) {
    const contact = (row as any).v2_contacts;
    const job = (row as any).v2_jobs;
    if (!contactMap.has(contact.id)) {
      contactMap.set(contact.id, { contact, jobs: [] });
    }
    contactMap.get(contact.id)!.jobs.push(job);
  }

  // Return contacts linked to 2+ jobs
  return Array.from(contactMap.values())
    .filter(entry => entry.jobs.length >= 2)
    .map(entry => ({
      ...entry.contact,
      linked_jobs: entry.jobs,
      linked_job_count: entry.jobs.length,
    }));
}

/**
 * Get overdue follow-ups with escalation recommendations.
 */
export async function getOverdueWithEscalation(userId: string): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('v2_followups')
    .select(`
      *,
      v2_jobs (id, title, company),
      v2_contacts (id, name, title, company, warmth_score)
    `)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lte('due_date', today)
    .order('due_date', { ascending: true });

  if (error || !data) return [];

  return data.map((followup: any) => {
    const dueDate = new Date(followup.due_date);
    const now = new Date();
    const overdueDays = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    let escalation = 'send_followup';
    if (overdueDays > 14) escalation = 'archive';
    else if (overdueDays > 10) escalation = 'try_another_contact';
    else if (overdueDays > 5) escalation = 'send_second_followup';

    return {
      ...followup,
      overdue_days: overdueDays,
      escalation_recommendation: escalation,
    };
  });
}
