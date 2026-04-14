import { Router } from 'express';
import { supabase } from '../../lib/supabase.js';
const router = Router();
// GET /api/pipeline/summary - Pipeline summary stats
router.get('/summary', async (req, res) => {
    try {
        const userId = req.userId;
        const { data: jobs } = await supabase
            .from('v2_jobs')
            .select('status, fit_score')
            .eq('user_id', userId);
        const { data: outreach } = await supabase
            .from('v2_outreach')
            .select('response_received')
            .eq('user_id', userId);
        const today = new Date().toISOString().split('T')[0];
        const { count: overdueCount } = await supabase
            .from('v2_followups')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'pending')
            .lt('due_date', today);
        const { data: contacts } = await supabase
            .from('v2_contacts')
            .select('warmth_score')
            .eq('user_id', userId);
        const jobsByStatus = {};
        (jobs || []).forEach((j) => {
            jobsByStatus[j.status] = (jobsByStatus[j.status] || 0) + 1;
        });
        const totalOutreach = outreach?.length || 0;
        const responses = outreach?.filter((o) => o.response_received).length || 0;
        const warmContacts = contacts?.filter((c) => c.warmth_score > 0).length || 0;
        res.json({
            jobs_by_status: jobsByStatus,
            total_jobs: jobs?.length || 0,
            total_outreach: totalOutreach,
            response_rate: totalOutreach > 0 ? Math.round((responses / totalOutreach) * 100) : 0,
            overdue_followups: overdueCount || 0,
            warm_contacts: warmContacts,
            total_contacts: contacts?.length || 0,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
export default router;
//# sourceMappingURL=pipeline.js.map