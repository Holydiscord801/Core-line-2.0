-- Run this in the Supabase Dashboard SQL Editor (or via psql).
-- Creates v2_hot_signals table and seeds the two Day-1 records.
-- User ID: 349f82a7-2fd8-4d14-b309-ec94fb352b7a
-- Chainguard job ID: 024a99c7-af7b-435a-b9cf-36c7b271b58d
-- Evermore job ID: 358c5c9f-3a43-4361-91ee-59bfcbccf852
-- Chris Brown contact ID: 2493ee69-590c-4ec8-ace3-612ac37d0900

-- ==============================================================
-- TABLE
-- ==============================================================

CREATE TABLE IF NOT EXISTS v2_hot_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL CHECK (signal_type IN (
        'linkedin_accept','linkedin_dm','linkedin_inmail',
        'inbox_reply_positive','inbox_reply_negative','inbox_reply_neutral',
        'email_bounce','sent_outreach_captured','archived_reply_found',
        'profile_view_spike','other'
    )),
    severity TEXT NOT NULL DEFAULT 'hot' CHECK (severity IN ('hot','warm','info')),
    summary TEXT NOT NULL,
    ai_recommendation TEXT,
    recommended_action_type TEXT,
    recommended_action_payload JSONB,
    related_job_id UUID REFERENCES v2_jobs(id) ON DELETE SET NULL,
    related_contact_id UUID REFERENCES v2_contacts(id) ON DELETE SET NULL,
    source_email_id TEXT,
    source_url TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','user_acknowledged','actioned','dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    actioned_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hot_signals_user_status_created
    ON v2_hot_signals (user_id, status, created_at DESC);

ALTER TABLE v2_hot_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own hot signals" ON v2_hot_signals;
DROP POLICY IF EXISTS "Users can insert their own hot signals" ON v2_hot_signals;
DROP POLICY IF EXISTS "Users can update their own hot signals" ON v2_hot_signals;
DROP POLICY IF EXISTS "Service role full access" ON v2_hot_signals;

CREATE POLICY "Users can view their own hot signals"
    ON v2_hot_signals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own hot signals"
    ON v2_hot_signals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own hot signals"
    ON v2_hot_signals FOR UPDATE
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access"
    ON v2_hot_signals FOR ALL USING (auth.role() = 'service_role');

-- ==============================================================
-- SEED: Dan Lorenc (LinkedIn accept)
-- ==============================================================

INSERT INTO v2_hot_signals (
    user_id, signal_type, severity, summary,
    ai_recommendation, recommended_action_type,
    recommended_action_payload,
    related_job_id,
    source_email_id, source_url, status
) VALUES (
    '349f82a7-2fd8-4d14-b309-ec94fb352b7a',
    'linkedin_accept',
    'hot',
    'Dan Lorenc (CEO of Chainguard) accepted your LinkedIn invite yesterday at 3:20pm, ~45 minutes after you applied to the VP Engineering role at Chainguard. Warmest door in your pipeline right now.',
    'Dan, thanks for connecting. Funny timing: I applied for the VP Engineering role at Chainguard yesterday, about 45 minutes before you accepted this. Wolfi and the minimal-image thesis are what made me hit apply. You''re fixing the software supply chain at the only layer where the fix actually sticks. I''ve spent the last decade building engineering orgs that ship under security and compliance pressure, most of it in regulated healthcare. Worth 15 minutes to share why I think I''d be useful building out the product org as you scale?',
    'send_linkedin_dm',
    '{"channel": "linkedin", "recipient": "Dan Lorenc", "recipient_url": "https://www.linkedin.com/in/lorenc-dan/", "company": "Chainguard", "body": "Dan, thanks for connecting. Funny timing: I applied for the VP Engineering role at Chainguard yesterday, about 45 minutes before you accepted this. Wolfi and the minimal-image thesis are what made me hit apply. You''re fixing the software supply chain at the only layer where the fix actually sticks. I''ve spent the last decade building engineering orgs that ship under security and compliance pressure, most of it in regulated healthcare. Worth 15 minutes to share why I think I''d be useful building out the product org as you scale?"}',
    '024a99c7-af7b-435a-b9cf-36c7b271b58d',
    '19d64aae422fc7d2',
    'https://www.linkedin.com/in/lorenc-dan/',
    'new'
);

-- ==============================================================
-- SEED: Chris Brown (email bounce)
-- ==============================================================

INSERT INTO v2_hot_signals (
    user_id, signal_type, severity, summary,
    ai_recommendation, recommended_action_type,
    recommended_action_payload,
    related_job_id, related_contact_id,
    source_email_id, source_url, status
) VALUES (
    '349f82a7-2fd8-4d14-b309-ec94fb352b7a',
    'email_bounce',
    'hot',
    'Your outreach to chris@sodahealth.com bounced (address not found). Soda Health rebranded to Evermore in October 2025 and the old domain is dead. Recommend pivoting to LinkedIn DM since two bounces in 24 hours would damage sender reputation.',
    'Chris, I applied to the VP of Engineering role at Evermore yesterday. The note I sent to your old sodahealth.com address bounced (I''m guessing the domain went dark after the rebrand), so I''m reaching out here instead. The Rally Health to Evermore arc is a pattern I''ve been watching for years. Building consumer-grade software on top of the Medicare benefits stack is one of the hardest problems in healthcare and one of the most valuable when you get it right. Would love 15 minutes to share how I''d think about engineering leadership as you scale through the rebrand. Worth a conversation?',
    'send_linkedin_dm',
    '{"channel": "linkedin", "recipient": "Chris Brown", "recipient_url": "https://www.linkedin.com/in/chris-brown-7962342/", "company": "Evermore Health (fka Soda Health)", "body": "Chris, I applied to the VP of Engineering role at Evermore yesterday. The note I sent to your old sodahealth.com address bounced (I''m guessing the domain went dark after the rebrand), so I''m reaching out here instead. The Rally Health to Evermore arc is a pattern I''ve been watching for years. Building consumer-grade software on top of the Medicare benefits stack is one of the hardest problems in healthcare and one of the most valuable when you get it right. Would love 15 minutes to share how I''d think about engineering leadership as you scale through the rebrand. Worth a conversation?"}',
    '358c5c9f-3a43-4361-91ee-59bfcbccf852',
    '2493ee69-590c-4ec8-ace3-612ac37d0900',
    '19d64f411f839019',
    'https://www.linkedin.com/in/chris-brown-7962342/',
    'new'
);

-- ==============================================================
-- UPDATE Chris Brown contact: note the bounce
-- ==============================================================

UPDATE v2_contacts
SET notes = COALESCE(notes || E'\n', '') || 'Email chris@sodahealth.com bounced 2026-04-06 after Evermore rebrand. Pivoted to LinkedIn DM. Real Evermore email unknown.'
WHERE id = '2493ee69-590c-4ec8-ace3-612ac37d0900';
