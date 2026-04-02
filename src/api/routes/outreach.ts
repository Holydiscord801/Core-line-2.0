import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';

const router = Router();

// GET /api/outreach
router.get('/', async (req: Request, res: Response) => {
  try {
    const { job_id, contact_id } = req.query;

    let query = supabase
      .from('v2_outreach')
      .select(`
        *,
        v2_jobs (id, title, company),
        v2_contacts (id, name, title, company)
      `)
      .eq('user_id', req.userId!)
      .order('sent_at', { ascending: false });

    if (job_id) query = query.eq('job_id', job_id as string);
    if (contact_id) query = query.eq('contact_id', contact_id as string);

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ outreach: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch outreach' });
  }
});

// POST /api/outreach
router.post('/', async (req: Request, res: Response) => {
  try {
    const { job_id, contact_id, channel, message_text } = req.body;

    if (!job_id || !contact_id || !channel || !message_text) {
      res.status(400).json({ error: 'job_id, contact_id, channel, and message_text are required' });
      return;
    }

    const { data: outreach, error } = await supabase
      .from('v2_outreach')
      .insert({
        user_id: req.userId!,
        job_id,
        contact_id,
        channel,
        message_text,
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Auto-create followup due in 3 days
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);

    await supabase
      .from('v2_followups')
      .insert({
        user_id: req.userId!,
        job_id,
        contact_id,
        due_date: dueDate.toISOString().split('T')[0],
        reason: 'Follow up on outreach - no response yet',
        priority: 'medium',
        status: 'pending',
      });

    res.status(201).json(outreach);
  } catch (err) {
    res.status(500).json({ error: 'Failed to log outreach' });
  }
});

export default router;
