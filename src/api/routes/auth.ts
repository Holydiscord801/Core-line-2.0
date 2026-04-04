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

// GET /api/auth/api-keys - List user's API keys (no raw keys)
router.get('/api-keys', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('v2_api_keys')
      .select('id, name, key_prefix, last_used_at, created_at')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auth/api-keys/:id - Revoke an API key
router.delete('/api-keys/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabase
      .from('v2_api_keys')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId!);

    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
