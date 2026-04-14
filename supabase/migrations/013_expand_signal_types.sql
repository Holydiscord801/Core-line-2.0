-- Expand v2_hot_signals.signal_type to support rejection, followup_due, and ats_ack
-- Needed by the email cron for logging rejections, overdue timer signals, and ATS confirmations

ALTER TABLE v2_hot_signals DROP CONSTRAINT IF EXISTS v2_hot_signals_signal_type_check;

ALTER TABLE v2_hot_signals ADD CONSTRAINT v2_hot_signals_signal_type_check
    CHECK (signal_type IN (
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
        'rejection',
        'followup_due',
        'ats_ack',
        'other'
    ));
