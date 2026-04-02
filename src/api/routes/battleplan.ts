import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';

const router = Router();

// GET /api/battle-plan
router.get('/', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('v2_battle_plans')
      .select('*')
      .eq('user_id', req.userId!)
      .eq('plan_date', date)
      .single();

    if (error && error.code !== 'PGRST116') {
      res.status(500).json({ error: error.message });
      return;
    }

    if (!data) {
      res.json({ battle_plan: null, message: `No battle plan found for ${date}` });
      return;
    }

    res.json({ battle_plan: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch battle plan' });
  }
});

// POST /api/battle-plan/generate
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { plan_date, plan_data, jobs_found, contacts_identified, ai_prompt_used } = req.body;

    const date = plan_date || new Date().toISOString().split('T')[0];

    // Upsert: replace if plan exists for this date
    const { data, error } = await supabase
      .from('v2_battle_plans')
      .upsert(
        {
          user_id: req.userId!,
          plan_date: date,
          plan_data: plan_data || {},
          jobs_found: jobs_found || 0,
          contacts_identified: contacts_identified || 0,
          ai_prompt_used,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,plan_date' }
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate battle plan' });
  }
});

export default router;
