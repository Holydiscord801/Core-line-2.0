import { supabase } from '../lib/supabase.js';
import { addBusinessDays, TIMER_DEFAULTS } from './timers.js';
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
export async function processPositiveResponse(userId, outreachId, responseText, isInterview) {
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
    if (!outreach)
        return;
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
export async function processNegativeResponse(userId, outreachId, responseText) {
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
    if (!outreach)
        return;
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
function normalizeChannel(channel) {
    return channel === 'linkedin' ? 'linkedin_dm' : channel;
}
/**
 * Find an active sequence for (job, contact), or create a new one. The phase
 * 3 timeline depends on every v2_outreach row having a sequence_id so the
 * /api/outreach/sequences endpoint can return it.
 */
async function findOrCreateSequence(userId, jobId, contactId, sentAt) {
    if (!jobId || !contactId)
        return null;
    // Prefer an existing non-terminal sequence on the same pair so we append
    // instead of starting a parallel one.
    const { data: existing } = await supabase
        .from('v2_outreach_sequences')
        .select('id, status')
        .eq('user_id', userId)
        .eq('job_id', jobId)
        .eq('contact_id', contactId)
        .in('status', ['active', 'delivered'])
        .order('created_at', { ascending: false })
        .limit(1);
    if (existing && existing.length > 0) {
        return existing[0].id;
    }
    const { data: created, error: createErr } = await supabase
        .from('v2_outreach_sequences')
        .insert({
        user_id: userId,
        job_id: jobId,
        contact_id: contactId,
        intent: 'auto created by sent scan',
        status: 'active',
        first_attempted_at: sentAt,
        last_attempted_at: sentAt,
    })
        .select('id')
        .single();
    if (createErr || !created)
        return null;
    return created.id;
}
/**
 * Process a manually sent outreach detected via email scanning.
 * Creates outreach record tied to a sequence and auto-generates follow-up timer.
 */
export async function processSentOutreach(userId, jobId, contactId, channel, messageText, sentAt) {
    const normalizedChannel = normalizeChannel(channel);
    // Check if outreach already tracked (avoid duplicates)
    if (contactId) {
        const { data: existing } = await supabase
            .from('v2_outreach')
            .select('id')
            .eq('user_id', userId)
            .eq('contact_id', contactId)
            .eq('channel', normalizedChannel)
            .gte('sent_at', new Date(new Date(sentAt).getTime() - 24 * 60 * 60 * 1000).toISOString())
            .limit(1);
        if (existing && existing.length > 0) {
            return null; // Already tracked
        }
    }
    // Find or create a parent sequence so the new attempt shows up on the
    // phase 3 timeline and the recompute trigger can maintain preferred_channel.
    const sequenceId = await findOrCreateSequence(userId, jobId, contactId, sentAt);
    // Create outreach record. delivery_status is 'delivered' because the sent
    // scan observes the message in Gmail's Sent folder, which implies transport
    // success.
    const { data: outreach, error: outreachError } = await supabase
        .from('v2_outreach')
        .insert({
        user_id: userId,
        job_id: jobId,
        contact_id: contactId,
        sequence_id: sequenceId,
        channel: normalizedChannel,
        delivery_status: 'delivered',
        message_text: messageText,
        sent_at: sentAt,
        response_received: false,
        outcome: 'no_response',
    })
        .select('id')
        .single();
    if (outreachError || !outreach)
        return null;
    // Update contact last_contacted_at
    if (contactId) {
        await supabase
            .from('v2_contacts')
            .update({ last_contacted_at: sentAt })
            .eq('id', contactId);
    }
    // Auto-create follow-up timer
    const timerType = normalizedChannel === 'email' ? 'outreach_email' : 'outreach_linkedin';
    // Get contact and job names for the reason
    let reason = `Follow up on ${normalizedChannel} outreach`;
    if (contactId) {
        const { data: contact } = await supabase
            .from('v2_contacts')
            .select('name, company')
            .eq('id', contactId)
            .single();
        if (contact) {
            reason = `Follow up on ${normalizedChannel} outreach to ${contact.name} at ${contact.company}`;
        }
    }
    await createFollowup(userId, jobId, contactId, timerType, reason, new Date(sentAt));
    // Get the follow-up ID
    const { data: followup } = await supabase
        .from('v2_followups')
        .select('id')
        .eq('user_id', userId)
        .eq('contact_id', contactId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    return {
        outreachId: outreach.id,
        followupId: followup?.id || '',
    };
}
/**
 * Process an inbound response detected via email scanning.
 * Marks outreach as responded, surfaces as priority action.
 */
export async function processInboundResponse(userId, contactId, responseText, isPositive, isInterview) {
    // Find the most recent pending outreach to this contact
    const { data: outreach } = await supabase
        .from('v2_outreach')
        .select('id, job_id')
        .eq('user_id', userId)
        .eq('contact_id', contactId)
        .eq('response_received', false)
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();
    if (!outreach)
        return;
    if (isPositive || isInterview) {
        await processPositiveResponse(userId, outreach.id, responseText, isInterview);
    }
    else {
        await processNegativeResponse(userId, outreach.id, responseText);
    }
}
/**
 * Create a follow-up reminder based on timer type.
 */
export async function createFollowup(userId, jobId, contactId, timerType, reason, fromDate // Use email timestamp as timer start, not current time
) {
    const window = TIMER_DEFAULTS[timerType];
    const dueDate = addBusinessDays(fromDate || new Date(), window);
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
export async function findCrossJobContacts(userId) {
    const { data, error } = await supabase
        .from('v2_job_contacts')
        .select(`
      contact_id,
      v2_contacts!inner (id, name, title, company, warmth_score, user_id),
      v2_jobs!inner (id, title, company, status, user_id)
    `)
        .eq('v2_contacts.user_id', userId);
    if (error || !data)
        return [];
    // Group by contact
    const contactMap = new Map();
    for (const row of data) {
        const contact = row.v2_contacts;
        const job = row.v2_jobs;
        if (!contactMap.has(contact.id)) {
            contactMap.set(contact.id, { contact, jobs: [] });
        }
        contactMap.get(contact.id).jobs.push(job);
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
export async function getOverdueWithEscalation(userId) {
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
    if (error || !data)
        return [];
    return data.map((followup) => {
        const dueDate = new Date(followup.due_date);
        const now = new Date();
        const overdueDays = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        let escalation = 'send_followup';
        if (overdueDays > 14)
            escalation = 'archive';
        else if (overdueDays > 10)
            escalation = 'try_another_contact';
        else if (overdueDays > 5)
            escalation = 'send_second_followup';
        return {
            ...followup,
            overdue_days: overdueDays,
            escalation_recommendation: escalation,
        };
    });
}
//# sourceMappingURL=email-monitor.js.map