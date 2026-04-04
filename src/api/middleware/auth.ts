import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabase } from '../../lib/supabase.js';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      authMethod?: 'jwt' | 'api_key';
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'No authorization header provided' });
    return;
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Invalid authorization format. Use: Bearer <token>' });
    return;
  }

  // Try API key first (starts with "cl_")
  if (token.startsWith('cl_')) {
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');

    const { data, error } = await supabase
      .from('v2_api_keys')
      .select('user_id')
      .eq('key_hash', keyHash)
      .single();

    if (error || !data) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // Update last_used_at
    await supabase
      .from('v2_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('key_hash', keyHash);

    req.userId = data.user_id;
    req.authMethod = 'api_key';
    next();
    return;
  }

  // Otherwise treat as Supabase JWT
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  // Look up v2_users row by auth_user_id
  let { data: v2User, error: userError } = await supabase
    .from('v2_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  // Auto-provision v2_users row for new sign-ups
  if ((userError && userError.code === 'PGRST116') || !v2User) {
    const { data: newUser, error: createError } = await supabase
      .from('v2_users')
      .insert({
        auth_user_id: user.id,
        email: user.email || '',
        full_name: user.user_metadata?.full_name || null,
        preferences: {},
        onboarding_complete: false,
        autopilot_enabled: false,
        review_window_hours: 4,
      })
      .select('id')
      .single();

    if (createError || !newUser) {
      res.status(500).json({ error: 'Failed to create user profile' });
      return;
    }

    v2User = newUser;
  } else if (userError) {
    res.status(500).json({ error: 'Database error: ' + userError.message });
    return;
  }

  req.userId = v2User.id;
  req.authMethod = 'jwt';
  next();
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `cl_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 11);
  return { key, hash, prefix };
}
