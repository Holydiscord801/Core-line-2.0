import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';
import { z } from 'zod';
import type { JobStatus, JobSource, V2Job } from '../../types/index.js';
import { fetchJobDescription } from '../../utils/jd-scraper.js';
import { generateCoverLetterText } from '../../utils/cover-letter-generator.js';

const router = Router();

const CreateJobSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  url: z.string().url().optional(),
  description: z.string().optional(),
  salary_min: z.number().int().positive().optional(),
  salary_max: z.number().int().positive().optional(),
  location: z.string().optional(),
  remote: z.boolean().optional(),
  source: z.enum(['linkedin', 'indeed', 'google', 'glassdoor', 'manual', 'other']).optional(),
  notes: z.string().optional(),
  posted_at: z.string().datetime().optional(),
});

const UpdateJobSchema = z.object({
  title: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  url: z.string().url().optional(),
  description: z.string().optional(),
  salary_min: z.number().int().positive().optional(),
  salary_max: z.number().int().positive().optional(),
  location: z.string().optional(),
  remote: z.boolean().optional(),
  status: z.enum(['new', 'researching', 'applied', 'interviewing', 'offer', 'closed', 'rejected']).optional(),
  fit_score: z.number().int().min(0).max(100).optional(),
  source: z.enum(['linkedin', 'indeed', 'google', 'glassdoor', 'manual', 'other']).optional(),
  notes: z.string().optional(),
  posted_at: z.string().datetime().optional(),
  applied_at: z.string().datetime().optional(),
});

