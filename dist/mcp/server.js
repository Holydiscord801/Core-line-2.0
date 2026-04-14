import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { supabase } from '../lib/supabase.js';
import crypto from 'crypto';
import { addBusinessDays, TIMER_DEFAULTS } from '../utils/timers.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchJobDescription, isBlacklistedJobUrl, BLACKLISTED_DOMAINS } from '../utils/jd-scraper.js';
import { generateCoverLetterText } from '../utils/cover-letter-generator.js';
// ============================================
// Finalized MCP Operating Playbook
// ============================================
//
// Loaded at module startup from docs/PLAYBOOK.md and used as the single source
// of truth for both getSystemInstructions() and the top-level `instructions`
// field on the Server constructor inside createMCPServer(). The MCP handshake
// delivers PLAYBOOK_TEXT verbatim to any client that connects.
//
// Path resolution works in both dev (src/mcp/server.ts via ts-node) and
// compiled (dist/mcp/server.js via node) because both sit two levels deep
// under the project root.
const __mcpDirname = dirname(fileURLToPath(import.meta.url));
const PLAYBOOK_TEXT = readFileSync(join(__mcpDirname, '..', '..', 'docs', 'PLAYBOOK.md'), 'utf-8');
// ============================================
// Authentication
// ============================================
let currentUserId = null;
async function authenticateApiKey(apiKey) {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const { data, error } = await supabase
        .from('v2_api_keys')
        .select('user_id, paired_at')
        .eq('key_hash', keyHash)
        .single();
    if (error || !data) {
        return null;
    }
    // First-pair detection: set paired_at only once, on first successful auth. See proposal §3.2.
    const now = new Date().toISOString();
    const updates = { last_used_at: now };
    if (data.paired_at === null) {
        updates.paired_at = now;
    }
    await supabase
        .from('v2_api_keys')
        .update(updates)
        .eq('key_hash', keyHash);
    return data.user_id;
}
function requireAuth() {
    if (!currentUserId) {
        throw new Error('Not authenticated. Please provide a valid API key.');
    }
    return currentUserId;
}
// ============================================
// Tool Definitions
// ============================================
const tools = [
    {
        name: 'get_status',
        description: 'Returns the current status of the Core Line server for this user. CRITICAL: You MUST call this tool as your very first action in every new conversation, before doing anything else. If the response indicates onboarding is incomplete, run the §14 onboarding flow immediately. If the response indicates "ready", proceed with the normal §0 welcome flow.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_profile',
        description: 'Returns the user profile including resume summary, job preferences (target roles, salary floor, locations, remote preference), and industries of interest. Use this to understand what kind of jobs to look for and how to tailor outreach.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_battle_plan',
        description: 'Returns the enriched daily battle plan with complete live data. Includes: the battle plan record, live follow-ups due today with personalized copy-paste-ready draft messages, new opportunities with full job details and scores, active pipeline state, and unresolved hot signals. Default is today\'s plan. All follow-up drafts are in live_followups_due[].draft_message — present these to the user verbatim, never summarize.',
        inputSchema: {
            type: 'object',
            properties: {
                date: {
                    type: 'string',
                    description: 'Date in YYYY-MM-DD format. Defaults to today.',
                },
            },
            required: [],
        },
    },
    {
        name: 'get_jobs',
        description: 'Returns jobs in the pipeline. Filter by status to see jobs at different stages. Returns: title, company, salary range, fit score (0-100), current status, and when applied. Use this to track pipeline health and find jobs needing attention.',
        inputSchema: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    enum: ['new', 'researching', 'applied', 'interviewing', 'offer', 'closed', 'rejected'],
                    description: 'Filter by job status. Options: new (just discovered), researching (gathering info), applied (submitted application), interviewing (in interview process), offer (received offer), closed (no longer pursuing), rejected (received rejection).',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of jobs to return. Default 20.',
                },
            },
            required: [],
        },
    },
    {
        name: 'get_contacts',
        description: 'Returns contacts in the network. If job_id provided, returns only contacts linked to that specific job (hiring managers, recruiters, referrals). Includes: name, title, company, relationship type, LinkedIn URL, email. Use this to find warm connections for a role.',
        inputSchema: {
            type: 'object',
            properties: {
                job_id: {
                    type: 'string',
                    description: 'UUID of a job to filter contacts by. Returns contacts linked to that job.',
                },
            },
            required: [],
        },
    },
    {
        name: 'update_job_status',
        description: 'Updates a job\'s status as it moves through the pipeline. Call this when: applying to a job (status=applied), scheduling an interview (status=interviewing), receiving an offer (status=offer), getting rejected (status=rejected), or deciding to stop pursuing (status=closed). Optionally add notes.',
        inputSchema: {
            type: 'object',
            properties: {
                job_id: {
                    type: 'string',
                    description: 'UUID of the job to update.',
                },
                status: {
                    type: 'string',
                    enum: ['new', 'researching', 'applied', 'interviewing', 'offer', 'closed', 'rejected'],
                    description: 'New status for the job.',
                },
                notes: {
                    type: 'string',
                    description: 'Optional notes about the status change (e.g., "Phone screen scheduled for Tuesday").',
                },
            },
            required: ['job_id', 'status'],
        },
    },
    {
        name: 'log_outreach',
        description: 'Records that an outreach message was sent to a contact about a job. Automatically creates a follow-up reminder for 3 days later. Use this after sending a LinkedIn message, email, or making a call. Tracks the full outreach history for each contact.',
        inputSchema: {
            type: 'object',
            properties: {
                job_id: {
                    type: 'string',
                    description: 'UUID of the job this outreach relates to.',
                },
                contact_id: {
                    type: 'string',
                    description: 'UUID of the contact being reached out to.',
                },
                channel: {
                    type: 'string',
                    enum: ['email', 'linkedin', 'phone', 'in_person'],
                    description: 'Channel used for outreach.',
                },
                message_text: {
                    type: 'string',
                    description: 'The message that was sent (for reference and follow-up context).',
                },
            },
            required: ['job_id', 'contact_id', 'channel', 'message_text'],
        },
    },
    {
        name: 'get_followups_due',
        description: 'Returns follow-up reminders due in the next N days with personalized, copy-paste-ready draft messages. Each follow-up includes: full contact info (name, title, company, LinkedIn, email), full job context (title, company, JD, research memo), complete outreach history (every message sent and received), the follow-up number (1st, 2nd, escalation), and a draft_message field with a ready-to-send personalized message. Present draft_message to the user verbatim — never summarize or paraphrase it. Default is 7 days ahead.',
        inputSchema: {
            type: 'object',
            properties: {
                days_ahead: {
                    type: 'number',
                    description: 'Number of days ahead to look for due follow-ups. Default 7.',
                },
            },
            required: [],
        },
    },
    {
        name: 'add_job',
        description: 'Adds a new job to the pipeline with status "new". Use this when discovering a promising job opportunity. Provide as much detail as available - salary range helps with fit scoring, URL enables easy reference.',
        inputSchema: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Job title (e.g., "Senior Software Engineer").',
                },
                company: {
                    type: 'string',
                    description: 'Company name.',
                },
                url: {
                    type: 'string',
                    description: 'URL to the job posting.',
                },
                salary_min: {
                    type: 'number',
                    description: 'Minimum salary in the range (annual, USD).',
                },
                salary_max: {
                    type: 'number',
                    description: 'Maximum salary in the range (annual, USD).',
                },
                location: {
                    type: 'string',
                    description: 'Job location (e.g., "San Francisco, CA" or "Remote").',
                },
                remote: {
                    type: 'boolean',
                    description: 'Whether the job is remote-friendly.',
                },
                notes: {
                    type: 'string',
                    description: 'Any initial notes about the job.',
                },
            },
            required: ['title', 'company', 'url'],
        },
    },
    {
        name: 'add_contact',
        description: 'Adds a new contact to the network, optionally linking them to a specific job. Use when discovering a relevant person at a target company. Relationship type helps prioritize outreach (hiring_manager > recruiter > peer).',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Contact\'s full name.',
                },
                title: {
                    type: 'string',
                    description: 'Contact\'s job title.',
                },
                company: {
                    type: 'string',
                    description: 'Company where contact works.',
                },
                relationship_type: {
                    type: 'string',
                    enum: ['hiring_manager', 'reports_to', 'peer', 'recruiter', 'mutual_connection', 'warm_intro', 'other'],
                    description: 'Type of relationship: hiring_manager (would be your boss), reports_to (would report to you), peer (same level), recruiter (internal/external recruiter), mutual_connection (shared connection), warm_intro (someone who can introduce you), other.',
                },
                job_id: {
                    type: 'string',
                    description: 'UUID of job to link this contact to.',
                },
                linkedin_url: {
                    type: 'string',
                    description: 'LinkedIn profile URL.',
                },
                email: {
                    type: 'string',
                    description: 'Email address if known.',
                },
                notes: {
                    type: 'string',
                    description: 'Notes about the contact (e.g., "Met at conference", "Friend of Sarah").',
                },
            },
            required: ['name', 'title', 'company', 'relationship_type'],
        },
    },
    {
        name: 'get_pipeline_summary',
        description: 'Returns a high-level summary of job search health. Includes: total jobs by status, outreach response rate, interview conversion rate, average days jobs spend in pipeline, and count of overdue follow-ups. Use this for weekly reviews and to identify bottlenecks.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'mark_outreach_response',
        description: 'Records a response received to previous outreach. Updates the outreach record and optionally updates job status if outcome is "interview_scheduled". Use this when a contact replies to track conversion rates and relationship progress.',
        inputSchema: {
            type: 'object',
            properties: {
                outreach_id: {
                    type: 'string',
                    description: 'UUID of the outreach record to update.',
                },
                response_text: {
                    type: 'string',
                    description: 'Summary or quote of the response received.',
                },
                outcome: {
                    type: 'string',
                    enum: ['no_response', 'positive', 'negative', 'interview_scheduled', 'referred'],
                    description: 'Outcome of the outreach: positive (interested/helpful), negative (not interested/rejected), interview_scheduled (got an interview), referred (referred to someone else), no_response (for marking stale outreach).',
                },
            },
            required: ['outreach_id', 'response_text', 'outcome'],
        },
    },
    {
        name: 'snooze_followup',
        description: 'Snoozes a follow-up reminder for N days. Use when it\'s not the right time to follow up (e.g., contact is on vacation, waiting for internal process). The follow-up will reappear after the snooze period.',
        inputSchema: {
            type: 'object',
            properties: {
                followup_id: {
                    type: 'string',
                    description: 'UUID of the follow-up to snooze.',
                },
                days: {
                    type: 'number',
                    description: 'Number of days to snooze the follow-up.',
                },
            },
            required: ['followup_id', 'days'],
        },
    },
    {
        name: 'get_system_instructions',
        description: 'Returns the system instructions for any AI connecting to Core Line. Call this FIRST when starting a session. Returns: what Core Line is, available tools, the daily workflow, and how to format responses. No authentication required for this call.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'search_jobs',
        description: 'Returns a structured search prompt and parameters for finding jobs on LinkedIn/Indeed. The AI uses these parameters to search job boards with freshness filters. Returns search URLs, filters to apply, and the format to return results in.',
        inputSchema: {
            type: 'object',
            properties: {
                keywords: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Job title keywords to search for (e.g., ["VP Engineering", "CTO", "Director of Engineering"]).',
                },
                location: {
                    type: 'string',
                    description: 'Location filter (e.g., "Salt Lake City, UT" or "Remote").',
                },
                remote_only: {
                    type: 'boolean',
                    description: 'Only return remote-friendly positions.',
                },
                salary_min: {
                    type: 'number',
                    description: 'Minimum salary filter (annual USD).',
                },
                freshness_hours: {
                    type: 'number',
                    description: 'Only jobs posted within this many hours. Default 24.',
                },
            },
            required: ['keywords'],
        },
    },
    {
        name: 'score_job',
        description: 'Scores a job against the user profile. Returns a fit_score (0-100) with a breakdown by category: title match (25%), salary range (20%), remote preference (15%), company stage (15%), industry fit (15%), reporting level (10%). Use this after finding jobs to prioritize the pipeline.',
        inputSchema: {
            type: 'object',
            properties: {
                job_id: {
                    type: 'string',
                    description: 'UUID of an existing job to score. If provided, loads job details from DB.',
                },
                title: {
                    type: 'string',
                    description: 'Job title (used if job_id not provided).',
                },
                company: {
                    type: 'string',
                    description: 'Company name.',
                },
                salary_min: {
                    type: 'number',
                    description: 'Minimum salary.',
                },
                salary_max: {
                    type: 'number',
                    description: 'Maximum salary.',
                },
                location: {
                    type: 'string',
                    description: 'Job location.',
                },
                remote: {
                    type: 'boolean',
                    description: 'Whether remote.',
                },
                description: {
                    type: 'string',
                    description: 'Job description text for deeper analysis.',
                },
            },
            required: ['title', 'company'],
        },
    },
    {
        name: 'verify_posting',
        description: 'Verifies whether a job posting is still live. Updates the posting_status and posting_verified_at fields. Returns the current status and instructions for the AI to check the URL.',
        inputSchema: {
            type: 'object',
            properties: {
                job_id: {
                    type: 'string',
                    description: 'UUID of the job to verify.',
                },
                status: {
                    type: 'string',
                    enum: ['live', 'dead', 'expired', 'unknown'],
                    description: 'The posting status after verification. If omitted, returns instructions to check.',
                },
            },
            required: ['job_id'],
        },
    },
    {
        name: 'generate_outreach',
        description: 'Generates a personalized outreach message for a specific job and contact. Uses the user profile, job details, and contact information to create a tailored message. Returns a template the AI should customize further.',
        inputSchema: {
            type: 'object',
            properties: {
                job_id: {
                    type: 'string',
                    description: 'UUID of the target job.',
                },
                contact_id: {
                    type: 'string',
                    description: 'UUID of the contact to reach out to.',
                },
                tone: {
                    type: 'string',
                    enum: ['professional', 'warm', 'direct'],
                    description: 'Tone for the outreach. Default: professional.',
                },
            },
            required: ['job_id', 'contact_id'],
        },
    },
    {
        name: 'generate_cover_letter',
        description: 'Generates a tailored cover letter for a specific job application. Uses the user profile, full job description, and job details to create a compelling cover letter. Saves the result to v2_jobs.cover_letter.',
        inputSchema: {
            type: 'object',
            properties: {
                job_id: {
                    type: 'string',
                    description: 'UUID of the target job.',
                },
                style: {
                    type: 'string',
                    enum: ['formal', 'conversational', 'executive'],
                    description: 'Cover letter style. Default: executive.',
                },
            },
            required: ['job_id'],
        },
    },
    {
        name: 'create_gmail_draft',
        description: 'Creates a Gmail draft for outreach. Logs the draft in Core Line and provides instructions for the AI to create the actual Gmail draft via Gmail MCP tools. Links the draft to a job and contact for tracking.',
        inputSchema: {
            type: 'object',
            properties: {
                to: {
                    type: 'string',
                    description: 'Recipient email address.',
                },
                subject: {
                    type: 'string',
                    description: 'Email subject line.',
                },
                body: {
                    type: 'string',
                    description: 'Email body text.',
                },
                job_id: {
                    type: 'string',
                    description: 'UUID of the related job.',
                },
                contact_id: {
                    type: 'string',
                    description: 'UUID of the related contact.',
                },
            },
            required: ['to', 'subject', 'body'],
        },
    },
    {
        name: 'check_email_responses',
        description: 'Returns all sent outreach messages that have not received a response yet. The AI should:\n1. Check Gmail INBOX for replies to these threads\n2. Check Gmail SENT folder for outreach emails to known contacts (to detect when Micah sends outreach manually)\n3. Check Gmail ARCHIVED/ALL MAIL for missed replies\n\nFor inbox replies from known contacts: call mark_outreach_response() with the outcome.\nFor sent emails to known contacts not yet tracked: call log_outreach() to create the record, then this will auto-generate a follow-up timer.\n\nCRITICAL — Rejection cascade: When a rejection email is detected, do NOT just log it. The full cascade runs automatically: mark_outreach_response(negative) → update_job_status(rejected) → all pending follow-ups for that job marked done → all hot signals for that job dismissed. This is instant and requires no user confirmation.\n\nRun this every 2 hours during work hours.',
        inputSchema: {
            type: 'object',
            properties: {
                days_back: {
                    type: 'number',
                    description: 'How many days back to check. Default 14.',
                },
            },
            required: [],
        },
    },
    {
        name: 'bulk_import_jobs',
        description: 'Imports multiple jobs at once from a nightly search. Creates v2_jobs rows for each, auto-scores them against user profile, and returns a summary. Use this after search_jobs() to save discovered opportunities.',
        inputSchema: {
            type: 'object',
            properties: {
                jobs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            company: { type: 'string' },
                            url: { type: 'string' },
                            salary_min: { type: 'number' },
                            salary_max: { type: 'number' },
                            location: { type: 'string' },
                            remote: { type: 'boolean' },
                            fit_score: { type: 'number' },
                            source: { type: 'string' },
                            notes: { type: 'string' },
                        },
                        required: ['title', 'company', 'url'],
                    },
                    description: 'Array of job objects to import.',
                },
            },
            required: ['jobs'],
        },
    },
    {
        name: 'fetch_jd',
        description: 'Fetches the full job description from a job posting URL and stores it in the database. Supports Greenhouse, Lever, Ashby, BambooHR, Built In, Workday, and generic pages. After fetching, auto-generates a template cover letter if the user has a resume on file. Use this for any 70%+ job missing a job description.',
        inputSchema: {
            type: 'object',
            properties: {
                job_id: {
                    type: 'string',
                    description: 'UUID of the job to fetch the JD for. The job must have a URL.',
                },
            },
            required: ['job_id'],
        },
    },
    {
        name: 'batch_process_jobs',
        description: 'Processes all high-scoring jobs (default 70%+) that are missing job descriptions or cover letters. Fetches JDs from posting URLs and generates template cover letters. Use after bulk_import_jobs() or to backfill existing pipeline jobs.',
        inputSchema: {
            type: 'object',
            properties: {
                min_fit_score: {
                    type: 'number',
                    description: 'Minimum fit score threshold. Default 70.',
                },
                fetch_jds: {
                    type: 'boolean',
                    description: 'Whether to fetch missing JDs. Default true.',
                },
                generate_cover_letters: {
                    type: 'boolean',
                    description: 'Whether to generate missing cover letters. Default true.',
                },
            },
            required: [],
        },
    },
    {
        name: 'create_hot_signal',
        description: 'Writes a new urgent finding to the hot signals table. Use any time you discover something too important to wait for the morning summary: a LinkedIn accept from a target company CEO, an email bounce, a positive reply. Every signal MUST include a recommended action and a pre-drafted message or next step. Never create a hot signal that is just an FYI.',
        inputSchema: {
            type: 'object',
            properties: {
                signal_type: {
                    type: 'string',
                    enum: ['linkedin_accept', 'linkedin_dm', 'linkedin_inmail', 'inbox_reply_positive', 'inbox_reply_negative', 'inbox_reply_neutral', 'email_bounce', 'sent_outreach_captured', 'archived_reply_found', 'profile_view_spike', 'other'],
                    description: 'Classification of the signal.',
                },
                severity: {
                    type: 'string',
                    enum: ['hot', 'warm', 'info'],
                    description: 'hot = act today, warm = act this week, info = background context. Default hot.',
                },
                summary: {
                    type: 'string',
                    description: 'One-line plain-English description of what happened. No em dashes. Example: "Dan Lorenc (CEO of Chainguard) accepted your LinkedIn invite 45 minutes after you applied."',
                },
                ai_recommendation: {
                    type: 'string',
                    description: 'The full pre-drafted message or next action. For LinkedIn DMs and emails, include the complete message body. No em dashes.',
                },
                recommended_action_type: {
                    type: 'string',
                    description: 'Machine-readable action type. Examples: send_linkedin_dm, send_email, open_link, update_contact.',
                },
                recommended_action_payload: {
                    type: 'object',
                    description: 'Structured payload for the action: { channel, recipient, recipient_url, company, body } for DMs; { to, subject, body } for email.',
                },
                related_job_id: {
                    type: 'string',
                    description: 'UUID of the related v2_jobs record, if applicable.',
                },
                related_contact_id: {
                    type: 'string',
                    description: 'UUID of the related v2_contacts record, if applicable.',
                },
                source_email_id: {
                    type: 'string',
                    description: 'Gmail message ID if the signal was discovered via email.',
                },
                source_url: {
                    type: 'string',
                    description: 'Source URL (e.g., LinkedIn profile link).',
                },
            },
            required: ['signal_type', 'summary'],
        },
    },
    {
        name: 'get_hot_signals',
        description: 'Returns hot signals for the current user. Defaults to status=new (unacknowledged). Call this at the start of every session to surface anything urgent that came in since the last session.',
        inputSchema: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    enum: ['new', 'user_acknowledged', 'actioned', 'dismissed'],
                    description: 'Filter by status. Defaults to new.',
                },
            },
            required: [],
        },
    },
    {
        name: 'acknowledge_hot_signal',
        description: 'Marks a hot signal as user_acknowledged. Use after presenting a signal to the user so they know it has been seen.',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'UUID of the hot signal to acknowledge.',
                },
            },
            required: ['id'],
        },
    },
    {
        name: 'action_hot_signal',
        description: 'Marks a hot signal as actioned (the recommended action was taken). Use after sending the LinkedIn DM, sending the email, or completing whatever the recommended_action was.',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'UUID of the hot signal to mark as actioned.',
                },
            },
            required: ['id'],
        },
    },
    {
        name: 'dismiss_hot_signal',
        description: 'Marks a hot signal as dismissed (not acting on it). Use when the user decides not to act or the signal is no longer relevant.',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'UUID of the hot signal to dismiss.',
                },
            },
            required: ['id'],
        },
    },
    // ============================================================================
    // Onboarding write tools (PLAYBOOK §14)
    //
    // These are the conversational-onboarding write tools. When get_profile()
    // returns onboarding_complete:false, the AI walks the user through intake
    // using this sequence: set_resume_text → set_profile → set_preferences →
    // set_target_companies → set_job_tracks → complete_onboarding.
    //
    // Every set_* tool bumps v2_users.preferences_version and runs the
    // synchronous propagation cycle inside the same request (re-score pipeline,
    // invalidate stale cover letters, re-generate battle plan). There is NO
    // background worker — propagation blocks the MCP call for ~200-500ms on a
    // typical small pipeline. Every set_* tool also writes an audit row to
    // v2_profile_changes so the user can always ask "why did my pipeline change?"
    // ============================================================================
    {
        name: 'set_profile',
        description: 'Onboarding write tool. Sets the user\'s basic profile fields (full name, current title, city, state, years of experience). Use this after set_resume_text when the AI has extracted these values from the resume and the user has confirmed them. full_name is stored at the top level; current_title/city/state/years_experience are stored inside the preferences JSONB. This call bumps preferences_version and synchronously re-scores the pipeline before returning. Writes an audit row to v2_profile_changes.',
        inputSchema: {
            type: 'object',
            properties: {
                full_name: {
                    type: 'string',
                    description: 'User\'s full name, e.g. "Micah Baird".',
                },
                current_title: {
                    type: 'string',
                    description: 'Current job title, e.g. "VP Engineering".',
                },
                city: {
                    type: 'string',
                    description: 'Current city, e.g. "Denver".',
                },
                state: {
                    type: 'string',
                    description: 'Current state or region, e.g. "CO".',
                },
                years_experience: {
                    type: 'number',
                    description: 'Years of total professional experience.',
                },
            },
            required: [],
        },
    },
    {
        name: 'set_resume_text',
        description: 'Onboarding write tool. Sets the user\'s resume_text (plain text of the resume the user pasted or their AI extracted). ALSO triggers the 7-day trial timer on the FIRST call (idempotent — subsequent calls do NOT reset the trial, they only overwrite the resume text). Returns the trial start/end so the AI can tell the user when their trial began and how much time is left. This call bumps preferences_version, invalidates stale cover letters for unsent jobs, and synchronously re-scores the pipeline before returning. Writes an audit row to v2_profile_changes.',
        inputSchema: {
            type: 'object',
            properties: {
                resume_text: {
                    type: 'string',
                    description: 'Full plaintext of the user\'s resume. Core Line never sees the original file — the AI extracts and passes the clean text.',
                },
            },
            required: ['resume_text'],
        },
    },
    {
        name: 'set_preferences',
        description: 'Onboarding write tool. Partial patch of v2_users.preferences — pass only the fields that changed. Deep-merges with the existing preferences JSONB, so calling with {salary_floor: 180000} does NOT erase role_types, locations, etc. Supported fields: role_types (array), salary_floor (number), locations (array), remote_ok (bool), industries (array), timezone (IANA), auto_send_enabled (bool). For target_companies and job_tracks use the dedicated tools. This call bumps preferences_version and synchronously re-scores the pipeline before returning. Writes an audit row to v2_profile_changes per changed field.',
        inputSchema: {
            type: 'object',
            properties: {
                role_types: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Target job title keywords, e.g. ["VP Engineering", "CTO", "Director of Engineering"].',
                },
                salary_floor: {
                    type: 'number',
                    description: 'Minimum acceptable annual salary in USD.',
                },
                locations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Preferred locations, e.g. ["Denver, CO", "Salt Lake City, UT"].',
                },
                remote_ok: {
                    type: 'boolean',
                    description: 'Whether remote roles are acceptable.',
                },
                industries: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Preferred industries, e.g. ["fintech", "healthtech", "b2b saas"].',
                },
                timezone: {
                    type: 'string',
                    description: 'IANA timezone, e.g. "America/Denver". Used by the user\'s AI to schedule its own sweeps.',
                },
                auto_send_enabled: {
                    type: 'boolean',
                    description: 'Whether outreach drafts should be auto-sent (true) or only saved as drafts for user review (false). Applies to new drafts only.',
                },
            },
            required: [],
        },
    },
    {
        name: 'set_target_companies',
        description: 'Onboarding write tool. Replaces v2_users.preferences.target_companies with the provided array — these are the user\'s dream companies (names or domains). Used by battle plan ranking, search prioritization, and outreach prioritization. This call bumps preferences_version, immediately invalidates the current battle plan so it will regenerate on next get_battle_plan call, and synchronously re-scores the pipeline before returning. Writes an audit row to v2_profile_changes.',
        inputSchema: {
            type: 'object',
            properties: {
                target_companies: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Ordered list of target company names or domains, e.g. ["Stripe", "Figma", "vercel.com"]. Pass the full list every call — this is a replace, not a merge.',
                },
            },
            required: ['target_companies'],
        },
    },
    {
        name: 'set_job_tracks',
        description: 'Onboarding write tool. Replaces v2_users.preferences.job_tracks with the provided array. Each track is a separate "lane" the user wants to pursue (primary career track + optional dream lanes). Exactly zero or one track may have is_primary:true — the tool rejects arrays with two or more primary tracks. Used by search criteria per track, battle plan segmentation, and scoring context. This call bumps preferences_version, invalidates the current battle plan, and synchronously re-scores the pipeline before returning. Writes an audit row to v2_profile_changes.',
        inputSchema: {
            type: 'object',
            properties: {
                job_tracks: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'Human-readable track name, e.g. "VP Eng (primary)" or "CTO at seed-stage fintech".',
                            },
                            role_types: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Role title keywords specific to this track.',
                            },
                            industries: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Industries specific to this track (optional).',
                            },
                            companies: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Target companies specific to this track (optional).',
                            },
                            salary_floor: {
                                type: 'number',
                                description: 'Salary floor specific to this track (optional; overrides the top-level floor for this track only).',
                            },
                            is_primary: {
                                type: 'boolean',
                                description: 'Exactly one track should be the primary track. Pass false for all others.',
                            },
                        },
                        required: ['name', 'role_types', 'is_primary'],
                    },
                    description: 'Full list of tracks. Pass the complete array every call — this is a replace, not a merge.',
                },
            },
            required: ['job_tracks'],
        },
    },
    {
        name: 'complete_onboarding',
        description: 'Onboarding write tool. Flips v2_users.onboarding_complete to true. Call this as the final step of the PLAYBOOK §14 intake sequence, after set_resume_text, set_profile, set_preferences, set_target_companies, and set_job_tracks have all been called. Returns a summary of what was set plus a single human-readable sentence (summary_text) the AI can read back to the user. Does NOT bump preferences_version and does NOT run propagation (nothing preference-affecting changed).',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
];
// ============================================
// Tool Implementations
// ============================================
async function getStatus() {
    const userId = requireAuth();
    const { data: user, error } = await supabase
        .from('v2_users')
        .select('full_name, onboarding_complete, resume_text, preferences')
        .eq('id', userId)
        .single();
    if (error || !user) {
        throw new Error('User not found');
    }
    if (user.onboarding_complete) {
        return {
            status: 'ready',
            onboarding_complete: true,
            user_name: user.full_name || null,
            message: 'Core Line is fully configured. Ready for commands.',
        };
    }
    // Determine which onboarding step the user is on based on what's been set.
    // Steps: 1=greet, 2=resume, 3=profile, 4=roles/salary, 5=locations,
    //         6=target companies, 7=job tracks, 8=auto-send, 9=demo, 10=schedule, 11=finish
    let step = 1;
    const prefs = (user.preferences || {});
    if (user.resume_text) {
        step = 3; // resume done, next is profile
        if (user.full_name) {
            step = 4; // profile done, next is roles/salary
            if (prefs.role_types && prefs.role_types.length > 0) {
                step = 5; // roles done, next is locations
                if (prefs.locations && prefs.locations.length > 0) {
                    step = 6; // locations done, next is target companies
                    if (prefs.target_companies && prefs.target_companies.length > 0) {
                        step = 7; // targets done, next is job tracks
                        if (prefs.job_tracks && prefs.job_tracks.length > 0) {
                            step = 8; // tracks done, next is auto-send
                        }
                    }
                }
            }
        }
    }
    return {
        status: 'action_required',
        action: 'run_onboarding',
        onboarding_complete: false,
        onboarding_step: step,
        message: 'This user has not completed onboarding. Please run the §14 onboarding conversation immediately before doing anything else.',
    };
}
async function getProfile() {
    const userId = requireAuth();
    const { data, error } = await supabase
        .from('v2_users')
        .select('*')
        .eq('id', userId)
        .single();
    if (error || !data) {
        throw new Error('User profile not found');
    }
    return data;
}
async function getBattlePlan(date) {
    const userId = requireAuth();
    const targetDate = date || new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
        .from('v2_battle_plans')
        .select('*')
        .eq('user_id', userId)
        .eq('plan_date', targetDate)
        .single();
    if (error && error.code !== 'PGRST116') {
        throw new Error(`Error fetching battle plan: ${error.message}`);
    }
    if (!data)
        return null;
    // Enrich the battle plan with live followup drafts and complete data
    const followups = await getFollowupsDue(1);
    // Get today's new jobs with full details
    const { data: newJobs } = await supabase
        .from('v2_jobs')
        .select('id, title, company, url, fit_score, match_score, status, salary_min, salary_max, location, remote, cover_letter, created_at')
        .eq('user_id', userId)
        .eq('status', 'new')
        .order('fit_score', { ascending: false })
        .limit(10);
    // Get active pipeline jobs with pending actions
    const { data: activeJobs } = await supabase
        .from('v2_jobs')
        .select('id, title, company, url, status, fit_score, applied_at, updated_at')
        .eq('user_id', userId)
        .in('status', ['applied', 'interviewing', 'researching'])
        .order('updated_at', { ascending: false });
    // Get hot signals
    const { data: hotSignals } = await supabase
        .from('v2_hot_signals')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'new')
        .order('created_at', { ascending: false });
    return {
        ...data,
        live_followups_due: followups,
        new_opportunities: newJobs || [],
        active_pipeline: activeJobs || [],
        hot_signals: hotSignals || [],
        enrichment_note: 'This battle plan includes live data: followup drafts with personalized messages ready to copy-paste, full job details for new opportunities, active pipeline state, and unresolved hot signals. All draft messages are in live_followups_due[].draft_message.',
    };
}
async function getJobs(status, limit = 20) {
    const userId = requireAuth();
    let query = supabase
        .from('v2_jobs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (status) {
        query = query.eq('status', status);
    }
    const { data, error } = await query;
    if (error) {
        throw new Error(`Error fetching jobs: ${error.message}`);
    }
    return data;
}
async function getContacts(jobId) {
    const userId = requireAuth();
    if (jobId) {
        // Get contacts linked to this job
        const { data, error } = await supabase
            .from('v2_job_contacts')
            .select(`
        contact_id,
        relevance_notes,
        v2_contacts (*)
      `)
            .eq('job_id', jobId);
        if (error) {
            throw new Error(`Error fetching contacts: ${error.message}`);
        }
        return (data || []).map((jc) => jc.v2_contacts);
    }
    // Get all contacts for user
    const { data, error } = await supabase
        .from('v2_contacts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error) {
        throw new Error(`Error fetching contacts: ${error.message}`);
    }
    return data;
}
/**
 * Parse natural-language timing phrases from notes into a concrete due date.
 * Returns null if no timing phrase is detected.
 */
