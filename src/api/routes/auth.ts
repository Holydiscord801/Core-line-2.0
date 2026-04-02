import { Router, Request, Response } from 'express';
import { supabase } from '../../lib/supabase.js';
import { generateApiKey } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/api-key -- generates a new API key, returns raw key once
router.post('/api-key', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const { key, hash, prefix } = generateApiKey();

    const { data, error } = await supabase
      .from('v2_api_keys')
      .insert({
        user_id: req.userId!,
        name,
        key_hash: hash,
        key_prefix: prefix,
      })
      .select('id, name, key_prefix, created_at')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Return raw key ONCE -- it cannot be retrieved again
    res.status(201).json({
      ...data,
      api_key: key,
      warning: 'Store this API key securely. It cannot be retrieved again.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

export default router;
