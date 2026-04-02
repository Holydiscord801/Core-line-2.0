import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';
import type { JobStatus } from '../../types/index.js';

const router = Router();

// GET /api/summary
router.get('/', async (req: Request, res: Response) => {
  try {
    // Get all jobs
    const { data: jobs } = await supabase
      .from('v2_jobs')
      .select('status, created_at')
      .eq('user_id', req.userId!);

    const jobsByStatus: Record<JobStatus, number> = {
      new: 0,
      researching: 0,
      applied: 0,
      interviewing: 0,
      offer: 0,
      closed: 0,
      rejected: 0,
    };

    (jobs || []).forEach((job: any) => {
      jobsByStatus[job.status as JobStatus]++;
    });

    const totalApplied = jobsByStatus.applied + jobsByStatus.interviewing + jobsByStatus.offer + jobsByStatus.closed + jobsByStatus.rejected;

    // Get outreach stats
    const { data: outreach } = await supabase
      .from('v2_outreach')
      .select('response_received')
      .eq('user_id', req.userId!);

    const totalOutreach = outreach?.length || 0;
    const responsesReceived = outreach?.filter((o: any) => o.response_received).length || 0;

    // Get overdue followups
    const today = new Date().toISOString().split('T')[0];
    const { count: overdueCount } = await supabase
      .from('v2_followups')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId!)
      .eq('status', 'pending')
      .lt('due_date', today);

    // Active relationships (contacts with outreach in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: recentOutreach } = await supabase
      .from('v2_outreach')
      .select('contact_id')
      .eq('user_id', req.userId!)
      .gte('sent_at', thirtyDaysAgo.toISOString());

    const activeContactIds = new Set((recentOutreach || []).map((o: any) => o.contact_id).filter(Boolean));

    const totalJobs = jobs?.length || 0;
    const interviewingOrBetter = jobsByStatus.interviewing + jobsByStatus.offer;

    res.json({
      jobs_by_status: jobsByStatus,
      total_applied: totalApplied,
      response_rate: totalOutreach > 0 ? Math.round((responsesReceived / totalOutreach) * 100) : 0,
      interview_rate: totalJobs > 0 ? Math.round((interviewingOrBetter / totalJobs) * 100) : 0,
      overdue_followups: overdueCount || 0,
      active_relationships: activeContactIds.size,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

export default router;