function extractVerbPhrase(recommendation: string | null | undefined): string | null {
  if (!recommendation) return null;
  const cleaned = recommendation.trim().replace(/^["'*\s]+/, '').split(/[.!?\n]/)[0].trim();
  if (!cleaned) return null;
  const words = cleaned.split(/\s+/).filter(Boolean);
  const stop = new Set(['the', 'a', 'an', 'to', 'please', 'you', 'should', 'consider']);
  while (words.length > 0 && stop.has(words[0].toLowerCase())) words.shift();
  if (words.length === 0) return null;
  return words.slice(0, 4).join(' ').toLowerCase();
}

function fallbackVerb(status: string | null | undefined): string | null {
  switch (status) {
    case 'new': return 'review and apply';
    case 'researching': return 'finish research';
    case 'applied': return 'follow up';
    case 'interviewing': return 'prep interview';
    case 'offer': return 'review offer';
    case 'closed': return 'archive';
    case 'rejected': return 'archive';
    default: return null;
  }
}

// GET /jobs - List jobs with optional filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { status, limit = '50', offset = '0' } = req.query;

    let query = supabase
      .from('v2_jobs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

    if (status) {
      query = query.eq('status', status as JobStatus);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const jobs = data || [];
    const jobIds = jobs.map((j: any) => j.id);

    if (jobIds.length === 0) {
      res.json({ jobs });
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    const [seqResult, fuResult, signalResult] = await Promise.all([
      supabase
        .from('v2_outreach_sequences')
        .select('job_id, preferred_channel, preferred_channel_reason, created_at')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('v2_followups')
        .select('job_id, due_date')
        .in('job_id', jobIds)
        .eq('status', 'pending')
        .gte('due_date', today)
        .order('due_date', { ascending: true }),
      supabase
        .from('v2_hot_signals')
        .select('related_job_id, ai_recommendation, created_at')
        .in('related_job_id', jobIds)
        .eq('status', 'new')
        .order('created_at', { ascending: false }),
    ]);

    const seqMap = new Map<string, any>();
    for (const row of seqResult.data || []) {
      const jid = (row as any).job_id;
      if (jid && !seqMap.has(jid)) seqMap.set(jid, row);
    }

    const fuMap = new Map<string, any>();
    for (const row of fuResult.data || []) {
      const jid = (row as any).job_id;
      if (jid && !fuMap.has(jid)) fuMap.set(jid, row);
    }

    const signalMap = new Map<string, any>();
    for (const row of signalResult.data || []) {
      const jid = (row as any).related_job_id;
      if (jid && !signalMap.has(jid)) signalMap.set(jid, row);
    }

    const enriched = jobs.map((j: any) => {
      const seq = seqMap.get(j.id);
      const fu = fuMap.get(j.id);
      const signal = signalMap.get(j.id);

      const preferred_channel = seq?.preferred_channel ?? null;
      const preferred_channel_reason = seq?.preferred_channel_reason ?? null;
      const next_followup_at = fu?.due_date ?? null;

      let next_action_verb: string | null = null;
      if (signal?.ai_recommendation) {
        next_action_verb = extractVerbPhrase(signal.ai_recommendation);
      }
      if (!next_action_verb) {
        next_action_verb = fallbackVerb(j.status);
      }

      return {
        ...j,
        preferred_channel,
        preferred_channel_reason,
        next_followup_at,
        next_action_verb,
      };
    });

    res.json({ jobs: enriched });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /jobs/:id/full - Full dossier: job + contacts (with per-contact outreach) + outreach + followups (with draft messages)
router.get('/:id/full', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const [jobResult, contactsResult, outreachResult, followupsResult, profileResult] = await Promise.all([
      supabase.from('v2_jobs').select('*').eq('id', id).eq('user_id', userId).single(),
      supabase.from('v2_job_contacts').select('contact_id, relevance_notes, v2_contacts (*)').eq('job_id', id),
      supabase.from('v2_outreach').select('*, v2_contacts (id, name, title)').eq('job_id', id).eq('user_id', userId).order('sent_at', { ascending: true }),
      supabase.from('v2_followups').select('*, v2_contacts (id, name, title, company, linkedin_url, email)').eq('job_id', id).eq('user_id', userId).eq('status', 'pending').order('due_date', { ascending: true }),
      supabase.from('v2_users').select('full_name, resume_text').eq('id', userId).single(),
    ]);

    if (jobResult.error) {
      if (jobResult.error.code === 'PGRST116') { res.status(404).json({ error: 'Job not found' }); return; }
      res.status(500).json({ error: jobResult.error.message }); return;
    }

    const job = jobResult.data;
    const allOutreach = outreachResult.data || [];
    const userName = profileResult.data?.full_name?.split(' ')[0] || 'there';

    // Build contacts with per-contact outreach history
    const contacts = (contactsResult.data || []).map((jc: any) => {
      const contact = jc.v2_contacts;
      const contactOutreach = allOutreach.filter((o: any) => o.contact_id === contact.id);
      return { ...contact, relevance_notes: jc.relevance_notes, outreach_history: contactOutreach };
    });

    // Enrich followups with draft messages
    const followups = (followupsResult.data || []).map((f: any) => {
      const contact = f.v2_contacts;
      const contactName = contact?.name?.split(' ')[0] || 'them';
      const contactOutreach = allOutreach.filter((o: any) => o.contact_id === f.contact_id);
      const lastMessage = contactOutreach.length > 0 ? contactOutreach[contactOutreach.length - 1] : null;
      const channel = lastMessage?.channel || 'email';
      const timerType = f.timer_type;

      let draft_message = '';
      if (timerType === 'interview_followup') {
        draft_message = channel === 'linkedin'
          ? `Hi ${contactName}, I wanted to check in on next steps for the ${job.title || 'role'} at ${job.company || 'your team'}. I really enjoyed our conversation and am excited about the opportunity. Please let me know if there is anything else you need from my end. Thanks, ${userName}`
          : `Hi ${contactName},\n\nI wanted to follow up on our conversation about the ${job.title || 'role'} at ${job.company || 'your company'}. I am very excited about the opportunity and would love to hear about next steps whenever you have an update.\n\nPlease let me know if there is anything else I can provide.\n\nBest,\n${userName}`;
      } else if (timerType === 'application_followup') {
        draft_message = channel === 'linkedin'
          ? `Hi ${contactName}, I recently applied for the ${job.title || 'role'} at ${job.company || 'your team'} and wanted to express my continued interest. I would love to connect for a brief chat about the role if you have a few minutes. Thanks, ${userName}`
          : `Hi ${contactName},\n\nI recently applied for the ${job.title || 'role'} at ${job.company || 'your company'} and wanted to follow up to express my continued interest. I believe my background is a strong fit and would welcome the chance to discuss the role further.\n\nBest,\n${userName}`;
      } else {
        draft_message = channel === 'linkedin'
          ? `Hi ${contactName}, I wanted to circle back on my message about the ${job.title || 'role'} at ${job.company || 'your team'}. I would love to connect for a quick chat if you have 15 minutes this week. Thanks, ${userName}`
          : `Hi ${contactName},\n\nI wanted to follow up on my note about the ${job.title || 'role'} at ${job.company || 'your company'}. I am still very interested and would welcome a brief conversation if the timing works.\n\nBest,\n${userName}`;
      }

      return {
        ...f,
        draft_message,
        draft_channel: channel,
        draft_subject: lastMessage?.subject_line ? `Re: ${lastMessage.subject_line}` : `Following up: ${job.title} at ${job.company}`,
      };
    });

    res.json({ job, contacts, outreach: allOutreach, followups });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /jobs/:id - Get single job
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const { data, error } = await supabase
      .from('v2_jobs')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ job: data });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /jobs - Create new job
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const parsed = CreateJobSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
      return;
    }

    const { data, error } = await supabase
      .from('v2_jobs')
      .insert({
        user_id: userId,
        ...parsed.data,
        status: 'new',
        source: parsed.data.source || 'manual',
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ job: data });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /jobs/:id - Full replace
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const parsed = UpdateJobSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
      return;
    }

    const { data, error } = await supabase
      .from('v2_jobs')
      .update(parsed.data)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ job: data });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /jobs/:id - Update job
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const parsed = UpdateJobSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
      return;
    }

    // Auto-set applied_at when status changes to applied
    const updateData = { ...parsed.data };
    if (parsed.data.status === 'applied' && !parsed.data.applied_at) {
      updateData.applied_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('v2_jobs')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ job: data });

    // Auto-trigger JD pipeline for high-fit jobs missing a JD
    if (data && parsed.data.fit_score !== undefined && parsed.data.fit_score >= 70 && !data.job_description && data.url) {
      (async () => {
        try {
          const jdResult = await fetchJobDescription(data.url as string);
          if (jdResult.text) {
            const updates: Record<string, unknown> = { job_description: jdResult.text };
            if (!data.cover_letter) {
              const { data: profile } = await supabase
                .from('v2_users')
                .select('full_name, resume_text')
                .eq('id', userId)
                .single();
              if (profile?.resume_text) {
                updates.cover_letter = generateCoverLetterText(profile, {
                  ...data,
                  job_description: jdResult.text,
                });
              }
            }
            await supabase
              .from('v2_jobs')
              .update(updates)
              .eq('id', id)
              .eq('user_id', userId);
            console.log(`[jd-pipeline] Auto-processed job ${id} via ${jdResult.source}`);
          }
        } catch (pipelineErr) {
          console.error(`[jd-pipeline] Auto-trigger failed for job ${id}:`, pipelineErr);
        }
      })();
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /jobs/:id - Delete job
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const { error } = await supabase
      .from('v2_jobs')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /jobs/fetch-all-jds - Batch fetch JDs for all high-scoring jobs missing them
router.post('/fetch-all-jds', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const minScore = parseInt((req.query.min_score as string) || '70', 10);

    const { data: jobs, error } = await supabase
      .from('v2_jobs')
      .select('id, title, company, url')
      .eq('user_id', userId)
      .gte('fit_score', minScore)
      .is('job_description', null)
      .not('url', 'is', null);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const total = jobs?.length || 0;
    res.json({ message: 'Batch JD fetch started', total, min_score: minScore });

    // Process in background — fire and forget
    (async () => {
      let fetched = 0;
      let failed = 0;
      for (const job of jobs || []) {
        try {
          const result = await fetchJobDescription(job.url as string);
          if (result.text) {
            await supabase
              .from('v2_jobs')
              .update({ job_description: result.text })
              .eq('id', job.id)
              .eq('user_id', userId);
            fetched++;
          } else {
            failed++;
            console.warn(`[batch-jd] ${job.company}: ${result.error}`);
          }
        } catch (err) {
          failed++;
          console.error(`[batch-jd] Failed for ${job.id}:`, err);
        }
        await new Promise(r => setTimeout(r, 600));
      }
      console.log(`[batch-jd] Done: ${fetched} fetched, ${failed} failed for user ${userId}`);
    })();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /jobs/generate-all-cover-letters - Batch generate cover letters for jobs with JDs
router.post('/generate-all-cover-letters', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    const [{ data: jobs, error: jobsErr }, { data: profile, error: profileErr }] = await Promise.all([
      supabase
        .from('v2_jobs')
        .select('*')
        .eq('user_id', userId)
        .not('job_description', 'is', null)
        .is('cover_letter', null),
      supabase
        .from('v2_users')
        .select('full_name, resume_text')
        .eq('id', userId)
        .single(),
    ]);

    if (jobsErr) { res.status(500).json({ error: jobsErr.message }); return; }
    if (!profile?.resume_text) {
      res.status(400).json({ error: 'No resume text in profile. Add resume text first.' });
      return;
    }

    const total = jobs?.length || 0;
    res.json({ message: 'Batch cover letter generation started', total });

    (async () => {
      let generated = 0;
      for (const job of jobs || []) {
        try {
          const coverLetter = generateCoverLetterText(profile, job);
          await supabase
            .from('v2_jobs')
            .update({ cover_letter: coverLetter })
            .eq('id', job.id)
            .eq('user_id', userId);
          generated++;
        } catch (err) {
          console.error(`[batch-cl] Failed for ${job.id}:`, err);
        }
      }
      console.log(`[batch-cl] Done: ${generated} generated for user ${userId}`);
    })();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /jobs/:id/fetch-jd - Fetch and store JD for a specific job
router.post('/:id/fetch-jd', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const { data: job, error: jobErr } = await supabase
      .from('v2_jobs')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (jobErr || !job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (!job.url) {
      res.status(400).json({ error: 'Job has no URL to fetch from' });
      return;
    }

    const result = await fetchJobDescription(job.url as string);

    if (!result.text) {
      res.status(422).json({
        error: result.error || 'Could not extract job description',
        source: result.source,
        hint: result.source === 'linkedin' || result.source === 'indeed'
          ? 'This job board blocks automated fetching. Paste the JD text manually.'
          : 'Check that the URL is still active and try again.',
      });
      return;
    }

    const updates: Record<string, unknown> = { job_description: result.text };

    // Auto-generate cover letter if resume exists and no cover letter yet
    let coverLetterGenerated = false;
    if (!job.cover_letter) {
      try {
        const { data: profile } = await supabase
          .from('v2_users')
          .select('full_name, resume_text')
          .eq('id', userId)
          .single();
        if (profile?.resume_text) {
          updates.cover_letter = generateCoverLetterText(profile, {
            ...job,
            job_description: result.text,
          });
          coverLetterGenerated = true;
        }
      } catch (clErr) {
        console.error('[cover-letter] Generation failed:', clErr);
      }
    }

    await supabase
      .from('v2_jobs')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId);

    res.json({
      job_id: id,
      jd_fetched: true,
      jd_source: result.source,
      jd_length: result.text.length,
      cover_letter_generated: coverLetterGenerated,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /jobs/:id/generate-cover-letter - Generate/regenerate cover letter for a specific job
router.post('/:id/generate-cover-letter', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const [{ data: job, error: jobErr }, { data: profile, error: profileErr }] = await Promise.all([
      supabase.from('v2_jobs').select('*').eq('id', id).eq('user_id', userId).single(),
      supabase.from('v2_users').select('full_name, resume_text').eq('id', userId).single(),
    ]);

    if (jobErr || !job) { res.status(404).json({ error: 'Job not found' }); return; }
    if (profileErr || !profile) { res.status(400).json({ error: 'User profile not found' }); return; }
    if (!profile.resume_text) {
      res.status(400).json({ error: 'No resume text in profile. Update your profile first.' });
      return;
    }

    const coverLetter = generateCoverLetterText(profile, job);

    await supabase
      .from('v2_jobs')
      .update({ cover_letter: coverLetter })
      .eq('id', id)
      .eq('user_id', userId);

    res.json({ job_id: id, cover_letter: coverLetter, generated: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
