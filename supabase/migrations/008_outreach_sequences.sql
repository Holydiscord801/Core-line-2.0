-- Core Line 2.0 migration 008: outreach sequences anchor table
--
-- Introduces v2_outreach_sequences as the parent of zero or more delivery
-- attempts. One sequence equals one logical outreach (an attempt to reach a
-- specific person about a specific job, regardless of how many channels we
-- had to fall back through). Each row in v2_outreach (after migration 009)
-- becomes a child attempt of exactly one sequence.
--
-- This file only creates the anchor table, its RLS policies, and the
-- v2_followups.sequence_id foreign key. The work to make v2_outreach rows
-- become child attempts lives in 009, and the indexes plus triggers live
-- in 010. The three files were authored together and are designed to be
-- applied in numeric order.

-- ==============================================================
-- TABLE: v2_outreach_sequences
-- ==============================================================

CREATE TABLE IF NOT EXISTS v2_outreach_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
    job_id UUID REFERENCES v2_jobs(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES v2_contacts(id) ON DELETE SET NULL,

    -- What this sequence is trying to do. Free text by design (we do not
    -- want to lock the vocabulary at the schema layer for this column).
    -- Examples: "initial outreach", "post screen thank you", "second nudge".
    intent TEXT,

    -- Maintained by trigger (see migration 010) after each child attempt
    -- transitions to delivery_status='delivered'. The card displays this
    -- as "Reach via [preferred_channel]" with preferred_channel_reason
    -- as the subtitle (e.g. "email bounced 2026-04-07").
    preferred_channel TEXT,
    preferred_channel_reason TEXT,

    -- Sequence-level lifecycle. Independent of any single attempt's
    -- delivery_status. A sequence is 'active' until either every channel
    -- has failed (-> 'failed'), the contact responds (-> 'responded'),
    -- or the user closes it out (-> 'archived'). 'delivered' means at
    -- least one attempt has been delivered but no response yet.
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'delivered', 'failed', 'responded', 'archived')),

    -- Timestamps maintained both by the API layer on insert and by the
    -- trigger in migration 010 on every child attempt change.
    first_attempted_at TIMESTAMPTZ,
    last_attempted_at TIMESTAMPTZ,
    last_delivered_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================
-- v2_followups: anchor a followup to a specific sequence
-- ==============================================================
-- Today v2_followups is loosely tied to (job_id, contact_id) pairs. With
-- multi-channel attempts a single (job, contact) pair can have multiple
-- live sequences over time, so the timer needs a more specific anchor.
-- Nullable so existing followups remain valid until backfilled.

ALTER TABLE v2_followups
    ADD COLUMN IF NOT EXISTS sequence_id UUID
        REFERENCES v2_outreach_sequences(id) ON DELETE SET NULL;

-- ==============================================================
-- ROW LEVEL SECURITY
-- ==============================================================

ALTER TABLE v2_outreach_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own outreach sequences" ON v2_outreach_sequences;
CREATE POLICY "Users can view their own outreach sequences"
    ON v2_outreach_sequences FOR SELECT
    USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert their own outreach sequences" ON v2_outreach_sequences;
CREATE POLICY "Users can insert their own outreach sequences"
    ON v2_outreach_sequences FOR INSERT
    WITH CHECK (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update their own outreach sequences" ON v2_outreach_sequences;
CREATE POLICY "Users can update their own outreach sequences"
    ON v2_outreach_sequences FOR UPDATE
    USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own outreach sequences" ON v2_outreach_sequences;
CREATE POLICY "Users can delete their own outreach sequences"
    ON v2_outreach_sequences FOR DELETE
    USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

-- Service role bypass (used by the Express API and MCP server)
DROP POLICY IF EXISTS "Service role full access on sequences" ON v2_outreach_sequences;
CREATE POLICY "Service role full access on sequences"
    ON v2_outreach_sequences FOR ALL
    USING (auth.role() = 'service_role');
