import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';

const router = Router();

// GET /api/outreach/sequences?job_id=<uuid>
router.get('/sequences', async (req: Request, res: Response) => {
  try {
    const { job_id } = req.query;

    if (!job_id) {
      res.status(400).json({ error: 'job_id is required' });
      return;
    }

    const { data: sequences, error: seqErr } = await supabase
      .from('v2_outreach_sequences')
      .select('*, v2_contacts(id, name, title, linkedin_url, email, email_status)')
      .eq('user_id', req.userId!)
      .eq('job_id', job_id as string)
      .order('created_at', { ascending: true });

    if (seqErr) {
      res.status(500).json({ error: seqErr.message });
      return;
    }

    const sequenceList = sequences || [];

    if (sequenceList.length === 0) {
      res.json({ job_id, sequences: [] });
      return;
    }

    const sequenceIds = sequenceList.map((s: any) => s.id);

    const { data: attempts, error: attemptsErr } = await supabase
      .from('v2_outreach')
      .select('*')
      .in('sequence_id', sequenceIds)
      .order('attempt_number', { ascending: true });

    if (attemptsErr) {
      res.status(500).json({ error: attemptsErr.message });
      return;
    }

    const attemptsBySeq = new Map<string, any[]>();
    for (const a of attempts || []) {
      const sid = (a as any).sequence_id;
      if (!sid) continue;
      if (!attemptsBySeq.has(sid)) attemptsBySeq.set(sid, []);
      attemptsBySeq.get(sid)!.push({
        id: (a as any).id,
        attempt_number: (a as any).attempt_number,
        channel: (a as any).channel,
        delivery_status: (a as any).delivery_status,
        sent_at: (a as any).sent_at,
        delivered_at: (a as any).delivered_at,
        bounced_at: (a as any).bounced_at,
        message_text: (a as any).message_text,
        subject_line: (a as any).subject_line,
        response_received: (a as any).response_received,
        response_text: (a as any).response_text,
        response_at: (a as any).response_at,
        response_type: (a as any).response_type,
        failed_reason: (a as any).failed_reason,
      });
    }

    const result = sequenceList.map((s: any) => {
      const contact = s.v2_contacts || null;
      return {
        id: s.id,
        contact_id: s.contact_id,
        contact: contact
          ? {
              id: contact.id,
              name: contact.name,
              title: contact.title,
              linkedin_url: contact.linkedin_url,
              email: contact.email,
              email_status: contact.email_status,
            }
          : null,
        intent: s.intent,
        status: s.status,
        preferred_channel: s.preferred_channel,
        preferred_channel_reason: s.preferred_channel_reason,
        last_attempted_at: s.last_attempted_at,
        last_delivered_at: s.last_delivered_at,
        created_at: s.created_at,
        attempts: attemptsBySeq.get(s.id) || [],
      };
    });

    res.json({ job_id, sequences: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sequences' });
  }
});

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

// PATCH /api/outreach/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { outcome, response_received, response_text, response_at } = req.body;

    const updateData: Record<string, any> = {};

    if (outcome !== undefined) updateData.outcome = outcome;
    if (response_received !== undefined) updateData.response_received = response_received;
    if (response_text !== undefined) updateData.response_text = response_text;
    if (response_at !== undefined) updateData.response_at = response_at;

    const { data, error } = await supabase
      .from('v2_outreach')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Outreach record not found' });
      return;
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update outreach' });
  }
});

export default router;
