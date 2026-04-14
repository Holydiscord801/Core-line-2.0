import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../../lib/supabase.js';
const router = Router();
// POST /api/keys - Generate a new API key
router.post('/', async (req, res) => {
    try {
        const userId = req.userId;
        const name = req.body.name || 'Default Key';
        const rawKey = 'cl_live_' + crypto.randomBytes(24).toString('hex');
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const keyPrefix = rawKey.substring(0, 16);
        const { data, error } = await supabase
            .from('v2_api_keys')
            .insert({
            user_id: userId,
            name,
            key_hash: keyHash,
            key_prefix: keyPrefix,
        })
            .select()
            .single();
        if (error)
            throw error;
        // Return the raw key only once
        res.json({ ...data, raw_key: rawKey });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/keys - List API keys (without raw keys)
router.get('/', async (req, res) => {
    try {
        const userId = req.userId;
        const { data, error } = await supabase
            .from('v2_api_keys')
            .select('id, name, key_prefix, last_used_at, created_at')
            .eq('user_id', userId);
        if (error)
            throw error;
        res.json(data || []);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
export default router;
//# sourceMappingURL=keys.js.map