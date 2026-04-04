import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';

const router = Router();

// PATCH /api/users/autopilot - Update autopilot settings
router.patch('/autopilot', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { autopilot_enabled, review_window_hours } = req.body;

    const updates: any = {};
    if (autopilot_enabled !== undefined) updates.autopilot_enabled = autopilot_enabled;
    if (review_window_hours !== undefined) updates.review_window_hours = review_window_hours;

    const { data, error } = await supabase
      .from('v2_users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/me - Alias for /profile
router.get('/me', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { data, error } = await supabase
      .from('v2_users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
