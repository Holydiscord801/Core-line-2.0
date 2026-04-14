import { Router } from 'express';
import { supabase } from '../../lib/supabase.js';
const router = Router();
// PATCH /api/users/autopilot - Update autopilot settings
router.patch('/autopilot', async (req, res) => {
    try {
        const userId = req.userId;
        const { autopilot_enabled, review_window_hours } = req.body;
        const updates = {};
        if (autopilot_enabled !== undefined)
            updates.autopilot_enabled = autopilot_enabled;
        if (review_window_hours !== undefined)
            updates.review_window_hours = review_window_hours;
        const { data, error } = await supabase
            .from('v2_users')
            .update(updates)
            .eq('id', userId)
            .select()
            .single();
        if (error)
            throw error;
        res.json(data);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/users/profile - Get current user profile
router.get('/profile', async (req, res) => {
    try {
        const userId = req.userId;
        const { data, error } = await supabase
            .from('v2_users')
            .select('id, email, full_name, resume_text, preferences, onboarding_complete, autopilot_enabled, review_window_hours, trial_started_at, trial_ends_at, trial_length_days, preferences_version, created_at, updated_at')
            .eq('id', userId)
            .single();
        if (error)
            throw error;
        res.json(data);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/users/me - Alias for /profile
router.get('/me', async (req, res) => {
    try {
        const userId = req.userId;
        const { data, error } = await supabase
            .from('v2_users')
            .select('*')
            .eq('id', userId)
            .single();
        if (error)
            throw error;
        res.json(data);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PATCH /api/users/profile - Update user profile
router.patch('/profile', async (req, res) => {
    try {
        const userId = req.userId;
        const { full_name, resume_text, preferences } = req.body;
        const updates = {};
        if (full_name !== undefined)
            updates.full_name = full_name;
        if (resume_text !== undefined)
            updates.resume_text = resume_text;
        if (preferences !== undefined)
            updates.preferences = preferences;
        if (Object.keys(updates).length === 0) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }
        const { data, error } = await supabase
            .from('v2_users')
            .update(updates)
            .eq('id', userId)
            .select()
            .single();
        if (error)
            throw error;
        res.json(data);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/users/onboarding-complete - Mark onboarding as complete
router.post('/onboarding-complete', async (req, res) => {
    try {
        const userId = req.userId;
        const { data, error } = await supabase
            .from('v2_users')
            .update({ onboarding_complete: true })
            .eq('id', userId)
            .select()
            .single();
        if (error)
            throw error;
        res.json({ success: true, profile: data });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
export default router;
//# sourceMappingURL=users.js.map