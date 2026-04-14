import { Router } from 'express';
import { supabase } from '../../lib/supabase.js';
import { findCrossJobContacts } from '../../utils/email-monitor.js';
const router = Router();
// GET /api/contacts/cross-job - Find contacts linked to multiple jobs
router.get('/cross-job', async (req, res) => {
    try {
        const userId = req.userId;
        const contacts = await findCrossJobContacts(userId);
        res.json(contacts);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/contacts
router.get('/', async (req, res) => {
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
                .eq('job_id', job_id);
            if (error) {
                res.status(500).json({ error: error.message });
                return;
            }
            const contacts = (data || []).map((jc) => ({
                ...jc.v2_contacts,
                relevance_notes: jc.relevance_notes,
            }));
            res.json({ contacts });
            return;
        }
        const { data, error } = await supabase
            .from('v2_contacts')
            .select('*')
            .eq('user_id', req.userId)
            .order('created_at', { ascending: false });
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        // Hydrate linked_job_ids per contact via v2_job_contacts. Single query, grouped client side.
        const contactIds = (data || []).map((c) => c.id);
        const linkMap = {};
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
                const cid = row.contact_id;
                const jid = row.job_id;
                if (!linkMap[cid])
                    linkMap[cid] = [];
                linkMap[cid].push(jid);
            }
        }
        const hydrated = (data || []).map((c) => ({
            ...c,
            linked_job_ids: linkMap[c.id] || [],
        }));
        res.json({ contacts: hydrated });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch contacts' });
    }
});
// POST /api/contacts
router.post('/', async (req, res) => {
    try {
        const { name, title, company, linkedin_url, email, phone, relationship_type, notes, job_id } = req.body;
        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }
        const { data: contact, error } = await supabase
            .from('v2_contacts')
            .insert({
            user_id: req.userId,
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
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to create contact' });
    }
});
export default router;
//# sourceMappingURL=contacts.js.map