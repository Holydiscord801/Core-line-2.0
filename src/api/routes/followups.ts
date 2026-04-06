import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';

const router = Router();

// GET /api/followups
router.get('/', async (req: Request, res: Response) => {
  try {
    const daysAhead = parseInt(req.query.days_ahead as string, 10) || 7;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);

    const { data, error } = await supabase
      .from('v2_followups')
      .select(`
        *,
        v2_jobs (id, title, company),
        v2_contacts (id, name, title, company)
      `)
      .eq('user_id', req.userId!)
      .eq('status', 'pending')
      .lte('due_date', endDate.toISOString().split('T')[0])
      .order('due_date', { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ followups: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch followups' });
  }
});

// POST /api/followups - Create a follow-up reminder
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { job_id, contact_id, due_date, reason, priority, timer_type, business_days_window } = req.body;

    if (!due_date || !reason) {
      res.status(400).json({ error: 'due_date and reason are required' });
      return;
    }

    const { data, error } = await supabase
      .from('v2_followups')
      .insert({
        user_id: userId,
        job_id: job_id || null,
        contact_id: contact_id || null,
        due_date,
        reason,
        priority: priority || 'medium',
        status: 'pending',
        timer_type: timer_type || 'application',
        business_days_window: business_days_window || 5,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ followup: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create followup' });
  }
});

// PATCH /api/followups/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { status, days } = req.body;

    const updateData: Record<string, any> = {};

    // Snooze operation
    if (days) {
      const snoozedUntil = new Date();
      snoozedUntil.setDate(snoozedUntil.getDate() + days);
      updateData.status = 'snoozed';
      updateData.snoozed_until = snoozedUntil.toISOString().split('T')[0];
      updateData.due_date = snoozedUntil.toISOString().split('T')[0];
    } else if (status) {
      updateData.status = status;
    }

    const { data, error } = await supabase
      .from('v2_followups')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Followup not found' });
      return;
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update followup' });
  }
});

export default router;
