import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';

const router = Router();

// GET /api/activity - Recent activity feed (outreach + followups + jobs changes)
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const limit = parseInt(req.query.limit as string) || 20;

    // Fetch recent outreach, followups, and job updates in parallel
    const [outreachRes, followupsRes, jobsRes] = await Promise.all([
      supabase
        .from('v2_outreach')
        .select('id, channel, message_text, subject_line, sent_at, response_received, outcome, created_at, v2_contacts(name, company), v2_jobs(title, company)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('v2_followups')
        .select('id, due_date, reason, priority, status, timer_type, created_at, updated_at, v2_contacts(name, company), v2_jobs(title, company)')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(limit),
      supabase
        .from('v2_jobs')
        .select('id, title, company, status, fit_score, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(limit),
    ]);

    // Merge and sort by timestamp
    const activities: any[] = [];

    (outreachRes.data || []).forEach((o: any) => {
      activities.push({
        type: 'outreach',
        id: o.id,
        timestamp: o.created_at,
        description: o.response_received
          ? `Response received from ${o.v2_contacts?.name || 'contact'} at ${o.v2_contacts?.company || o.v2_jobs?.company || 'unknown'}: ${o.outcome || 'pending'}`
          : `Outreach ${o.sent_at ? 'sent' : 'drafted'} to ${o.v2_contacts?.name || 'contact'} at ${o.v2_contacts?.company || o.v2_jobs?.company || 'unknown'} via ${o.channel}`,
        channel: o.channel,
        contact: o.v2_contacts?.name,
        company: o.v2_contacts?.company || o.v2_jobs?.company,
        job_title: o.v2_jobs?.title,
        outcome: o.outcome,
      });
    });

    (followupsRes.data || []).forEach((f: any) => {
      activities.push({
        type: 'followup',
        id: f.id,
        timestamp: f.updated_at,
        description: f.status === 'done'
          ? `Follow-up completed: ${f.v2_contacts?.name || 'contact'} at ${f.v2_contacts?.company || f.v2_jobs?.company || 'unknown'}`
          : f.status === 'snoozed'
          ? `Follow-up snoozed: ${f.v2_contacts?.name || 'contact'}`
          : `Follow-up ${f.priority === 'high' ? 'URGENT' : 'pending'}: ${f.reason || 'Follow up'} - ${f.v2_contacts?.name || 'contact'}`,
        contact: f.v2_contacts?.name,
        company: f.v2_contacts?.company || f.v2_jobs?.company,
        status: f.status,
        priority: f.priority,
      });
    });

    (jobsRes.data || []).forEach((j: any) => {
      activities.push({
        type: 'job_update',
        id: j.id,
        timestamp: j.updated_at,
        description: `${j.company} - ${j.title}: status is ${j.status}${j.fit_score ? ` (${j.fit_score}% match)` : ''}`,
        company: j.company,
        job_title: j.title,
        status: j.status,
        fit_score: j.fit_score,
      });
    });

    // Sort by timestamp descending
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json(activities.slice(0, limit));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
