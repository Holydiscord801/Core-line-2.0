import { Router } from 'express';
import { supabase } from '../../lib/supabase.js';
import { z } from 'zod';
const router = Router();
const SIGNAL_TYPES = [
    'linkedin_accept',
    'linkedin_dm',
    'linkedin_inmail',
    'inbox_reply_positive',
    'inbox_reply_negative',
    'inbox_reply_neutral',
    'email_bounce',
    'sent_outreach_captured',
    'archived_reply_found',
    'profile_view_spike',
    'other',
];
const SEVERITIES = ['hot', 'warm', 'info'];
const STATUSES = ['new', 'user_acknowledged', 'actioned', 'dismissed'];
const CreateHotSignalSchema = z.object({
    signal_type: z.enum(SIGNAL_TYPES),
    severity: z.enum(SEVERITIES).default('hot'),
    summary: z.string().min(1),
    ai_recommendation: z.string().optional(),
    recommended_action_type: z.string().optional(),
    recommended_action_payload: z.record(z.unknown()).optional(),
    related_job_id: z.string().uuid().optional(),
    related_contact_id: z.string().uuid().optional(),
    source_email_id: z.string().optional(),
    source_url: z.string().optional(),
});
const PatchHotSignalSchema = z.object({
    status: z.enum(STATUSES).optional(),
    acknowledged_at: z.string().datetime().optional(),
    actioned_at: z.string().datetime().optional(),
    dismissed_at: z.string().datetime().optional(),
});
// GET /api/hot-signals?status=new
router.get('/', async (req, res) => {
    try {
        const userId = req.userId;
        const { status } = req.query;
        let query = supabase
            .from('v2_hot_signals')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (status && STATUSES.includes(status)) {
            query = query.eq('status', status);
        }
        const { data, error } = await query;
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        res.json(data || []);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/hot-signals
router.post('/', async (req, res) => {
    try {
        const userId = req.userId;
        const parsed = CreateHotSignalSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.errors });
            return;
        }
        const { data, error } = await supabase
            .from('v2_hot_signals')
            .insert({ ...parsed.data, user_id: userId })
            .select()
            .single();
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        res.status(201).json(data);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PATCH /api/hot-signals/:id
router.patch('/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const parsed = PatchHotSignalSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.errors });
            return;
        }
        const updates = { ...parsed.data };
        // Auto-stamp timestamps based on status transition
        const now = new Date().toISOString();
        if (parsed.data.status === 'user_acknowledged' && !updates.acknowledged_at) {
            updates.acknowledged_at = now;
        }
        else if (parsed.data.status === 'actioned' && !updates.actioned_at) {
            updates.actioned_at = now;
        }
        else if (parsed.data.status === 'dismissed' && !updates.dismissed_at) {
            updates.dismissed_at = now;
        }
        const { data, error } = await supabase
            .from('v2_hot_signals')
            .update(updates)
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        if (!data) {
            res.status(404).json({ error: 'Hot signal not found' });
            return;
        }
        res.json(data);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
export default router;
//# sourceMappingURL=hot-signals.js.map