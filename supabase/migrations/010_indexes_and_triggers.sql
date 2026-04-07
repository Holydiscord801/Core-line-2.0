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
