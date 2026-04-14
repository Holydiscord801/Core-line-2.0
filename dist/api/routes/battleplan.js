import { Router } from 'express';
import { supabase } from '../../lib/supabase.js';
const router = Router();
async function generateBattlePlanForUser(userId) {
    const today = new Date().toISOString().split('T')[0];
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoISO = threeDaysAgo.toISOString();
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const fiveDaysAgoISO = fiveDaysAgo.toISOString();
    // ---- Parallel data fetches ----
    const [activeJobsResult, overdueFollowupsResult, todayFollowupsResult, staleOutreachResult, warmContactsResult,] = await Promise.all([
        // 1. Active jobs (not closed or rejected)
        supabase
            .from('v2_jobs')
            .select('id, title, company, fit_score, status, applied_at, updated_at')
            .eq('user_id', userId)
            .not('status', 'in', '("closed","rejected")')
            .order('fit_score', { ascending: false, nullsFirst: false }),
        // 2. Overdue follow-ups (due_date < today, pending)
        supabase
            .from('v2_followups')
            .select(`
          id, due_date, reason, priority,
          v2_jobs (id, title, company),
          v2_contacts (id, name, company)
        `)
            .eq('user_id', userId)
            .eq('status', 'pending')
            .lt('due_date', today)
            .order('due_date', { ascending: true }),
        // 3. Today's follow-ups (due_date = today, pending)
        supabase
            .from('v2_followups')
            .select(`
          id, due_date, reason, priority,
          v2_jobs (id, title, company),
          v2_contacts (id, name, company)
        `)
            .eq('user_id', userId)
            .eq('status', 'pending')
            .eq('due_date', today)
            .order('priority', { ascending: true }),
        // 4. Stale outreach (sent > 3 days ago, no response)
        supabase
            .from('v2_outreach')
            .select(`
          id, channel, sent_at, message_text,
          v2_jobs (id, title, company),
          v2_contacts (id, name, company)
        `)
            .eq('user_id', userId)
            .eq('response_received', false)
            .not('sent_at', 'is', null)
            .lt('sent_at', threeDaysAgoISO)
            .order('sent_at', { ascending: true }),
        // 5. Warm contacts (warmth_score > 0)
        supabase
            .from('v2_contacts')
            .select('id, name, company, warmth_score, last_contacted_at')
            .eq('user_id', userId)
            .gt('warmth_score', 0)
            .order('warmth_score', { ascending: false })
            .limit(20),
    ]);
    // Bail on any critical error
    const queryError = [
        activeJobsResult, overdueFollowupsResult, todayFollowupsResult,
        staleOutreachResult, warmContactsResult,
    ].find(r => r.error);
    if (queryError?.error) {
        throw new Error(queryError.error.message);
    }
    const activeJobs = activeJobsResult.data || [];
    const overdueFollowups = overdueFollowupsResult.data || [];
    const todayFollowups = todayFollowupsResult.data || [];
    const staleOutreach = staleOutreachResult.data || [];
    const warmContacts = warmContactsResult.data || [];
    // ---- Derived sets ----
    const newJobs = activeJobs.filter((j) => j.status === 'new');
    const staleApplied = activeJobs.filter((j) => j.status === 'applied' && j.updated_at && j.updated_at < fiveDaysAgoISO);
    // ---- Build priority_actions ----
    const priorityActions = [];
    // Priority 1: Urgent follow-ups (overdue)
    for (const fu of overdueFollowups) {
        const job = fu.v2_jobs;
        const contact = fu.v2_contacts;
        const target = contact?.name || job?.title || 'Unknown';
        const company = contact?.company || job?.company || '';
        const suffix = company ? ` at ${company}` : '';
        priorityActions.push(`[URGENT] Overdue follow-up: ${target}${suffix} (due ${fu.due_date}) - ${fu.reason || 'No reason specified'}`);
    }
    // Priority 2: Due today
    for (const fu of todayFollowups) {
        const job = fu.v2_jobs;
        const contact = fu.v2_contacts;
        const target = contact?.name || job?.title || 'Unknown';
        const company = contact?.company || job?.company || '';
        const suffix = company ? ` at ${company}` : '';
        priorityActions.push(`[TODAY] Follow up with ${target}${suffix} - ${fu.reason || 'Scheduled follow-up'}`);
    }
    // Priority 3: New opportunities
    for (const job of newJobs.slice(0, 10)) {
        const score = job.fit_score != null ? ` (fit: ${job.fit_score})` : '';
        priorityActions.push(`[NEW] Review opportunity: ${job.title} at ${job.company}${score}`);
    }
    // Priority 4: Stale outreach
    for (const o of staleOutreach) {
        const contact = o.v2_contacts;
        const job = o.v2_jobs;
        const target = contact?.name || 'Unknown contact';
        const company = job?.company || contact?.company || '';
        const suffix = company ? ` at ${company}` : '';
        const daysSince = Math.floor((Date.now() - new Date(o.sent_at).getTime()) / (1000 * 60 * 60 * 24));
        priorityActions.push(`[STALE] No response from ${target}${suffix} after ${daysSince} days via ${o.channel}`);
    }
    // Priority 5: Pipeline health
    for (const job of staleApplied.slice(0, 10)) {
        const daysSince = Math.floor((Date.now() - new Date(job.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        priorityActions.push(`[PIPELINE] ${job.title} at ${job.company} has had no activity for ${daysSince} days`);
    }
    // ---- Build plan_data ----
    const jobs = activeJobs.slice(0, 25).map((j) => {
        let action = 'Review';
        if (j.status === 'new')
            action = 'Evaluate and apply';
        else if (j.status === 'applied')
            action = 'Follow up';
        else if (j.status === 'interviewing')
            action = 'Prepare for interview';
        else if (j.status === 'researching')
            action = 'Research and decide';
        else if (j.status === 'offer')
            action = 'Review offer terms';
        return { id: j.id, title: j.title, company: j.company, fit_score: j.fit_score, action };
    });
    const contactsToReach = warmContacts.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company || '',
        suggested_action: c.last_contacted_at
            ? `Re-engage (warmth: ${c.warmth_score})`
            : `Initial outreach (warmth: ${c.warmth_score})`,
    }));
    // Also add contacts from overdue follow-ups that are not already listed
    const contactIds = new Set(contactsToReach.map(c => c.id));
    for (const fu of overdueFollowups) {
        const contact = fu.v2_contacts;
        const job = fu.v2_jobs;
        if (contact && !contactIds.has(contact.id)) {
            contactIds.add(contact.id);
            contactsToReach.push({
                id: contact.id,
                name: contact.name,
                company: contact.company || job?.company || '',
                job_id: job?.id,
                suggested_action: `Overdue follow-up since ${fu.due_date}`,
            });
        }
    }
    const summaryParts = [];
    if (overdueFollowups.length > 0)
        summaryParts.push(`${overdueFollowups.length} overdue follow-up(s)`);
    if (todayFollowups.length > 0)
        summaryParts.push(`${todayFollowups.length} follow-up(s) due today`);
    if (newJobs.length > 0)
        summaryParts.push(`${newJobs.length} new job(s) to review`);
    if (staleOutreach.length > 0)
        summaryParts.push(`${staleOutreach.length} outreach message(s) without a response`);
    if (staleApplied.length > 0)
        summaryParts.push(`${staleApplied.length} application(s) going stale`);
    const summary = summaryParts.length > 0
        ? `Core Line battle plan for ${today}: ${summaryParts.join(', ')}.`
        : `Core Line battle plan for ${today}: Pipeline is clear. Time to prospect.`;
    const planData = {
        jobs,
        contacts_to_reach: contactsToReach,
        priority_actions: priorityActions,
        summary,
    };
    // ---- Upsert into v2_battle_plans ----
    const { data, error } = await supabase
        .from('v2_battle_plans')
        .upsert({
        user_id: userId,
        plan_date: today,
        plan_data: planData,
        jobs_found: activeJobs.length,
        contacts_identified: contactsToReach.length,
        generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,plan_date' })
        .select()
        .single();
    if (error) {
        throw new Error(error.message);
    }
    return data;
}
// GET /api/battle-plan
router.get('/', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const date = req.query.date || today;
        const { data, error } = await supabase
            .from('v2_battle_plans')
            .select('*')
            .eq('user_id', req.userId)
            .eq('plan_date', date)
            .single();
        if (error && error.code !== 'PGRST116') {
            res.status(500).json({ error: error.message });
            return;
        }
        if (!data) {
            if (date === today) {
                try {
                    const generated = await generateBattlePlanForUser(req.userId);
                    res.json({ battle_plan: generated });
                    return;
                }
                catch (genErr) {
                    console.error('[battle-plan] auto-generate failed:', genErr);
                    res.json({ battle_plan: null, message: `generate failed: ${genErr?.message || 'unknown'}` });
                    return;
                }
            }
            res.json({ battle_plan: null, message: `No battle plan found for ${date}` });
            return;
        }
        res.json({ battle_plan: data });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch battle plan' });
    }
});
// GET /api/battle-plans/today
router.get('/today', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase
            .from('v2_battle_plans')
            .select('*')
            .eq('user_id', req.userId)
            .eq('plan_date', today)
            .single();
        if (error && error.code !== 'PGRST116') {
            res.status(500).json({ error: error.message });
            return;
        }
        if (!data) {
            try {
                const generated = await generateBattlePlanForUser(req.userId);
                res.json({ battle_plan: generated });
                return;
            }
            catch (genErr) {
                console.error('[battle-plan] auto-generate failed:', genErr);
                res.json({ battle_plan: null, message: `generate failed: ${genErr?.message || 'unknown'}` });
                return;
            }
        }
        res.json({ battle_plan: data });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch today\'s battle plan' });
    }
});
// POST /api/battle-plans/generate
// Builds a prioritized battle plan from live pipeline data
router.post('/generate', async (req, res) => {
    try {
        const data = await generateBattlePlanForUser(req.userId);
        res.status(201).json({ battle_plan: data });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Failed to generate battle plan' });
    }
});
export default router;
//# sourceMappingURL=battleplan.js.map