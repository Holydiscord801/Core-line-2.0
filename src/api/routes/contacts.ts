import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';
import { findCrossJobContacts } from '../../utils/email-monitor.js';

const router = Router();

// GET /api/contacts/cross-job - Find contacts linked to multiple jobs
router.get('/cross-job', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const contacts = await findCrossJobContacts(userId);
    res.json(contacts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contacts
router.get('/', async (req: Request, res: Response) => {
  try {
    const { job_id } = req.query;

    if (job_id) {
      const { data, error } = await supabase
        .from('v2_job_contacts')
        .select(`
          contact_id,
          relevance_notes,
          v2_contacts (*)
        `)
        .eq('job_id', job_id as string);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      const contacts = (data || []).map((jc: any) => ({
        ...jc.v2_contacts,
        relevance_notes: jc.relevance_notes,
      }));

      res.json({ contacts });
      return;
    }

    const { data, error } = await supabase
      .from('v2_contacts')
      .select('*')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Hydrate linked_job_ids per contact via v2_job_contacts. Single query, grouped client side.
    const contactIds = (data || []).map((c: any) => c.id);
    const linkMap: Record<string, string[]> = {};
    if (contactIds.length > 0) {
      const { data: links, error: linkErr } = await supabase
        .from('v2_job_contacts')
        .select('contact_id, job_id')
        .in('contact_id', contactIds);

      if (linkErr) {
        res.status(500).json({ error: linkErr.message });
        return;
      }

      for (const row of links || []) {
        const cid = (row as any).contact_id as string;
        const jid = (row as any).job_id as string;
        if (!linkMap[cid]) linkMap[cid] = [];
        linkMap[cid].push(jid);
      }
    }

    const hydrated = (data || []).map((c: any) => ({
      ...c,
      linked_job_ids: linkMap[c.id] || [],
    }));

    res.json({ contacts: hydrated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST /api/contacts
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, title, company, linkedin_url, email, phone, relationship_type, notes, job_id } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const { data: contact, error } = await supabase
      .from('v2_contacts')
      .insert({
        user_id: req.userId!,
        name,
        title,
        company,
        linkedin_url,
        email,
        phone,
        relationship_type,
        notes,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Link to job if provided
    if (job_id && contact) {
      await supabase
        .from('v2_job_contacts')
        .insert({
          job_id,
          contact_id: contact.id,
        });
    }

    res.status(201).json(contact);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

export default router;
