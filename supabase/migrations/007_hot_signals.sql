-- Hot Signals: urgent, time-sensitive events the AI discovers between morning summaries
-- Examples: LinkedIn accept on application day, email bounce, positive inbox reply at 2pm
-- Every hot signal must have a recommended action (no FYI-only signals)

CREATE TABLE v2_hot_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL CHECK (signal_type IN (
        'linkedin_accept',
        'linkedin_dm',
        'linkedin_inmail',
        'inbox_reply_positive',
        'inbox_reply_negative',
        'inbox_reply_neutral',
        'email_bounce',
        'sent_outreach_captured',
        'archived_reply_found',
        'profile_view_spike',
        'other'
    )),
    severity TEXT NOT NULL DEFAULT 'hot' CHECK (severity IN ('hot', 'warm', 'info')),
    summary TEXT NOT NULL,
    ai_recommendation TEXT,
    recommended_action_type TEXT,
    recommended_action_payload JSONB,
    related_job_id UUID REFERENCES v2_jobs(id) ON DELETE SET NULL,
    related_contact_id UUID REFERENCES v2_contacts(id) ON DELETE SET NULL,
    source_email_id TEXT,
    source_url TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'user_acknowledged', 'actioned', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    actioned_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ
);

-- Primary dashboard query: all new signals for a user, newest first
CREATE INDEX idx_hot_signals_user_status_created
    ON v2_hot_signals (user_id, status, created_at DESC);

-- RLS: users see only their own signals
ALTER TABLE v2_hot_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own hot signals"
    ON v2_hot_signals FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own hot signals"
    ON v2_hot_signals FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own hot signals"
    ON v2_hot_signals FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Service role bypass (used by the Express API and MCP server)
CREATE POLICY "Service role full access"
    ON v2_hot_signals FOR ALL
    USING (auth.role() = 'service_role');
