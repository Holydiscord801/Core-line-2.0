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
