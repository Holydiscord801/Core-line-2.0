import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';
import { z } from 'zod';
import type { JobStatus, JobSource, V2Job } from '../../types/index.js';

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

    res.json({ jobs: data });
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

export default router;