function parseDueDateFromNotes(notes) {
    const lower = notes.toLowerCase();
    const today = new Date();
    const currentDay = today.getDay(); // 0=Sun, 1=Mon, ...
    // "by Monday", "by Tuesday", etc.
    const byDayMatch = lower.match(/by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (byDayMatch) {
        const dayNames = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const targetDay = dayNames[byDayMatch[1]];
        const daysUntil = (targetDay - currentDay + 7) % 7 || 7;
        const result = new Date(today);
        result.setDate(result.getDate() + daysUntil);
        return result;
    }
    // "next Monday", "next Tuesday", etc.
    const nextDayMatch = lower.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (nextDayMatch) {
        const dayNames = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const targetDay = dayNames[nextDayMatch[1]];
        const daysUntil = (targetDay - currentDay + 7) % 7 || 7;
        const result = new Date(today);
        result.setDate(result.getDate() + daysUntil);
        return result;
    }
    // "mid-to-late next week", "mid next week", "late next week"
    if (/mid.to.late\s+next\s+week/.test(lower)) {
        // Wednesday-Thursday of next week
        const daysToNextWed = (3 - currentDay + 7) % 7 + 7;
        const result = new Date(today);
        result.setDate(result.getDate() + daysToNextWed);
        return result;
    }
    if (/late\s+next\s+week/.test(lower)) {
        // Thursday of next week
        const daysToNextThu = (4 - currentDay + 7) % 7 + 7;
        const result = new Date(today);
        result.setDate(result.getDate() + daysToNextThu);
        return result;
    }
    if (/mid\s+next\s+week/.test(lower)) {
        // Wednesday of next week
        const daysToNextWed = (3 - currentDay + 7) % 7 + 7;
        const result = new Date(today);
        result.setDate(result.getDate() + daysToNextWed);
        return result;
    }
    // "next week" (generic — default to Wednesday)
    if (/next\s+week/.test(lower) && !nextDayMatch) {
        const daysToNextWed = (3 - currentDay + 7) % 7 + 7;
        const result = new Date(today);
        result.setDate(result.getDate() + daysToNextWed);
        return result;
    }
    // "decision expected April 6", "expected Monday April 6", etc.
    const dateMatch = lower.match(/(?:expected|by|around|before)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/);
    if (dateMatch) {
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const monthMatch = lower.match(/(january|february|march|april|may|june|july|august|september|october|november|december)/);
        if (monthMatch) {
            const month = monthNames.indexOf(monthMatch[1]);
            const day = parseInt(dateMatch[1], 10);
            const year = today.getFullYear();
            const result = new Date(year, month, day);
            // If the date is in the past, it's already overdue — return today
            if (result < today)
                return today;
            return result;
        }
    }
    // "end of week" — Friday of current week
    if (/end\s+of\s+(?:this\s+)?week/.test(lower)) {
        const daysToFri = (5 - currentDay + 7) % 7 || 7;
        const result = new Date(today);
        result.setDate(result.getDate() + daysToFri);
        return result;
    }
    // "tomorrow"
    if (/\btomorrow\b/.test(lower)) {
        const result = new Date(today);
        result.setDate(result.getDate() + 1);
        return result;
    }
    return null;
}
/**
 * Find the primary contact (hiring_manager preferred) for a job.
 */
async function findPrimaryContactForJob(jobId) {
    // First try to find a hiring_manager
    const { data: hmContacts } = await supabase
        .from('v2_job_contacts')
        .select('contact_id, v2_contacts!inner(id, relationship_type)')
        .eq('job_id', jobId);
    if (!hmContacts || hmContacts.length === 0)
        return null;
    // Prefer hiring_manager, then recruiter, then any contact
    const hm = hmContacts.find((jc) => jc.v2_contacts?.relationship_type === 'hiring_manager');
    if (hm)
        return hm.contact_id;
    const recruiter = hmContacts.find((jc) => jc.v2_contacts?.relationship_type === 'recruiter');
    if (recruiter)
        return recruiter.contact_id;
    return hmContacts[0].contact_id;
}
async function updateJobStatus(jobId, status, notes) {
    const userId = requireAuth();
    const updateData = {
        status,
        updated_at: new Date().toISOString(),
    };
    if (notes) {
        updateData.notes = notes;
    }
    if (status === 'applied') {
        updateData.applied_at = new Date().toISOString();
    }
    const { data, error } = await supabase
        .from('v2_jobs')
        .update(updateData)
        .eq('id', jobId)
        .eq('user_id', userId)
        .select()
        .single();
    if (error || !data) {
        throw new Error(`Error updating job: ${error?.message || 'Job not found'}`);
    }
    // Auto-create follow-ups for interview and applied statuses
    if (status === 'interviewing' || status === 'applied') {
        const timerType = status === 'interviewing' ? 'interview_followup' : 'application_followup';
        const defaultWindow = TIMER_DEFAULTS[timerType];
        // Parse notes for timing overrides
        let dueDate;
        if (notes) {
            const parsed = parseDueDateFromNotes(notes);
            dueDate = parsed || addBusinessDays(new Date(), defaultWindow);
        }
        else {
            dueDate = addBusinessDays(new Date(), defaultWindow);
        }
        const contactId = await findPrimaryContactForJob(jobId);
        const reason = status === 'interviewing'
            ? 'Follow up on interview — check if next steps have been communicated'
            : 'Follow up on application — no response yet';
        const priority = status === 'interviewing' ? 'high' : 'medium';
        await supabase
            .from('v2_followups')
            .insert({
            user_id: userId,
            job_id: jobId,
            contact_id: contactId,
            due_date: dueDate.toISOString().split('T')[0],
            reason,
            priority,
            status: 'pending',
            timer_type: timerType,
            business_days_window: defaultWindow,
        });
    }
    // Terminal statuses: resolve all pending follow-ups and dismiss hot signals
    if (status === 'rejected' || status === 'offer' || status === 'closed') {
        await supabase
            .from('v2_followups')
            .update({ status: 'done' })
            .eq('user_id', userId)
            .eq('job_id', jobId)
            .eq('status', 'pending');
        // Dismiss any hot signals linked to this job
        await supabase
            .from('v2_hot_signals')
            .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('related_job_id', jobId)
            .in('status', ['new', 'user_acknowledged']);
    }
    return data;
}
async function logOutreach(jobId, contactId, channel, messageText) {
    const userId = requireAuth();
    // Create outreach record
    const { data: outreach, error: outreachError } = await supabase
        .from('v2_outreach')
        .insert({
        user_id: userId,
        job_id: jobId,
        contact_id: contactId,
        channel,
        message_text: messageText,
        sent_at: new Date().toISOString(),
    })
        .select()
        .single();
    if (outreachError || !outreach) {
        throw new Error(`Error logging outreach: ${outreachError?.message}`);
    }
    // Create follow-up reminder for 3 days later
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    await supabase
        .from('v2_followups')
        .insert({
        user_id: userId,
        job_id: jobId,
        contact_id: contactId,
        due_date: dueDate.toISOString().split('T')[0],
        reason: 'Follow up on outreach - no response yet',
        priority: 'medium',
        status: 'pending',
    });
    return outreach;
}
async function getFollowupsDue(daysAhead = 7) {
    const userId = requireAuth();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);
    const { data, error } = await supabase
        .from('v2_followups')
        .select(`
      *,
      v2_jobs (id, title, company, status, url, job_description),
      v2_contacts (id, name, title, company, linkedin_url, email, relationship_type)
    `)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .lte('due_date', endDate.toISOString().split('T')[0])
        .order('due_date', { ascending: true });
    if (error) {
        throw new Error(`Error fetching follow-ups: ${error.message}`);
    }
    // Load user profile for personalization context
    const { data: profile } = await supabase
        .from('v2_users')
        .select('full_name, resume_text')
        .eq('id', userId)
        .single();
    const userName = profile?.full_name?.split(' ')[0] || 'there';
    // Enrich with outreach history and draft follow-up messages
    const enriched = await Promise.all((data || []).map(async (followup) => {
        let days_since_last_contact = null;
        let outreach_history = [];
        if (followup.contact_id) {
            // Get full outreach history for this contact+job pair
            const outreachQuery = supabase
                .from('v2_outreach')
                .select('id, channel, message_text, subject_line, sent_at, response_received, response_text, outcome')
                .eq('contact_id', followup.contact_id)
                .order('sent_at', { ascending: true });
            if (followup.job_id) {
                outreachQuery.eq('job_id', followup.job_id);
            }
            const { data: history } = await outreachQuery;
            outreach_history = history || [];
            if (outreach_history.length > 0) {
                const lastSent = outreach_history[outreach_history.length - 1];
                days_since_last_contact = Math.floor((Date.now() - new Date(lastSent.sent_at).getTime()) / (1000 * 60 * 60 * 24));
            }
        }
        // Count prior follow-ups to determine escalation stage
        const followupNumber = outreach_history.filter((o) => !o.response_received).length;
        const contact = followup.v2_contacts;
        const job = followup.v2_jobs;
        const contactName = contact?.name?.split(' ')[0] || 'them';
        const lastMessage = outreach_history.length > 0
            ? outreach_history[outreach_history.length - 1]
            : null;
        // Generate personalized draft message
        let draft_message = '';
        const channel = lastMessage?.channel || 'email';
        const timerType = followup.timer_type;
        if (timerType === 'interview_followup') {
            // Interview follow-up: reference the interview process, not cold outreach
            draft_message = contact
                ? (channel === 'linkedin'
                    ? `Hi ${contactName}, I wanted to check in on next steps for the ${job?.title || 'role'} at ${job?.company || 'your team'}. I really enjoyed our conversation and am excited about the opportunity. Please let me know if there is anything else you need from my end. Thanks, ${userName}`
                    : `Hi ${contactName},\n\nI wanted to follow up on our conversation about the ${job?.title || 'role'} at ${job?.company || 'your company'}. I am very excited about the opportunity and would love to hear about next steps whenever you have an update.\n\nPlease let me know if there is anything else I can provide.\n\nBest,\n${userName}`)
                : `[ACTION] Follow up on interview for ${job?.title || 'role'} at ${job?.company || 'company'} — check if next steps or scheduling updates have been communicated.`;
        }
        else if (timerType === 'application_followup') {
            // Application follow-up: check on application status
            draft_message = contact
                ? (channel === 'linkedin'
                    ? `Hi ${contactName}, I recently applied for the ${job?.title || 'role'} at ${job?.company || 'your team'} and wanted to express my continued interest. I would love to connect for a brief chat about the role if you have a few minutes. Thanks, ${userName}`
                    : `Hi ${contactName},\n\nI recently applied for the ${job?.title || 'role'} at ${job?.company || 'your company'} and wanted to follow up to express my continued interest. I believe my background is a strong fit and would welcome the chance to discuss the role further.\n\nBest,\n${userName}`)
                : `[ACTION] Follow up on application for ${job?.title || 'role'} at ${job?.company || 'company'} — no response received yet.`;
        }
        else if (followupNumber <= 1) {
            // First follow-up: light, additive
            draft_message = channel === 'linkedin'
                ? `Hi ${contactName}, I wanted to circle back on my message about the ${job?.title || 'role'} at ${job?.company || 'your team'}. I would love to connect for a quick chat if you have 15 minutes this week. Thanks, ${userName}`
                : `Hi ${contactName},\n\nI wanted to follow up on my note about the ${job?.title || 'role'} at ${job?.company || 'your company'}. I am still very interested and would welcome a brief conversation if the timing works.\n\nBest,\n${userName}`;
        }
        else if (followupNumber === 2) {
            // Second follow-up: warm, soft pivot
            draft_message = channel === 'linkedin'
                ? `Hi ${contactName}, just a gentle nudge on the ${job?.title || 'role'} at ${job?.company || 'your team'}. If this is not the right time or I should reach out to someone else on the team, happy to take a redirect. Either way, appreciate your time. — ${userName}`
                : `Hi ${contactName},\n\nI know things get busy — just a quick follow-up on the ${job?.title || 'role'}. If you are not the best person to connect with on this, I would appreciate a point in the right direction. No pressure either way.\n\nThanks,\n${userName}`;
        }
        else {
            // Escalation: suggest different contact
            draft_message = `[ESCALATION] This is follow-up #${followupNumber} with no response. Recommend finding a different contact at ${job?.company || 'the company'} (peer, hiring manager, or related team) via LinkedIn and starting a fresh outreach sequence. Archive this follow-up after the new contact is identified.`;
        }
        return {
            ...followup,
            days_since_last_contact,
            outreach_history,
            followup_number: followupNumber,
            draft_message,
            draft_channel: channel,
            draft_subject: lastMessage?.subject_line
                ? `Re: ${lastMessage.subject_line}`
                : `Following up — ${job?.title || 'opportunity'} at ${job?.company || 'your company'}`,
        };
    }));
    return enriched;
}
async function addJob(params) {
    const userId = requireAuth();
    if (params.url && isBlacklistedJobUrl(params.url)) {
        throw new Error(`Rejected: ${params.url} is from a blacklisted source (Lever or Built In). ` +
            'Use LinkedIn, Indeed, Greenhouse, Workday, or the company careers page instead.');
    }
    const { data, error } = await supabase
        .from('v2_jobs')
        .insert({
        user_id: userId,
        title: params.title,
        company: params.company,
        url: params.url,
        salary_min: params.salary_min,
        salary_max: params.salary_max,
        location: params.location,
        remote: params.remote || false,
        notes: params.notes,
        status: 'new',
        source: 'manual',
    })
        .select()
        .single();
    if (error || !data) {
        throw new Error(`Error adding job: ${error?.message}`);
    }
    return data;
}
async function addContact(params) {
    const userId = requireAuth();
    const { data: contact, error: contactError } = await supabase
        .from('v2_contacts')
        .insert({
        user_id: userId,
        name: params.name,
        title: params.title,
        company: params.company,
        relationship_type: params.relationship_type,
        linkedin_url: params.linkedin_url,
        email: params.email,
        notes: params.notes,
    })
        .select()
        .single();
    if (contactError || !contact) {
        throw new Error(`Error adding contact: ${contactError?.message}`);
    }
    // Link to job if provided
    if (params.job_id) {
        await supabase
            .from('v2_job_contacts')
            .insert({
            job_id: params.job_id,
            contact_id: contact.id,
        });
    }
    return contact;
}
async function getPipelineSummary() {
    const userId = requireAuth();
    // Get all jobs
    const { data: jobs } = await supabase
        .from('v2_jobs')
        .select('status')
        .eq('user_id', userId);
    // Count by status
    const jobsByStatus = {
        new: 0,
        researching: 0,
        applied: 0,
        interviewing: 0,
        offer: 0,
        closed: 0,
        rejected: 0,
    };
    (jobs || []).forEach((job) => {
        jobsByStatus[job.status]++;
    });
    const totalApplied = jobsByStatus.applied + jobsByStatus.interviewing + jobsByStatus.offer + jobsByStatus.closed + jobsByStatus.rejected;
    // Get outreach stats
    const { data: outreach } = await supabase
        .from('v2_outreach')
        .select('response_received, contact_id, sent_at')
        .eq('user_id', userId);
    const totalOutreach = outreach?.length || 0;
    const responsesReceived = outreach?.filter((o) => o.response_received).length || 0;
    // Get overdue followups
    const today = new Date().toISOString().split('T')[0];
    const { count: overdueCount } = await supabase
        .from('v2_followups')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending')
        .lt('due_date', today);
    // Active relationships (contacts with outreach in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeContactIds = new Set((outreach || [])
        .filter((o) => o.contact_id && new Date(o.sent_at) >= thirtyDaysAgo)
        .map((o) => o.contact_id));
    const totalJobs = jobs?.length || 0;
    const interviewingOrBetter = jobsByStatus.interviewing + jobsByStatus.offer;
    return {
        jobs_by_status: jobsByStatus,
        total_applied: totalApplied,
        response_rate: totalOutreach > 0 ? Math.round((responsesReceived / totalOutreach) * 100) : 0,
        interview_rate: totalJobs > 0 ? Math.round((interviewingOrBetter / totalJobs) * 100) : 0,
        overdue_followups: overdueCount || 0,
        active_relationships: activeContactIds.size,
    };
}
async function markOutreachResponse(outreachId, responseText, outcome) {
    const userId = requireAuth();
    const { data, error } = await supabase
        .from('v2_outreach')
        .update({
        response_received: true,
        response_text: responseText,
        response_at: new Date().toISOString(),
        outcome,
    })
        .eq('id', outreachId)
        .eq('user_id', userId)
        .select()
        .single();
    if (error || !data) {
        throw new Error(`Error updating outreach: ${error?.message || 'Not found'}`);
    }
    // If interview scheduled, update job status
    if (outcome === 'interview_scheduled' && data.job_id) {
        await supabase
            .from('v2_jobs')
            .update({ status: 'interviewing' })
            .eq('id', data.job_id)
            .eq('user_id', userId);
    }
    // Mark related followup as done
    if (data.contact_id) {
        await supabase
            .from('v2_followups')
            .update({ status: 'done' })
            .eq('contact_id', data.contact_id)
            .eq('user_id', userId)
            .eq('status', 'pending');
    }
    return data;
}
async function snoozeFollowup(followupId, days) {
    const userId = requireAuth();
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + days);
    const { data, error } = await supabase
        .from('v2_followups')
        .update({
        status: 'snoozed',
        snoozed_until: snoozedUntil.toISOString().split('T')[0],
        due_date: snoozedUntil.toISOString().split('T')[0],
    })
        .eq('id', followupId)
        .eq('user_id', userId)
        .select()
        .single();
    if (error || !data) {
        throw new Error(`Error snoozing follow-up: ${error?.message || 'Not found'}`);
    }
    return data;
}
// ============================================
// New Tool Implementations
// ============================================
async function getSystemInstructions() {
    return {
        instructions: PLAYBOOK_TEXT,
        version: '2.0.0',
        tools_available: tools.length,
    };
}
async function searchJobs(params) {
    const userId = requireAuth();
    const profile = await getProfile();
    const freshness = params.freshness_hours || 24;
    const location = params.location || profile.preferences?.locations?.[0] || 'United States';
    const salaryMin = params.salary_min || profile.preferences?.salary_floor || 0;
    return {
        search_instructions: `Search for jobs matching these criteria and return structured results.`,
        parameters: {
            keywords: params.keywords,
            location,
            remote_only: params.remote_only || profile.preferences?.remote_ok || false,
            salary_min: salaryMin,
            freshness_filter: `Posted within last ${freshness} hours`,
            linkedin_url_hint: `Use LinkedIn search with f_TPR=r${freshness * 3600} for freshness filtering`,
            indeed_url_hint: `Use Indeed search with fromage=1 for last 24 hours`,
        },
        user_profile: {
            target_roles: profile.preferences?.role_types || [],
            industries: profile.preferences?.industries || [],
            salary_floor: profile.preferences?.salary_floor,
        },
        return_format: {
            description: 'Return each job as a JSON object with these fields',
            fields: ['title', 'company', 'url', 'salary_min', 'salary_max', 'location', 'remote', 'description', 'posted_at'],
        },
        next_step: 'After finding jobs, call bulk_import_jobs() to save them, then score_job() for each.',
        source_quality_gate: {
            blocked_domains: BLACKLISTED_DOMAINS,
            instruction: 'FILTER OUT any job whose URL matches a blocked domain before returning results or calling bulk_import_jobs(). These sources are stale and not accepted by the system.',
            approved_sources: ['linkedin.com', 'indeed.com', 'myworkdayjobs.com', 'workday.com', 'greenhouse.io', 'boards.greenhouse.io', 'direct company career pages'],
        },
    };
}
// Pure scoring function. Takes the job fields and a UserPreferences bag and
// returns a full ScoreResult. Factored out of scoreJob() so the synchronous
// propagation cycle (see runPropagationCycle) can re-score every job in the
// pipeline against fresh preferences without duplicating the weight logic.
function computeFitScoreFromPrefs(jobData, prefs) {
    // Title match (25 points)
    const targetRoles = prefs.role_types || [];
    const titleLower = (jobData.title || '').toLowerCase();
    let titleScore = 0;
    for (const role of targetRoles) {
        if (titleLower.includes(role.toLowerCase())) {
            titleScore = 25;
            break;
        }
    }
    if (titleScore === 0) {
        const seniorKeywords = ['vp', 'vice president', 'director', 'head of', 'chief', 'cto', 'cio', 'svp'];
        if (seniorKeywords.some(k => titleLower.includes(k))) {
            titleScore = 15;
        }
    }
    // Salary range (20 points)
    const salaryFloor = prefs.salary_floor || 0;
    let salaryScore = 0;
    if (jobData.salary_max && jobData.salary_max >= salaryFloor) {
        salaryScore = 20;
    }
    else if (jobData.salary_min && jobData.salary_min >= salaryFloor * 0.9) {
        salaryScore = 15;
    }
    else if (!jobData.salary_min && !jobData.salary_max) {
        salaryScore = 10; // Unknown salary, give benefit of doubt
    }
    // Remote preference (15 points)
    let remoteScore = 0;
    if (prefs.remote_ok) {
        if (jobData.remote) {
            remoteScore = 15;
        }
        else {
            const prefLocations = (prefs.locations || []).map((l) => l.toLowerCase());
            const jobLoc = (jobData.location || '').toLowerCase();
            if (prefLocations.some((l) => jobLoc.includes(l))) {
                remoteScore = 12;
            }
            else {
                remoteScore = 5;
            }
        }
    }
    else {
        remoteScore = jobData.remote ? 8 : 15;
    }
    // Company stage (15 points) - give default score, AI can refine
    const companyScore = 10;
    // Industry fit (15 points)
    const targetIndustries = prefs.industries || [];
    let industryScore = 8; // default
    const descLower = (jobData.description || '').toLowerCase();
    for (const ind of targetIndustries) {
        if (descLower.includes(ind.toLowerCase())) {
            industryScore = 15;
            break;
        }
    }
    // Reporting level (10 points)
    let reportingScore = 5;
    if (titleLower.includes('vp') || titleLower.includes('svp') || titleLower.includes('chief') || titleLower.includes('cto') || titleLower.includes('cio')) {
        reportingScore = 10;
    }
    else if (titleLower.includes('director') || titleLower.includes('head')) {
        reportingScore = 8;
    }
    const fitScore = titleScore + salaryScore + remoteScore + companyScore + industryScore + reportingScore;
    return {
        fit_score: Math.min(100, fitScore),
        breakdown: {
            title_match: titleScore,
            salary_range: salaryScore,
            remote_preference: remoteScore,
            company_stage: companyScore,
            industry_fit: industryScore,
            reporting_level: reportingScore,
        },
        recommendation: fitScore >= 70 ? 'Strong match. Proceed with outreach and application.' :
            fitScore >= 50 ? 'Moderate match. Review before investing time.' :
                'Weak match. Consider skipping unless other factors are compelling.',
    };
}
async function scoreJob(params) {
    const userId = requireAuth();
    const profile = await getProfile();
    const prefs = profile.preferences || {};
    let jobData = params;
    // Load from DB if job_id provided
    if (params.job_id) {
        const { data } = await supabase
            .from('v2_jobs')
            .select('*')
            .eq('id', params.job_id)
            .eq('user_id', userId)
            .single();
        if (data) {
            jobData = { ...params, ...data };
        }
    }
    // Blocked source gate — return 0 immediately for lever.co, builtin.com, etc.
    const jobUrl = jobData.url;
    if (jobUrl && isBlacklistedJobUrl(jobUrl)) {
        const blocked = {
            fit_score: 0,
            breakdown: {
                title_match: 0,
                salary_range: 0,
                remote_preference: 0,
                company_stage: 0,
                industry_fit: 0,
                reporting_level: 0,
            },
            recommendation: `Score blocked: this job is from a disallowed source (${new URL(jobUrl).hostname}). ` +
                'Only LinkedIn, Indeed, Greenhouse, Workday, and direct company career pages are accepted. ' +
                'Find the same role on an approved platform and re-add it.',
        };
        return blocked;
    }
    const result = computeFitScoreFromPrefs(jobData, prefs);
    // Update job in DB if job_id provided. Also snapshot the current
    // preferences_version so reads can detect stale scores via
    // (preferences_version_at_score < v2_users.preferences_version).
    // See proposal §5.3.
    if (params.job_id) {
        await supabase
            .from('v2_jobs')
            .update({
            fit_score: result.fit_score,
            match_score: result.fit_score,
            preferences_version_at_score: profile.preferences_version ?? 0,
        })
            .eq('id', params.job_id)
            .eq('user_id', userId);
    }
    return result;
}
async function verifyPosting(params) {
    const userId = requireAuth();
    const { data: job } = await supabase
        .from('v2_jobs')
        .select('id, title, company, url, posting_status, posting_verified_at')
        .eq('id', params.job_id)
        .eq('user_id', userId)
        .single();
    if (!job)
        throw new Error('Job not found');
    if (params.status) {
        // Update the status
        const { data: updated } = await supabase
            .from('v2_jobs')
            .update({
            posting_status: params.status,
            posting_verified_at: new Date().toISOString(),
        })
            .eq('id', params.job_id)
            .eq('user_id', userId)
            .select()
            .single();
        return {
            job_id: params.job_id,
            status: params.status,
            checked_at: new Date().toISOString(),
            updated: true,
        };
    }
    // Return instructions to check
    return {
        job_id: job.id,
        title: job.title,
        company: job.company,
        url: job.url,
        current_status: job.posting_status,
        last_verified: job.posting_verified_at,
        instructions: job.url
            ? `Visit ${job.url} and check if the posting is still active. Then call verify_posting again with status='live' or status='dead'.`
            : 'No URL on file. Ask the user for the job posting URL or search for it.',
    };
}
async function generateOutreach(params) {
    const userId = requireAuth();
    const profile = await getProfile();
    const { data: job } = await supabase
        .from('v2_jobs')
        .select('*')
        .eq('id', params.job_id)
        .eq('user_id', userId)
        .single();
    if (!job)
        throw new Error('Job not found');
    const { data: contact } = await supabase
        .from('v2_contacts')
        .select('*')
        .eq('id', params.contact_id)
        .eq('user_id', userId)
        .single();
    if (!contact)
        throw new Error('Contact not found');
    const tone = params.tone || 'professional';
    return {
        context: {
            user_name: profile.full_name,
            user_summary: profile.resume_text?.substring(0, 500),
            job_title: job.title,
            company: job.company,
            contact_name: contact.name,
            contact_title: contact.title,
            contact_relationship: contact.relationship_type,
            contact_email: contact.email,
        },
        instructions: `Write a personalized ${tone} outreach message from ${profile.full_name} to ${contact.name} (${contact.title} at ${job.company}) about the ${job.title} role.

Key points to include:
- Reference ${contact.name}'s role as ${contact.title}
- Connect user's background (${profile.resume_text?.substring(0, 200)}) to the ${job.title} role
- ${contact.relationship_type === 'hiring_manager' ? 'Address as the hiring decision maker' :
            contact.relationship_type === 'recruiter' ? 'Reference the open role and express interest' :
                contact.relationship_type === 'mutual_connection' ? 'Mention the mutual connection' :
                    'Be professional and concise'}
- Keep it under 150 words
- End with a specific ask (15-min call, coffee chat, or referral)`,
        tone,
        subject_line_suggestions: [
            `Re: ${job.title} at ${job.company}`,
            `${profile.full_name} - ${job.title} Interest`,
            `Quick question about ${job.company}`,
        ],
        next_steps: [
            'Customize this template with specific details',
            'Call create_gmail_draft() to save as a Gmail draft',
            'Or call log_outreach() after manually sending',
        ],
    };
}
async function generateCoverLetter(params) {
    const userId = requireAuth();
    const profile = await getProfile();
    const { data: job } = await supabase
        .from('v2_jobs')
        .select('*')
        .eq('id', params.job_id)
        .eq('user_id', userId)
        .single();
    if (!job)
        throw new Error('Job not found');
    const style = params.style || 'executive';
    const jd = job.job_description || job.description || job.notes || '';
    const resumeText = profile.resume_text || '';
    // Build the cover letter generation context
    const context = {
        user_name: profile.full_name,
        user_summary: resumeText.substring(0, 1000),
        job_title: job.title,
        company: job.company,
        job_description: jd.substring(0, 2000),
        salary_range: job.salary_min && job.salary_max
            ? `$${(job.salary_min / 1000).toFixed(0)}K-$${(job.salary_max / 1000).toFixed(0)}K`
            : null,
        location: job.location,
        match_score: job.match_score || job.fit_score,
        resume_variant: job.resume_variant,
    };
    return {
        context,
        instructions: `Write a ${style} cover letter from ${profile.full_name} for the ${job.title} role at ${job.company}.

Resume/Background:
${resumeText.substring(0, 800)}

Job Description:
${jd.substring(0, 1500) || 'Not available - use role title and company context.'}

Guidelines:
- Style: ${style === 'executive' ? 'Confident, strategic, emphasize leadership and P&L impact' : style === 'formal' ? 'Traditional business letter format, professional tone' : 'Personable, story-driven, still professional'}
- Open with a compelling hook about why this role specifically
- Connect 2-3 specific experiences from the resume to the job requirements
- Quantify achievements where possible (team sizes, revenue impact, transaction volumes)
- ${job.resume_variant ? `Emphasize ${job.resume_variant} experience` : 'Emphasize the strongest alignment'}
- Close with enthusiasm and a clear call to action
- Keep it under 400 words
- Do NOT include address blocks or date - just the body text`,
        style,
        save_instructions: `After generating the cover letter, save it by calling update_job_status with job_id="${job.id}" and include the cover_letter field. Or the AI can directly update v2_jobs.cover_letter.`,
        next_steps: [
            'Generate the cover letter based on the context and instructions above',
            `Save to database: UPDATE v2_jobs SET cover_letter = '<generated text>' WHERE id = '${job.id}'`,
            'The cover letter will appear in the UI automatically',
        ],
    };
}
async function createGmailDraft(params) {
    const userId = requireAuth();
    // Log in v2_outreach
    const { data: outreach, error } = await supabase
        .from('v2_outreach')
        .insert({
        user_id: userId,
        job_id: params.job_id || null,
        contact_id: params.contact_id || null,
        channel: 'email',
        message_text: params.body,
        subject_line: params.subject,
        sent_at: null, // Not sent yet, just drafted
    })
        .select()
        .single();
    if (error)
        throw new Error(`Error creating outreach record: ${error.message}`);
    // Update the job's outreach_draft if job_id provided
    if (params.job_id) {
        await supabase
            .from('v2_jobs')
            .update({ outreach_draft: params.body })
            .eq('id', params.job_id)
            .eq('user_id', userId);
    }
    return {
        outreach_id: outreach.id,
        status: 'draft_logged',
        gmail_instructions: `Use Gmail MCP tools to create a draft email:
- To: ${params.to}
- Subject: ${params.subject}
- Body: ${params.body}

After creating the Gmail draft, call this tool again or update the outreach record with the gmail_draft_id.`,
        draft_details: {
            to: params.to,
            subject: params.subject,
            body: params.body,
            job_id: params.job_id,
            contact_id: params.contact_id,
        },
    };
}
async function checkEmailResponses(params) {
    const userId = requireAuth();
    const daysBack = params.days_back || 14;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const { data: outreach, error } = await supabase
        .from('v2_outreach')
        .select(`
      *,
      v2_jobs (id, title, company),
      v2_contacts (id, name, email, title, company)
    `)
        .eq('user_id', userId)
        .eq('response_received', false)
        .not('sent_at', 'is', null)
        .gte('sent_at', cutoff.toISOString())
        .order('sent_at', { ascending: false });
    if (error)
        throw new Error(`Error checking responses: ${error.message}`);
    const pending = (outreach || []).map((o) => {
        const daysSince = Math.floor((Date.now() - new Date(o.sent_at).getTime()) / (1000 * 60 * 60 * 24));
        return {
            outreach_id: o.id,
            contact_name: o.v2_contacts?.name,
            contact_email: o.v2_contacts?.email,
            company: o.v2_jobs?.company || o.v2_contacts?.company,
            job_title: o.v2_jobs?.title,
            channel: o.channel,
            subject_line: o.subject_line,
            sent_at: o.sent_at,
            days_since_sent: daysSince,
            gmail_message_id: o.gmail_message_id,
            is_overdue: daysSince > (o.business_days_window || 3),
        };
    });
    // Collect contact emails for SENT folder scanning
    const contactEmails = new Set();
    for (const p of pending) {
        if (p.contact_email)
            contactEmails.add(p.contact_email);
    }
    // Also get all known contacts with email addresses for SENT scanning
    const { data: allContacts } = await supabase
        .from('v2_contacts')
        .select('id, name, email, company, linkedin_url')
        .eq('user_id', userId)
        .not('email', 'is', null);
    const contacts_to_scan = (allContacts || [])
        .filter((c) => c.email)
        .map((c) => ({
        contact_id: c.id,
        name: c.name,
        email: c.email,
        company: c.company,
    }));
    // === Auto-close hot signals where the recommended action was already taken ===
    let auto_actioned_signals = 0;
    const auto_actioned_signal_ids = [];
    try {
        // Fetch open hot signals
        const { data: openSignals } = await supabase
            .from('v2_hot_signals')
            .select('*')
            .eq('user_id', userId)
            .in('status', ['new', 'user_acknowledged'])
            .order('created_at', { ascending: false });
        if (openSignals && openSignals.length > 0) {
            // Fetch ALL recent outreach (including responded-to) for cross-referencing
            const { data: recentOutreach } = await supabase
                .from('v2_outreach')
                .select(`
          *,
          v2_contacts (id, name, email, linkedin_url)
        `)
                .eq('user_id', userId)
                .not('sent_at', 'is', null)
                .gte('sent_at', cutoff.toISOString())
                .order('sent_at', { ascending: false });
            const sentOutreach = recentOutreach || [];
            // Build lookup sets for fast matching
            const outreachedContactIds = new Set(sentOutreach.map((o) => o.contact_id).filter(Boolean));
            const outreachedEmails = new Set(sentOutreach
                .map((o) => o.v2_contacts?.email?.toLowerCase())
                .filter(Boolean));
            const outreachedLinkedInUrls = new Set(sentOutreach
                .map((o) => o.v2_contacts?.linkedin_url?.toLowerCase()?.replace(/\/$/, ''))
                .filter(Boolean));
            for (const signal of openSignals) {
                const payload = signal.recommended_action_payload || {};
                const actionType = signal.recommended_action_type || '';
                let matched = false;
                // Match by related_contact_id — if we sent outreach to the same contact
                if (signal.related_contact_id && outreachedContactIds.has(signal.related_contact_id)) {
                    matched = true;
                }
                // Match by email recipient in payload
                if (!matched && actionType === 'send_email' && payload.to) {
                    if (outreachedEmails.has(payload.to.toLowerCase())) {
                        matched = true;
                    }
                }
                // Match by LinkedIn recipient URL in payload
                if (!matched &&
                    (actionType === 'send_linkedin_dm' || actionType === 'send_linkedin_inmail') &&
                    payload.recipient_url) {
                    const normalizedUrl = payload.recipient_url.toLowerCase().replace(/\/$/, '');
                    if (outreachedLinkedInUrls.has(normalizedUrl)) {
                        matched = true;
                    }
                }
                // For LinkedIn accept/DM/InMail signal types, also match if we've
                // outreached the related contact via any channel
                if (!matched &&
                    signal.related_contact_id &&
                    signal.signal_type.startsWith('linkedin')) {
                    // Check if there's any outreach to this contact's LinkedIn URL
                    const contact = (allContacts || []).find((c) => c.id === signal.related_contact_id);
                    if (contact?.linkedin_url) {
                        const contactLinkedIn = contact.linkedin_url.toLowerCase().replace(/\/$/, '');
                        // Check for LinkedIn outreach channels specifically
                        const linkedInOutreach = sentOutreach.find((o) => (o.channel === 'linkedin_dm' ||
                            o.channel === 'linkedin_inmail' ||
                            o.channel === 'linkedin_connection_note') &&
                            o.v2_contacts?.linkedin_url?.toLowerCase()?.replace(/\/$/, '') === contactLinkedIn);
                        if (linkedInOutreach)
                            matched = true;
                    }
                }
                if (matched) {
                    await supabase
                        .from('v2_hot_signals')
                        .update({
                        status: 'actioned',
                        actioned_at: new Date().toISOString(),
                    })
                        .eq('id', signal.id)
                        .eq('user_id', userId);
                    auto_actioned_signals++;
                    auto_actioned_signal_ids.push(signal.id);
                }
            }
        }
    }
    catch (signalErr) {
        // Non-fatal — don't fail the whole check_email_responses if signal
        // auto-close has an issue
        console.error('Auto-close signals error:', signalErr?.message || signalErr);
    }
    return {
        pending_responses: pending,
        total: pending.length,
        overdue: pending.filter((p) => p.is_overdue).length,
        contacts_to_scan,
        auto_actioned_signals,
        auto_actioned_signal_ids,
        instructions: `Check Gmail for replies to these ${pending.length} outreach messages. For each:
1. Search Gmail INBOX for threads with these contacts
2. Search Gmail SENT folder for emails to contacts_to_scan addresses (detect manual outreach by Micah)
3. Search Gmail ALL MAIL/ARCHIVED for missed replies
4. If reply found: call mark_outreach_response() with the outcome
5. If positive reply: outcome='positive' or outcome='interview_scheduled'
6. If rejection email detected: outcome='negative', then IMMEDIATELY run the rejection cascade:
   a. call mark_outreach_response(outreach_id, response_text, 'negative')
   b. call update_job_status(job_id, 'rejected', notes='Rejection email received')
   c. The cascade auto-completes: all pending follow-ups for that job are marked 'done', and any hot signals linked to that job are dismissed.
   Do NOT wait for the user to confirm rejections. The cascade is automatic.
7. If sent email to known contact not yet tracked: call log_outreach() to create the record
8. If no reply and overdue: the follow-up system will handle it
Note: ${auto_actioned_signals} hot signal(s) were auto-actioned because their recommended action was already taken.`,
    };
}
async function bulkImportJobs(params) {
    const userId = requireAuth();
    const results = {
        imported: 0,
        skipped: 0,
        errors: [],
        jobs: [],
    };
    for (const job of params.jobs) {
        // Reject blacklisted sources (Lever, Built In)
        if (job.url && isBlacklistedJobUrl(job.url)) {
            results.skipped++;
            results.errors.push(`${job.company} - ${job.title}: URL from blacklisted source (Lever or Built In). Use LinkedIn, Indeed, Greenhouse, Workday, or the company careers page.`);
            continue;
        }
        // Check for duplicates by URL
        if (job.url) {
            const { data: existing } = await supabase
                .from('v2_jobs')
                .select('id')
                .eq('user_id', userId)
                .eq('url', job.url)
                .limit(1);
            if (existing && existing.length > 0) {
                results.skipped++;
                continue;
            }
        }
        const { data, error } = await supabase
            .from('v2_jobs')
            .insert({
            user_id: userId,
            title: job.title,
            company: job.company,
            url: job.url,
            salary_min: job.salary_min,
            salary_max: job.salary_max,
            location: job.location,
            remote: job.remote || false,
            fit_score: job.fit_score,
            match_score: job.fit_score,
            source: job.source || 'other',
            notes: job.notes,
            status: 'new',
            posting_status: 'live',
        })
            .select()
            .single();
        if (error) {
            results.errors.push(`${job.company} - ${job.title}: ${error.message}`);
        }
        else if (data) {
            results.imported++;
            results.jobs.push({ id: data.id, title: data.title, company: data.company, fit_score: data.fit_score });
            // Auto-score if no fit_score provided
            if (!job.fit_score) {
                try {
                    const score = await scoreJob({ ...job, job_id: data.id });
                    results.jobs[results.jobs.length - 1].fit_score = score.fit_score;
                }
                catch (e) {
                    // Score failure is non-fatal
                }
            }
        }
    }
    return {
        summary: `Imported ${results.imported} jobs, skipped ${results.skipped} duplicates, ${results.errors.length} errors.`,
        ...results,
        next_steps: results.imported > 0
            ? ['Review imported jobs with get_jobs()', 'Score unscored jobs with score_job()', 'Generate outreach for 70%+ matches']
            : ['No new jobs imported. Try different search criteria.'],
    };
}
async function fetchJd(jobId) {
    const userId = requireAuth();
    const { data: job } = await supabase
        .from('v2_jobs')
        .select('*')
        .eq('id', jobId)
        .eq('user_id', userId)
        .single();
    if (!job)
        throw new Error('Job not found');
    if (!job.url)
        throw new Error('Job has no URL to fetch from');
    if (isBlacklistedJobUrl(job.url)) {
        return {
            job_id: jobId,
            success: false,
            source: 'blocked',
            error: `Cannot fetch JD: ${new URL(job.url).hostname} is a blocked source. ` +
                'Only LinkedIn, Indeed, Greenhouse, Workday, and direct company career pages are accepted. ' +
                'Find this role on an approved platform and re-add it.',
        };
    }
    const result = await fetchJobDescription(job.url);
    if (!result.text) {
        return {
            job_id: jobId,
            success: false,
            source: result.source,
            error: result.error || 'Could not extract job description',
            hint: result.source === 'linkedin' || result.source === 'indeed'
                ? 'This job board blocks automated fetching. Copy the JD text and paste it manually via update_job_status or PATCH /api/jobs/:id.'
                : 'Try checking the URL is still active. You can also paste the JD manually.',
        };
    }
    // Store JD
    await supabase
        .from('v2_jobs')
        .update({ job_description: result.text })
        .eq('id', jobId)
        .eq('user_id', userId);
    // Auto-generate template cover letter if resume exists
    let coverLetterGenerated = false;
    if (!job.cover_letter) {
        try {
            const profile = await getProfile();
            if (profile.resume_text) {
                const cl = generateCoverLetterText({ full_name: profile.full_name, resume_text: profile.resume_text }, { title: job.title, company: job.company, job_description: result.text, location: job.location, fit_score: job.fit_score });
                await supabase
                    .from('v2_jobs')
                    .update({ cover_letter: cl })
                    .eq('id', jobId)
                    .eq('user_id', userId);
                coverLetterGenerated = true;
            }
        }
        catch {
            // Non-fatal — template cover letter is a nice-to-have
        }
    }
    return {
        job_id: jobId,
        success: true,
        source: result.source,
        jd_length: result.text.length,
        jd_preview: result.text.substring(0, 300) + '...',
        cover_letter_generated: coverLetterGenerated,
        next_step: coverLetterGenerated
            ? 'JD fetched and template cover letter generated. Use generate_cover_letter() for an AI-quality letter instead.'
            : 'JD stored. Call generate_cover_letter() to create a tailored cover letter.',
    };
}
async function batchProcessJobs(params) {
    const userId = requireAuth();
    const minScore = params.min_fit_score ?? 70;
    const doFetchJds = params.fetch_jds !== false;
    const doGenCls = params.generate_cover_letters !== false;
    const results = {
        jds_fetched: 0,
        jds_failed: 0,
        cover_letters_generated: 0,
        details: [],
    };
    const profile = await getProfile();
    if (doFetchJds) {
        const { data: jobs } = await supabase
            .from('v2_jobs')
            .select('id, title, company, url, cover_letter, location, fit_score')
            .eq('user_id', userId)
            .gte('fit_score', minScore)
            .is('job_description', null)
            .not('url', 'is', null);
        for (const job of jobs || []) {
            try {
                const jdResult = await fetchJobDescription(job.url);
                if (jdResult.text) {
                    const updates = { job_description: jdResult.text };
                    if (doGenCls && !job.cover_letter && profile.resume_text) {
                        updates.cover_letter = generateCoverLetterText({ full_name: profile.full_name, resume_text: profile.resume_text }, { title: job.title, company: job.company, job_description: jdResult.text, location: job.location, fit_score: job.fit_score });
                        results.cover_letters_generated++;
                    }
                    await supabase.from('v2_jobs').update(updates).eq('id', job.id).eq('user_id', userId);
                    results.jds_fetched++;
                    results.details.push({ job_id: job.id, company: job.company, status: 'jd_fetched' });
                }
                else {
                    results.jds_failed++;
                    results.details.push({ job_id: job.id, company: job.company, status: 'jd_failed', error: jdResult.error });
                }
                await new Promise(r => setTimeout(r, 600)); // Rate limit
            }
            catch (err) {
                results.jds_failed++;
                results.details.push({ job_id: job.id, company: job.company, status: 'error', error: err.message });
            }
        }
    }
    // Generate cover letters for jobs that already have JDs but no cover letter
    if (doGenCls && profile.resume_text) {
        const { data: clJobs } = await supabase
            .from('v2_jobs')
            .select('id, title, company, job_description, location, fit_score')
            .eq('user_id', userId)
            .gte('fit_score', minScore)
            .not('job_description', 'is', null)
            .is('cover_letter', null);
        for (const job of clJobs || []) {
            try {
                const cl = generateCoverLetterText({ full_name: profile.full_name, resume_text: profile.resume_text }, { title: job.title, company: job.company, job_description: job.job_description, location: job.location, fit_score: job.fit_score });
                await supabase.from('v2_jobs').update({ cover_letter: cl }).eq('id', job.id).eq('user_id', userId);
                results.cover_letters_generated++;
            }
            catch {
                // Non-fatal
            }
        }
    }
    return {
        ...results,
        summary: `Processed: ${results.jds_fetched} JDs fetched, ${results.jds_failed} failed, ${results.cover_letters_generated} cover letters generated.`,
        next_steps: results.jds_fetched > 0 || results.cover_letters_generated > 0
            ? ['Run get_jobs() to see updated jobs', 'Use generate_cover_letter() for AI-quality letters on your top picks']
            : ['All qualifying jobs already have JDs and cover letters, or none met the score threshold.'],
    };
}
// ============================================
// Hot Signals
// ============================================
async function createHotSignal(params) {
    const userId = requireAuth();
    const { data, error } = await supabase
        .from('v2_hot_signals')
        .insert({
        user_id: userId,
        signal_type: params.signal_type,
        severity: params.severity || 'hot',
        summary: params.summary,
        ai_recommendation: params.ai_recommendation,
        recommended_action_type: params.recommended_action_type,
        recommended_action_payload: params.recommended_action_payload,
        related_job_id: params.related_job_id || null,
        related_contact_id: params.related_contact_id || null,
        source_email_id: params.source_email_id,
        source_url: params.source_url,
        status: 'new',
    })
        .select()
        .single();
    if (error)
        throw new Error(`Error creating hot signal: ${error.message}`);
    return data;
}
async function getHotSignals(status) {
    const userId = requireAuth();
    const effectiveStatus = status || 'new';
    const { data, error } = await supabase
        .from('v2_hot_signals')
        .select('*')
        .eq('user_id', userId)
        .eq('status', effectiveStatus)
        .order('created_at', { ascending: false });
    if (error)
        throw new Error(`Error fetching hot signals: ${error.message}`);
    return data || [];
}
async function acknowledgeHotSignal(id) {
    const userId = requireAuth();
    const { data, error } = await supabase
        .from('v2_hot_signals')
        .update({ status: 'user_acknowledged', acknowledged_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();
    if (error)
        throw new Error(`Error acknowledging hot signal: ${error.message}`);
    if (!data)
        throw new Error('Hot signal not found');
    return data;
}
async function actionHotSignal(id) {
    const userId = requireAuth();
    const { data, error } = await supabase
        .from('v2_hot_signals')
        .update({ status: 'actioned', actioned_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();
    if (error)
        throw new Error(`Error actioning hot signal: ${error.message}`);
    if (!data)
        throw new Error('Hot signal not found');
    return data;
}
async function dismissHotSignal(id) {
    const userId = requireAuth();
    const { data, error } = await supabase
        .from('v2_hot_signals')
        .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();
    if (error)
        throw new Error(`Error dismissing hot signal: ${error.message}`);
    if (!data)
        throw new Error('Hot signal not found');
    return data;
}
// ============================================
// Onboarding write tools — helpers, propagation, handlers
// (proposal §3.3, §5 — synchronous in-request propagation, no workers)
// ============================================
// Fields on the preferences JSONB that trigger the propagation cycle when
// changed. full_name and resume_text are tracked separately at the top level
// but also count as propagation triggers.
const PREF_FIELDS_THAT_TRIGGER_PROPAGATION = new Set([
    'resume_text',
    'full_name',
    'role_types',
    'salary_floor',
    'locations',
    'remote_ok',
    'industries',
    'target_companies',
    'job_tracks',
]);
// Battle-plan invalidation trigger fields. When the user changes which
// companies or tracks they care about, the most recent battle plan is stale
// and should be regenerated on the next get_battle_plan() call (proposal §5.2).
const PREF_FIELDS_THAT_INVALIDATE_BATTLE_PLAN = new Set([
    'target_companies',
    'job_tracks',
]);
// Shallow-for-scalars, merge-for-objects. We do NOT merge arrays — array
// fields on UserPreferences (role_types, locations, industries,
// target_companies, job_tracks) are "replace semantics": passing
// {role_types: ['VP Eng']} replaces the full array, it doesn't append. This
// matches the PATCH /api/users/profile shallow-overwrite behavior for array
// fields while still letting partial set_preferences({salary_floor: 180000})
// calls leave the other preferences untouched.
function deepMergePreferences(existing, patch) {
    const merged = { ...(existing || {}) };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined)
            continue;
        merged[key] = value;
    }
    return merged;
}
// Append a row to v2_profile_changes. Returns the inserted row id so the
// caller can update the propagation_completed_at / propagation_error columns
// once the propagation cycle finishes.
async function writeProfileChangeAudit(userId, fieldName, oldValue, newValue, sourceTool, triggeredPropagation) {
    const { data, error } = await supabase
        .from('v2_profile_changes')
        .insert({
        user_id: userId,
        field_name: fieldName,
        old_value: oldValue === undefined ? null : oldValue,
        new_value: newValue === undefined ? null : newValue,
        source_tool: sourceTool,
        triggered_propagation: triggeredPropagation,
    })
        .select('id')
        .single();
    if (error) {
        // Audit write failure is logged but does not fail the calling tool —
        // the primary write to v2_users is still the important operation.
        console.error(`[v2_profile_changes] audit write failed: ${error.message}`);
        return null;
    }
    return data.id;
}
/**
 * Synchronous propagation cycle.
 *
 * Runs INSIDE the same MCP request that caused the profile change. Blocks
 * the calling tool for ~200-500ms on a typical small pipeline. There is no
 * background worker, no setTimeout debouncer, no cron.
 *
 * Decision per proposal §5.1: the original design mentioned a 60-second
 * in-memory debouncer, but a setTimeout-based debouncer inside a stdio MCP
 * server process that only runs while the user's AI is actively using it
 * is unreliable — the timer may never fire if the process exits first.
 * We accept the tradeoff that 4-6 rapid set_preferences calls during
 * onboarding do 4-6 small re-scoring cycles back-to-back, and run
 * propagation synchronously inline on every set_* call.
 *
 * Behavior:
 *  1. If changedFields contains any score-affecting field, re-score all
 *     v2_jobs in status 'new'/'researching'/'applied' against the current
 *     preferences and write back fit_score + preferences_version_at_score.
 *  2. If changedFields contains resume_text, also NULL out v2_jobs.cover_letter
 *     for unsent jobs — marks cover letters stale for lazy regen on next read.
 *  3. If changedFields contains target_companies or job_tracks, delete today's
 *     v2_battle_plans row so the next get_battle_plan call generates a fresh
 *     one (proposal §5.2 — we don't eagerly regen here).
 *  4. On success, stamp propagation_completed_at on the audit row.
 *  5. On any error, stamp propagation_error on the audit row but do NOT
 *     rethrow — propagation is best-effort; the primary write already
 *     succeeded and the safety net at read time (§5.4) will catch stragglers.
 */
async function runPropagationCycle(userId, changedFields, sourceTool, auditLogId) {
    try {
        const shouldRescore = Array.from(changedFields).some(f => PREF_FIELDS_THAT_TRIGGER_PROPAGATION.has(f));
        const shouldInvalidateBattlePlan = Array.from(changedFields).some(f => PREF_FIELDS_THAT_INVALIDATE_BATTLE_PLAN.has(f));
        const shouldInvalidateCoverLetters = changedFields.has('resume_text');
        // 1. Re-score the pipeline.
        if (shouldRescore) {
            // Fetch fresh profile (we just wrote to v2_users so preferences_version
            // is already bumped — we want the NEW version for the snapshot).
            const { data: userRow, error: userErr } = await supabase
                .from('v2_users')
                .select('*')
                .eq('id', userId)
                .single();
            if (userErr || !userRow) {
                throw new Error(`propagation: failed to reload user: ${userErr?.message || 'not found'}`);
            }
            const freshProfile = userRow;
            const freshPrefs = freshProfile.preferences || {};
            const freshVersion = freshProfile.preferences_version ?? 0;
            const { data: jobs, error: jobsErr } = await supabase
                .from('v2_jobs')
                .select('id, title, salary_min, salary_max, location, remote, description')
                .eq('user_id', userId)
                .in('status', ['new', 'researching', 'applied']);
            if (jobsErr) {
                throw new Error(`propagation: failed to fetch jobs: ${jobsErr.message}`);
            }
            const jobRows = (jobs || []);
            // Re-score each job in JS, then issue one UPDATE per job. Bounded
            // work — Core Line users typically have <200 jobs in the pipeline, so
            // this is ~200 UPDATE calls on the worst case (few hundred ms via
            // supabase-js). A true bulk-update would need raw SQL; Supabase
            // client doesn't expose a bulk-update-with-per-row-values primitive.
            for (const job of jobRows) {
                const scored = computeFitScoreFromPrefs({
                    title: job.title,
                    salary_min: job.salary_min,
                    salary_max: job.salary_max,
                    location: job.location,
                    remote: job.remote,
                    description: job.description,
                }, freshPrefs);
                await supabase
                    .from('v2_jobs')
                    .update({
                    fit_score: scored.fit_score,
                    match_score: scored.fit_score,
                    preferences_version_at_score: freshVersion,
                })
                    .eq('id', job.id)
                    .eq('user_id', userId);
            }
        }
        // 2. Invalidate stale cover letters on resume_text change.
        if (shouldInvalidateCoverLetters) {
            await supabase
                .from('v2_jobs')
                .update({ cover_letter: null })
                .eq('user_id', userId)
                .in('status', ['new', 'researching', 'applied']);
        }
        // 3. Invalidate today's battle plan on target_companies / job_tracks change.
        // The next get_battle_plan call will regenerate from scratch.
        if (shouldInvalidateBattlePlan) {
            const today = new Date().toISOString().split('T')[0];
            await supabase
                .from('v2_battle_plans')
                .delete()
                .eq('user_id', userId)
                .eq('plan_date', today);
        }
        // 4. Mark the audit row as completed.
        if (auditLogId) {
            await supabase
                .from('v2_profile_changes')
                .update({ propagation_completed_at: new Date().toISOString() })
                .eq('id', auditLogId);
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.error(`[runPropagationCycle] ${sourceTool} failed for user ${userId}: ${message}`);
        // Best-effort audit update. Swallow errors from the audit update itself.
        if (auditLogId) {
            await supabase
                .from('v2_profile_changes')
                .update({ propagation_error: message })
                .eq('id', auditLogId)
                .then(() => undefined, () => undefined);
        }
        // Do NOT rethrow — propagation is best-effort.
    }
}
// --- Tool handlers -----------------------------------------------------------
async function setProfile(params) {
    const userId = requireAuth();
    const current = await getProfile();
    const currentPrefs = current.preferences || {};
    const changedFields = new Set();
    const updates = {};
    // Top-level full_name
    if (params.full_name !== undefined && params.full_name !== current.full_name) {
        updates.full_name = params.full_name;
        await writeProfileChangeAudit(userId, 'full_name', current.full_name, params.full_name, 'set_profile', true);
        changedFields.add('full_name');
    }
    // Preference subfields: current_title, city, state, years_experience
    const prefPatch = {};
    const prefSubfields = [
        'current_title',
        'city',
        'state',
        'years_experience',
    ];
    for (const field of prefSubfields) {
        const value = params[field];
        if (value !== undefined) {
            const existing = currentPrefs[field];
            if (value !== existing) {
                prefPatch[field] = value;
                await writeProfileChangeAudit(userId, `preferences.${field}`, existing ?? null, value, 'set_profile', true);
                changedFields.add(field);
            }
        }
    }
    if (Object.keys(prefPatch).length > 0) {
        updates.preferences = deepMergePreferences(currentPrefs, prefPatch);
    }
    if (changedFields.size === 0) {
        return {
            ok: true,
            changed: false,
            message: 'No changes detected — profile already matches the provided values.',
        };
    }
    // Bump preferences_version monotonically.
    updates.preferences_version = (current.preferences_version ?? 0) + 1;
    updates.updated_at = new Date().toISOString();
    const { error } = await supabase
        .from('v2_users')
        .update(updates)
        .eq('id', userId);
    if (error) {
        throw new Error(`set_profile: failed to write user: ${error.message}`);
    }
    // Run propagation synchronously inline.
    // (full_name counts as a propagation trigger per proposal §4 — affects
    // outreach sign-off. current_title/city/state/years_experience do not
    // affect scoring today but we still run the cycle for consistency; it
    // is a cheap no-op re-score against unchanged preferences.)
    const auditLogId = null; // Per-field audit rows above; no single row to stamp.
    await runPropagationCycle(userId, changedFields, 'set_profile', auditLogId);
    return {
        ok: true,
        changed: true,
        changed_fields: Array.from(changedFields),
        preferences_version: updates.preferences_version,
        message: 'Profile updated. Pipeline re-scored against current preferences.',
    };
}
async function setResumeText(params) {
    const userId = requireAuth();
    if (!params.resume_text || typeof params.resume_text !== 'string' || params.resume_text.trim().length === 0) {
        throw new Error('set_resume_text: resume_text is required and must be a non-empty string.');
    }
    const current = await getProfile();
    const oldLen = (current.resume_text || '').length;
    const newLen = params.resume_text.length;
    const auditId = await writeProfileChangeAudit(userId, 'resume_text', 
    // Store length snapshot instead of full text to keep audit table compact —
    // the full text is on v2_users already, this is just a change marker.
    { length: oldLen }, { length: newLen }, 'set_resume_text', true);
    const updates = {
        resume_text: params.resume_text,
        preferences_version: (current.preferences_version ?? 0) + 1,
        updated_at: new Date().toISOString(),
    };
    // Trial timer — proposal §8 Q4.
    // First call: start the clock. Subsequent calls: leave it alone.
    let trialJustStarted = false;
    if (current.trial_started_at === null) {
        const now = new Date();
        const days = current.trial_length_days ?? 7;
        const endsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        updates.trial_started_at = now.toISOString();
        updates.trial_ends_at = endsAt.toISOString();
        trialJustStarted = true;
    }
    const { error } = await supabase
        .from('v2_users')
        .update(updates)
        .eq('id', userId);
    if (error) {
        throw new Error(`set_resume_text: failed to write user: ${error.message}`);
    }
    await runPropagationCycle(userId, new Set(['resume_text']), 'set_resume_text', auditId);
    // Load fresh trial dates for the response (so the AI can tell the user
    // exactly when the clock started and when it ends).
    const { data: fresh } = await supabase
        .from('v2_users')
        .select('trial_started_at, trial_ends_at, trial_length_days, preferences_version')
        .eq('id', userId)
        .single();
    const freshRow = (fresh || {});
    let trialMessage;
    if (trialJustStarted) {
        trialMessage = `Your ${freshRow.trial_length_days ?? 7}-day trial just started. It ends ${freshRow.trial_ends_at ?? 'soon'}.`;
    }
    else if (freshRow.trial_ends_at) {
        const msLeft = new Date(freshRow.trial_ends_at).getTime() - Date.now();
        const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
        trialMessage = `Your trial is still running (~${daysLeft} day${daysLeft === 1 ? '' : 's'} left). Resume text updated.`;
    }
    else {
        trialMessage = 'Resume text updated.';
    }
    return {
        ok: true,
        resume_length: newLen,
        trial_started_at: freshRow.trial_started_at,
        trial_ends_at: freshRow.trial_ends_at,
        trial_just_started: trialJustStarted,
        preferences_version: freshRow.preferences_version,
        message: trialMessage,
    };
}
async function setPreferences(params) {
    const userId = requireAuth();
    const current = await getProfile();
    const currentPrefs = current.preferences || {};
    const changedFields = new Set();
    const patch = {};
    // Supported partial-patch fields per proposal §3.3 set_preferences row.
    const supportedFields = [
        'role_types',
        'salary_floor',
        'locations',
        'remote_ok',
        'industries',
        'timezone',
        'auto_send_enabled',
    ];
    for (const field of supportedFields) {
        const value = params[field];
        if (value !== undefined) {
            const existing = currentPrefs[field];
            if (JSON.stringify(existing) !== JSON.stringify(value)) {
                patch[field] = value;
                await writeProfileChangeAudit(userId, `preferences.${field}`, existing ?? null, value, 'set_preferences', PREF_FIELDS_THAT_TRIGGER_PROPAGATION.has(field));
                changedFields.add(field);
            }
        }
    }
    if (changedFields.size === 0) {
        return {
            ok: true,
            changed: false,
            message: 'No changes detected — preferences already match the provided values.',
        };
    }
    const mergedPrefs = deepMergePreferences(currentPrefs, patch);
    const newVersion = (current.preferences_version ?? 0) + 1;
    const { error } = await supabase
        .from('v2_users')
        .update({
        preferences: mergedPrefs,
        preferences_version: newVersion,
        updated_at: new Date().toISOString(),
    })
        .eq('id', userId);
    if (error) {
        throw new Error(`set_preferences: failed to write user: ${error.message}`);
    }
    await runPropagationCycle(userId, changedFields, 'set_preferences', null);
    return {
        ok: true,
        changed: true,
        changed_fields: Array.from(changedFields),
        preferences: mergedPrefs,
        preferences_version: newVersion,
        message: 'Preferences updated. Pipeline re-scored against new preferences.',
    };
}
async function setTargetCompanies(params) {
    const userId = requireAuth();
    if (!Array.isArray(params.target_companies)) {
        throw new Error('set_target_companies: target_companies must be an array of strings.');
    }
    for (const c of params.target_companies) {
        if (typeof c !== 'string') {
            throw new Error('set_target_companies: every entry in target_companies must be a string.');
        }
    }
    const current = await getProfile();
    const currentPrefs = current.preferences || {};
    const oldValue = currentPrefs.target_companies || [];
    if (JSON.stringify(oldValue) === JSON.stringify(params.target_companies)) {
        return {
            ok: true,
            changed: false,
            target_companies: oldValue,
            message: 'No changes detected — target_companies already match the provided list.',
        };
    }
    const auditId = await writeProfileChangeAudit(userId, 'preferences.target_companies', oldValue, params.target_companies, 'set_target_companies', true);
    const mergedPrefs = deepMergePreferences(currentPrefs, {
        target_companies: params.target_companies,
    });
    const newVersion = (current.preferences_version ?? 0) + 1;
    const { error } = await supabase
        .from('v2_users')
        .update({
        preferences: mergedPrefs,
        preferences_version: newVersion,
        updated_at: new Date().toISOString(),
    })
        .eq('id', userId);
    if (error) {
        throw new Error(`set_target_companies: failed to write user: ${error.message}`);
    }
    await runPropagationCycle(userId, new Set(['target_companies']), 'set_target_companies', auditId);
    return {
        ok: true,
        changed: true,
        target_companies: params.target_companies,
        preferences_version: newVersion,
        message: 'Target companies updated. Pipeline re-scored and today\'s battle plan invalidated.',
    };
}
async function setJobTracks(params) {
    const userId = requireAuth();
    if (!Array.isArray(params.job_tracks)) {
        throw new Error('set_job_tracks: job_tracks must be an array of track objects.');
    }
    // Validate each track minimally and enforce the "at most one primary" rule.
    let primaryCount = 0;
    for (const track of params.job_tracks) {
        if (!track || typeof track !== 'object') {
            throw new Error('set_job_tracks: every entry in job_tracks must be an object.');
        }
        if (typeof track.name !== 'string' || track.name.length === 0) {
            throw new Error('set_job_tracks: every track must have a non-empty string name.');
        }
        if (!Array.isArray(track.role_types)) {
            throw new Error(`set_job_tracks: track "${track.name}" is missing role_types array.`);
        }
        if (typeof track.is_primary !== 'boolean') {
            throw new Error(`set_job_tracks: track "${track.name}" is missing is_primary boolean.`);
        }
        if (track.is_primary) {
            primaryCount += 1;
        }
    }
    if (primaryCount > 1) {
        throw new Error(`set_job_tracks: only one track may have is_primary:true, got ${primaryCount}.`);
    }
    const current = await getProfile();
    const currentPrefs = current.preferences || {};
    const oldValue = currentPrefs.job_tracks || [];
    if (JSON.stringify(oldValue) === JSON.stringify(params.job_tracks)) {
        return {
            ok: true,
            changed: false,
            job_tracks: oldValue,
            message: 'No changes detected — job_tracks already match the provided list.',
        };
    }
    const auditId = await writeProfileChangeAudit(userId, 'preferences.job_tracks', oldValue, params.job_tracks, 'set_job_tracks', true);
    const mergedPrefs = deepMergePreferences(currentPrefs, {
        job_tracks: params.job_tracks,
    });
    const newVersion = (current.preferences_version ?? 0) + 1;
    const { error } = await supabase
        .from('v2_users')
        .update({
        preferences: mergedPrefs,
        preferences_version: newVersion,
        updated_at: new Date().toISOString(),
    })
        .eq('id', userId);
    if (error) {
        throw new Error(`set_job_tracks: failed to write user: ${error.message}`);
    }
    await runPropagationCycle(userId, new Set(['job_tracks']), 'set_job_tracks', auditId);
    return {
        ok: true,
        changed: true,
        job_tracks: params.job_tracks,
        primary_track: params.job_tracks.find((t) => t.is_primary)?.name ?? null,
        preferences_version: newVersion,
        message: 'Job tracks updated. Pipeline re-scored and today\'s battle plan invalidated.',
    };
}
async function completeOnboarding() {
    const userId = requireAuth();
    const current = await getProfile();
    // Idempotent — if already complete, still return a fresh summary.
    if (!current.onboarding_complete) {
        await writeProfileChangeAudit(userId, 'onboarding_complete', false, true, 'complete_onboarding', false // does NOT trigger propagation — no preference-affecting change
        );
        const { error } = await supabase
            .from('v2_users')
            .update({
            onboarding_complete: true,
            updated_at: new Date().toISOString(),
        })
            .eq('id', userId);
        if (error) {
            throw new Error(`complete_onboarding: failed to write user: ${error.message}`);
        }
    }
    // Reload for the summary payload.
    const fresh = await getProfile();
    const prefs = fresh.preferences || {};
    const roleCount = (prefs.role_types || []).length;
    const targetCompanyCount = (prefs.target_companies || []).length;
    const jobTrackCount = (prefs.job_tracks || []).length;
    const primaryTrack = (prefs.job_tracks || []).find((t) => t.is_primary);
    const salaryFloorStr = prefs.salary_floor
        ? `>= $${prefs.salary_floor.toLocaleString()}`
        : 'not set';
    const summary_text = [
        `Onboarding complete for ${fresh.full_name || 'user'}.`,
        `Targeting ${roleCount} role type${roleCount === 1 ? '' : 's'} at salaries ${salaryFloorStr},`,
        `with ${targetCompanyCount} target compan${targetCompanyCount === 1 ? 'y' : 'ies'}`,
        `and ${jobTrackCount} ${jobTrackCount === 1 ? 'track' : 'tracks'}${primaryTrack ? ` (primary: ${primaryTrack.name})` : ''}.`,
        fresh.trial_ends_at ? `Your ${fresh.trial_length_days ?? 7}-day trial ends ${fresh.trial_ends_at.split('T')[0]}.` : '',
    ].filter(Boolean).join(' ');
    return {
        full_name: fresh.full_name,
        onboarding_complete: fresh.onboarding_complete,
        trial_started_at: fresh.trial_started_at,
        trial_ends_at: fresh.trial_ends_at,
        preferences: {
            role_types: prefs.role_types || [],
            salary_floor: prefs.salary_floor ?? null,
            locations: prefs.locations || [],
            industries: prefs.industries || [],
            target_companies: prefs.target_companies || [],
            job_tracks: prefs.job_tracks || [],
        },
        summary_text,
    };
}
// ============================================
// Server Setup
// ============================================
export async function createMCPServer() {
    // PLAYBOOK_TEXT is the single source of truth for the operating playbook.
    // Same string is returned by getSystemInstructions() as the fallback tool
    // and delivered here on the MCP handshake so clients receive it automatically.
    //
    // A hard directive is prepended so the AI always calls get_status() first,
    // guaranteeing deterministic onboarding on every cold start.
    const STARTUP_DIRECTIVE = [
        '*** CRITICAL STARTUP DIRECTIVE ***',
        '',
        'On your FIRST interaction with the user in any new conversation, you MUST call get_status() immediately — before greeting the user, before calling any other tool, before doing anything else.',
        '',
        '- If get_status() returns { status: "action_required", action: "run_onboarding" }, you MUST run the §14 onboarding flow before doing anything else. Do not skip this step. Do not greet the user with the normal welcome. Go directly to onboarding.',
        '- If get_status() returns { status: "ready" }, proceed with the normal §0 First Handshake welcome flow.',
        '',
        'This is non-negotiable. The user experience depends on it.',
        '',
        '*** END STARTUP DIRECTIVE ***',
        '',
    ].join('\n');
    const server = new Server({
        name: 'coreline-v2',
        version: '1.0.0',
    }, {
        capabilities: {
            tools: {},
        },
        instructions: STARTUP_DIRECTIVE + PLAYBOOK_TEXT,
    });
    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools };
    });
    // Call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            let result;
            switch (name) {
                case 'get_status':
                    result = await getStatus();
                    break;
                case 'get_profile':
                    result = await getProfile();
                    break;
                case 'get_battle_plan':
                    result = await getBattlePlan(args?.date);
                    break;
                case 'get_jobs':
                    result = await getJobs(args?.status, args?.limit);
                    break;
                case 'get_contacts':
                    result = await getContacts(args?.job_id);
                    break;
                case 'update_job_status':
                    result = await updateJobStatus(args?.job_id, args?.status, args?.notes);
                    break;
                case 'log_outreach':
                    result = await logOutreach(args?.job_id, args?.contact_id, args?.channel, args?.message_text);
                    break;
                case 'get_followups_due':
                    result = await getFollowupsDue(args?.days_ahead);
                    break;
                case 'add_job':
                    result = await addJob({
                        title: args?.title,
                        company: args?.company,
                        url: args?.url,
                        salary_min: args?.salary_min,
                        salary_max: args?.salary_max,
                        location: args?.location,
                        remote: args?.remote,
                        notes: args?.notes,
                    });
                    break;
                case 'add_contact':
                    result = await addContact({
                        name: args?.name,
                        title: args?.title,
                        company: args?.company,
                        relationship_type: args?.relationship_type,
                        job_id: args?.job_id,
                        linkedin_url: args?.linkedin_url,
                        email: args?.email,
                        notes: args?.notes,
                    });
                    break;
                case 'get_pipeline_summary':
                    result = await getPipelineSummary();
                    break;
                case 'mark_outreach_response':
                    result = await markOutreachResponse(args?.outreach_id, args?.response_text, args?.outcome);
                    break;
                case 'snooze_followup':
                    result = await snoozeFollowup(args?.followup_id, args?.days);
                    break;
                case 'get_system_instructions':
                    result = await getSystemInstructions();
                    break;
                case 'search_jobs':
                    result = await searchJobs({
                        keywords: args?.keywords,
                        location: args?.location,
                        remote_only: args?.remote_only,
                        salary_min: args?.salary_min,
                        freshness_hours: args?.freshness_hours,
                    });
                    break;
                case 'score_job':
                    result = await scoreJob({
                        job_id: args?.job_id,
                        title: args?.title,
                        company: args?.company,
                        salary_min: args?.salary_min,
                        salary_max: args?.salary_max,
                        location: args?.location,
                        remote: args?.remote,
                        description: args?.description,
                    });
                    break;
                case 'verify_posting':
                    result = await verifyPosting({
                        job_id: args?.job_id,
                        url: args?.url,
                        status: args?.status,
                    });
                    break;
                case 'generate_outreach':
                    result = await generateOutreach({
                        job_id: args?.job_id,
                        contact_id: args?.contact_id,
                        tone: args?.tone,
                    });
                    break;
                case 'generate_cover_letter':
                    result = await generateCoverLetter({
                        job_id: args?.job_id,
                        style: args?.style,
                    });
                    break;
                case 'create_gmail_draft':
                    result = await createGmailDraft({
                        to: args?.to,
                        subject: args?.subject,
                        body: args?.body,
                        job_id: args?.job_id,
                        contact_id: args?.contact_id,
                    });
                    break;
                case 'check_email_responses':
                    result = await checkEmailResponses({
                        days_back: args?.days_back,
                    });
                    break;
                case 'bulk_import_jobs':
                    result = await bulkImportJobs({
                        jobs: args?.jobs,
                    });
                    break;
                case 'fetch_jd':
                    result = await fetchJd(args?.job_id);
                    break;
                case 'batch_process_jobs':
                    result = await batchProcessJobs({
                        min_fit_score: args?.min_fit_score,
                        fetch_jds: args?.fetch_jds,
                        generate_cover_letters: args?.generate_cover_letters,
                    });
                    break;
                case 'create_hot_signal':
                    result = await createHotSignal({
                        signal_type: args?.signal_type,
                        severity: args?.severity,
                        summary: args?.summary,
                        ai_recommendation: args?.ai_recommendation,
                        recommended_action_type: args?.recommended_action_type,
                        recommended_action_payload: args?.recommended_action_payload,
                        related_job_id: args?.related_job_id,
                        related_contact_id: args?.related_contact_id,
                        source_email_id: args?.source_email_id,
                        source_url: args?.source_url,
                    });
                    break;
                case 'get_hot_signals':
                    result = await getHotSignals(args?.status);
                    break;
                case 'acknowledge_hot_signal':
                    result = await acknowledgeHotSignal(args?.id);
                    break;
                case 'action_hot_signal':
                    result = await actionHotSignal(args?.id);
                    break;
                case 'dismiss_hot_signal':
                    result = await dismissHotSignal(args?.id);
                    break;
                case 'set_profile':
                    result = await setProfile({
                        full_name: args?.full_name,
                        current_title: args?.current_title,
                        city: args?.city,
                        state: args?.state,
                        years_experience: args?.years_experience,
                    });
                    break;
                case 'set_resume_text':
                    result = await setResumeText({
                        resume_text: args?.resume_text,
                    });
                    break;
                case 'set_preferences':
                    result = await setPreferences({
                        role_types: args?.role_types,
                        salary_floor: args?.salary_floor,
                        locations: args?.locations,
                        remote_ok: args?.remote_ok,
                        industries: args?.industries,
                        timezone: args?.timezone,
                        auto_send_enabled: args?.auto_send_enabled,
                    });
                    break;
                case 'set_target_companies':
                    result = await setTargetCompanies({
                        target_companies: args?.target_companies,
                    });
                    break;
                case 'set_job_tracks':
                    result = await setJobTracks({
                        job_tracks: args?.job_tracks,
                    });
                    break;
                case 'complete_onboarding':
                    result = await completeOnboarding();
                    break;
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ error: message }),
                    },
                ],
                isError: true,
            };
        }
    });
    return server;
}
export async function setAuthFromApiKey(apiKey) {
    const userId = await authenticateApiKey(apiKey);
    if (userId) {
        currentUserId = userId;
        return true;
    }
    return false;
}
export function setUserId(userId) {
    currentUserId = userId;
}
//# sourceMappingURL=server.js.map