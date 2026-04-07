-- ============================================================================
-- Core Line 2.0: apply-multi-channel.sql
--
-- Paste this entire file into the Supabase Dashboard SQL Editor for project
-- hazsxuznwftwagpbuhre and run it once. It bundles migrations 008, 009, and
-- 010 in the correct order so the v2_outreach_sequences anchor table, the
-- v2_outreach attempt columns, the channel and delivery_status CHECK widening,
-- the v2_contacts.email_status column, the v2_followups.sequence_id FK, and
-- the indexes plus the recompute trigger all land together.
--
-- Idempotent: every CREATE uses IF NOT EXISTS, every DROP uses IF EXISTS,
-- the legacy backfill skips any v2_outreach row whose sequence_id is already
-- set, and the trigger recompute pass at the end is safe to re-run.
--
-- Source files (kept in version control under supabase/migrations/):
--   008_outreach_sequences.sql
--   009_outreach_attempts.sql
--   010_indexes_and_triggers.sql
--
-- After running, sanity check with:
--   SELECT count(*) FROM v2_outreach_sequences;     -- should equal pre count of v2_outreach
--   SELECT channel, count(*) FROM v2_outreach GROUP BY channel;
--   SELECT delivery_status, count(*) FROM v2_outreach GROUP BY delivery_status;
--   SELECT id, status, preferred_channel, last_attempted_at FROM v2_outreach_sequences LIMIT 5;
-- ============================================================================


-- ############################################################################
-- ## 008_outreach_sequences.sql
-- ############################################################################

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

-- ############################################################################
-- ## 009_outreach_attempts.sql
-- ############################################################################

-- Core Line 2.0 migration 009: outreach attempts (children of sequences)
--
-- Turns each row in v2_outreach into a child attempt of a v2_outreach_sequences
-- row. Adds the columns needed to model "we tried email, it bounced, we fell
-- back to LinkedIn DM, that delivered". Widens the channel CHECK so we can
-- distinguish LinkedIn DM, LinkedIn InMail, and a connection request note as
-- separate channels (they already exist as distinct values in
-- v2_hot_signals.signal_type, this brings the outreach vocabulary into parity).
-- Also adds v2_contacts.email_status so a bounced address can be flagged
-- without losing the value, which is what enables the fallback decision in the
-- send pipeline.
--
-- Backfill strategy: every existing v2_outreach row becomes its own
-- single-attempt sequence. The legacy 'linkedin' channel value is migrated
-- to 'linkedin_dm' (the most common case in practice; user can correct
-- after the fact if any are actually InMail).
--
-- Apply AFTER 008 and BEFORE 010.

-- ==============================================================
-- v2_outreach: add child attempt columns
-- ==============================================================

ALTER TABLE v2_outreach
    ADD COLUMN IF NOT EXISTS sequence_id UUID
        REFERENCES v2_outreach_sequences(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS attempt_number INT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS delivery_status TEXT,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS failed_reason TEXT;

-- ==============================================================
-- Widen the channel CHECK
-- ==============================================================
-- Old: ('email', 'linkedin', 'phone', 'in_person')
-- New: ('email', 'linkedin_dm', 'linkedin_inmail', 'linkedin_connection_note', 'phone', 'in_person')

-- Drop the unnamed inline constraint by using its generated name. Postgres
-- names inline column CHECKs as <table>_<col>_check, so the original was
-- v2_outreach_channel_check. If a manual rerun renamed it, the IF EXISTS
-- guard makes this a no-op.
ALTER TABLE v2_outreach
    DROP CONSTRAINT IF EXISTS v2_outreach_channel_check;

-- Migrate any existing 'linkedin' rows to 'linkedin_dm' BEFORE the new
-- CHECK is added, otherwise the constraint will reject them.
UPDATE v2_outreach
    SET channel = 'linkedin_dm'
    WHERE channel = 'linkedin';

ALTER TABLE v2_outreach
    ADD CONSTRAINT v2_outreach_channel_check
    CHECK (channel IN (
        'email',
        'linkedin_dm',
        'linkedin_inmail',
        'linkedin_connection_note',
        'phone',
        'in_person'
    ));

-- ==============================================================
-- delivery_status CHECK
-- ==============================================================
-- Allowed values:
--   'queued'    we have not attempted send yet
--   'sent'      we handed it to the channel transport
--   'delivered' the channel reported (or implied) successful delivery
--   'bounced'   the channel reported a hard or soft bounce
--   'failed'    transport failure with no chance of retry on this channel

ALTER TABLE v2_outreach
    DROP CONSTRAINT IF EXISTS v2_outreach_delivery_status_check;

ALTER TABLE v2_outreach
    ADD CONSTRAINT v2_outreach_delivery_status_check
    CHECK (delivery_status IS NULL OR delivery_status IN (
        'queued',
        'sent',
        'delivered',
        'bounced',
        'failed'
    ));

-- ==============================================================
-- v2_contacts: email verification status
-- ==============================================================
-- Lets the send pipeline mark a known-bad address without losing the
-- string. The Dexcom case (Girish Naganathan, gnaganathan@dexcom.com)
-- is the immediate motivator: the address bounced, the row still has
-- it set, and the next automated send would happily retry. After this
-- column is in place, the bounce handler can flip email_status to
-- 'bounced' and the send pipeline will skip email and fall back.

ALTER TABLE v2_contacts
    ADD COLUMN IF NOT EXISTS email_status TEXT;

ALTER TABLE v2_contacts
    DROP CONSTRAINT IF EXISTS v2_contacts_email_status_check;

ALTER TABLE v2_contacts
    ADD CONSTRAINT v2_contacts_email_status_check
    CHECK (email_status IS NULL OR email_status IN (
        'unverified',
        'verified',
        'bounced',
        'invalid'
    ));

-- ==============================================================
-- BACKFILL: every legacy v2_outreach row becomes a single-attempt sequence
-- ==============================================================
-- Idempotent: only operates on rows whose sequence_id is still null. The
-- v2_outreach table has known duplicate-bug groups (e.g. four rows for
-- Iron Mountain + Mithu sharing the same job_id and contact_id and very
-- close sent_at), so a CTE join by (job_id, contact_id, sent_at) is
-- ambiguous. A row-by-row DO block sidesteps the ambiguity completely.
-- Performance is irrelevant at this size (~30 rows).

DO $$
DECLARE
    o RECORD;
    new_seq_id UUID;
BEGIN
    FOR o IN
        SELECT id, user_id, job_id, contact_id, sent_at, created_at
        FROM v2_outreach
        WHERE sequence_id IS NULL
        ORDER BY sent_at
    LOOP
        INSERT INTO v2_outreach_sequences (
            user_id, job_id, contact_id, intent, status,
            first_attempted_at, last_attempted_at,
            created_at, updated_at
        )
        VALUES (
            o.user_id, o.job_id, o.contact_id, 'legacy backfill', 'active',
            o.sent_at, o.sent_at,
            o.created_at, o.created_at
        )
        RETURNING id INTO new_seq_id;

        UPDATE v2_outreach
        SET
            sequence_id = new_seq_id,
            attempt_number = 1,
            delivery_status = 'sent'
        WHERE id = o.id;
    END LOOP;
END $$;

-- ############################################################################
-- ## 010_indexes_and_triggers.sql
-- ############################################################################

-- Core Line 2.0 migration 010: indexes and triggers for multi-channel outreach
--
-- Adds the indexes that the timeline view and the war room aggregation
-- queries will hit, plus the trigger that keeps v2_outreach_sequences
-- denormalized fields (preferred_channel, last_delivered_at, last_attempted_at,
-- status) in sync as child v2_outreach rows are inserted or updated.
--
-- Apply AFTER 008 and 009.

-- ==============================================================
-- INDEXES
-- ==============================================================

-- Sequence lookups by job, contact, and per user pending sequences.
CREATE INDEX IF NOT EXISTS idx_v2_outreach_sequences_user
    ON v2_outreach_sequences (user_id);

CREATE INDEX IF NOT EXISTS idx_v2_outreach_sequences_job
    ON v2_outreach_sequences (job_id);

CREATE INDEX IF NOT EXISTS idx_v2_outreach_sequences_contact
    ON v2_outreach_sequences (contact_id);

-- Partial index for the war room "active sequences" query, equivalent in
-- spirit to idx_v2_followups_user_due. Pre-filters out failed, responded,
-- and archived sequences which are the long tail.
CREATE INDEX IF NOT EXISTS idx_v2_outreach_sequences_user_active
    ON v2_outreach_sequences (user_id, last_attempted_at DESC)
    WHERE status IN ('active', 'delivered');

-- Child attempt lookups by sequence id (the timeline query reads every
-- attempt for a sequence in chronological order).
CREATE INDEX IF NOT EXISTS idx_v2_outreach_sequence_id
    ON v2_outreach (sequence_id);

-- Followup-by-sequence (for the timer-restart logic in Phase 3 backend).
CREATE INDEX IF NOT EXISTS idx_v2_followups_sequence_id
    ON v2_followups (sequence_id);

-- Bounced-email lookup (the send pipeline will read this to skip).
CREATE INDEX IF NOT EXISTS idx_v2_contacts_email_status
    ON v2_contacts (email_status)
    WHERE email_status = 'bounced';

-- ==============================================================
-- TRIGGER: maintain sequence denormalized fields
-- ==============================================================
-- Whenever a v2_outreach row is inserted or its delivery_status changes,
-- recompute the parent sequence's preferred_channel, last_attempted_at,
-- last_delivered_at, and status. Centralizing this logic in a trigger
-- means the API layer cannot accidentally desync the parent row.
--
-- Rules (in order):
--   1. last_attempted_at = max(sent_at) across all child attempts of the sequence
--   2. last_delivered_at = max(sent_at) across attempts where delivery_status = 'delivered'
--   3. preferred_channel = channel of the most recent delivered attempt,
--      or null if nothing has been delivered yet
--   4. status:
--        if any child has response_received = true     -> 'responded'
--        else if last_delivered_at is not null         -> 'delivered'
--        else if every child has delivery_status in    -> 'failed'
--             ('bounced', 'failed')
--        else                                          -> 'active'
--      'archived' is set only by the user via the API and is never
--      overwritten by this trigger.

CREATE OR REPLACE FUNCTION recompute_outreach_sequence(seq_id UUID)
RETURNS VOID AS $$
DECLARE
    v_last_attempted   TIMESTAMPTZ;
    v_last_delivered   TIMESTAMPTZ;
    v_preferred_chan   TEXT;
    v_any_responded    BOOLEAN;
    v_total_children   INT;
    v_terminal_failed  INT;
    v_existing_status  TEXT;
    v_new_status       TEXT;
BEGIN
    IF seq_id IS NULL THEN
        RETURN;
    END IF;

    SELECT status INTO v_existing_status
    FROM v2_outreach_sequences
    WHERE id = seq_id;

    -- Never overwrite an archived sequence (user-controlled terminal state).
    IF v_existing_status = 'archived' THEN
        RETURN;
    END IF;

    SELECT
        MAX(sent_at),
        MAX(CASE WHEN delivery_status = 'delivered' THEN sent_at END),
        BOOL_OR(response_received),
        COUNT(*),
        COUNT(*) FILTER (WHERE delivery_status IN ('bounced', 'failed'))
    INTO
        v_last_attempted,
        v_last_delivered,
        v_any_responded,
        v_total_children,
        v_terminal_failed
    FROM v2_outreach
    WHERE sequence_id = seq_id;

    -- Preferred channel = channel of the most recent delivered attempt.
    SELECT channel
    INTO v_preferred_chan
    FROM v2_outreach
    WHERE sequence_id = seq_id
        AND delivery_status = 'delivered'
    ORDER BY sent_at DESC
    LIMIT 1;

    IF v_any_responded THEN
        v_new_status := 'responded';
    ELSIF v_last_delivered IS NOT NULL THEN
        v_new_status := 'delivered';
    ELSIF v_total_children > 0 AND v_total_children = v_terminal_failed THEN
        v_new_status := 'failed';
    ELSE
        v_new_status := 'active';
    END IF;

    UPDATE v2_outreach_sequences
    SET
        last_attempted_at = COALESCE(v_last_attempted, last_attempted_at),
        last_delivered_at = COALESCE(v_last_delivered, last_delivered_at),
        preferred_channel = COALESCE(v_preferred_chan, preferred_channel),
        status = v_new_status,
        updated_at = NOW()
    WHERE id = seq_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_v2_outreach_recompute_sequence()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recompute_outreach_sequence(OLD.sequence_id);
        RETURN OLD;
    END IF;

    PERFORM recompute_outreach_sequence(NEW.sequence_id);

    -- If sequence_id changed (rare, but possible during corrective updates),
    -- recompute the old parent too so it does not get left in a stale state.
    IF TG_OP = 'UPDATE' AND OLD.sequence_id IS DISTINCT FROM NEW.sequence_id THEN
        PERFORM recompute_outreach_sequence(OLD.sequence_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS v2_outreach_recompute_sequence ON v2_outreach;
CREATE TRIGGER v2_outreach_recompute_sequence
    AFTER INSERT OR UPDATE OR DELETE ON v2_outreach
    FOR EACH ROW
    EXECUTE FUNCTION trg_v2_outreach_recompute_sequence();

-- ==============================================================
-- TRIGGER: maintain v2_outreach_sequences.updated_at on direct edits
-- ==============================================================
-- The recompute function above already touches updated_at when child
-- attempts change, but direct API edits to a sequence (e.g. setting
-- intent or archiving) also need the bump. Reuses the existing
-- update_updated_at_column() function from migration 001.

DROP TRIGGER IF EXISTS update_v2_outreach_sequences_updated_at ON v2_outreach_sequences;
CREATE TRIGGER update_v2_outreach_sequences_updated_at
    BEFORE UPDATE ON v2_outreach_sequences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================
-- BACKFILL: run the recompute function once for every sequence created
-- in 009 so the denormalized fields reflect the legacy data.
-- ==============================================================

DO $$
DECLARE
    s RECORD;
BEGIN
    FOR s IN SELECT id FROM v2_outreach_sequences LOOP
        PERFORM recompute_outreach_sequence(s.id);
    END LOOP;
END $$;
