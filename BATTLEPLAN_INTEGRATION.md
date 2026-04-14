# Core Line 2.0: Battle Plan Integration Plan

## What I Understand

Core Line 2.0 is infrastructure, not a brain. Users bring their own AI. The AI does the work through 12 MCP tools talking to a Supabase backend. The UI is a dark "war room" dashboard. Friday built the full backend (TypeScript/Express, port 3001), the MCP server, 8 database tables with RLS, and a visual mockup. Nothing is wired together yet.

The battle plan I have been building for Micah IS the prototype of what every Core Line user gets. The workflow we built today (search, score, research, write outreach, create Gmail drafts, monitor for responses, update the plan) IS the Core Line 2.0 product loop. Now we need to move it from a static HTML file into the real platform.

## The Core Loop (What We Proved Works)

```
1. AI searches LinkedIn/Indeed with 24hr freshness filters
2. AI scores each job (0-100) against user resume and preferences
3. 70%+ jobs get automatic deep research + personalized outreach
4. AI finds contact emails, creates Gmail drafts with outreach
5. User reviews battle plan, applies to jobs, sends outreach
6. User tells Core Line "I sent this" or Core Line detects it via email monitoring
7. Core Line logs outreach, starts 3-day follow up timer
8. AI monitors Gmail every 2 hours for responses/rejections
9. Responses update the pipeline: interview scheduled, rejected, positive reply
10. Follow up nudges surface when timers expire: "3 days since you contacted Sarah, here is a draft check-in"
11. Cycle repeats nightly
```

This loop is working TODAY in the battle plan. The question is how to move each piece into Core Line's database, API, and UI.

## What Needs To Change

### The Battle Plan HTML Becomes the War Room UI

The static HTML battle plan maps directly to Core Line's mockup views:

| Battle Plan (today) | Core Line View | Data Source |
|---|---|---|
| Card per company | War Room target cards | v2_jobs + v2_contacts |
| Match score badge | fit_score on job card | v2_jobs.fit_score |
| Resume variant tag | New field or tag on job | v2_jobs (add resume_variant field) |
| Outreach message | Outreach section in card | v2_outreach.message_text |
| Badge (Interviewed, Sent, etc.) | Pipeline stage | v2_jobs.status |
| Contact links + emails | Contact block | v2_contacts |
| Apply button | Action button | v2_jobs.url |
| Copy to clipboard | Draft to Gmail | AI creates draft via MCP |

### Data Migration: Battle Plan to Supabase

Every card in the battle plan becomes rows in Core Line:

**Per Company Card:**
- 1 row in `v2_jobs` (title, company, salary, location, remote, fit_score, url, status)
- 1-3 rows in `v2_contacts` (name, title, company, linkedin_url, email, relationship_type)
- 1-3 rows in `v2_job_contacts` (linking contacts to jobs)
- 1 row in `v2_outreach` per sent message (channel, message_text, sent_at)
- 1 row in `v2_followups` per pending follow up (due_date, priority, status)

**Per Daily Cycle:**
- 1 row in `v2_battle_plans` (plan_date, jobs_found, contacts_identified, plan_data JSON)

### New Fields Needed on Existing Tables

```sql
-- v2_jobs: add these columns
ALTER TABLE v2_jobs ADD COLUMN match_score INT;           -- the 0-100 match percentage
ALTER TABLE v2_jobs ADD COLUMN resume_variant TEXT;        -- which resume to use
ALTER TABLE v2_jobs ADD COLUMN posting_status TEXT DEFAULT 'live';  -- live, dead, expired
ALTER TABLE v2_jobs ADD COLUMN posting_verified_at TIMESTAMPTZ;
ALTER TABLE v2_jobs ADD COLUMN outreach_draft TEXT;        -- pre-written outreach message

-- v2_contacts: add warmth tracking
ALTER TABLE v2_contacts ADD COLUMN warmth_score INT DEFAULT 0;  -- 0=cold, 100=warm
ALTER TABLE v2_contacts ADD COLUMN last_contacted_at TIMESTAMPTZ;
ALTER TABLE v2_contacts ADD COLUMN response_count INT DEFAULT 0;

-- v2_outreach: add gmail tracking
ALTER TABLE v2_outreach ADD COLUMN gmail_draft_id TEXT;    -- links to Gmail draft
ALTER TABLE v2_outreach ADD COLUMN gmail_message_id TEXT;  -- links to sent Gmail
ALTER TABLE v2_outreach ADD COLUMN subject_line TEXT;
```

### New MCP Tools Needed (Beyond the 12)

The current 12 tools cover CRUD. The battle plan workflow needs these additional tools:

```
13. search_jobs          -- trigger LinkedIn/Indeed search via AI
14. score_job            -- run match scoring algorithm against user profile
15. verify_posting       -- check if a job URL is still live
16. generate_outreach    -- write personalized outreach for a job+contact
17. create_gmail_draft   -- create a Gmail draft (via Gmail MCP passthrough)
18. check_email_responses -- scan Gmail for replies to outreach
19. get_overdue_contacts -- contacts past their follow up window
20. bulk_import_jobs     -- import a batch of jobs from nightly search
```

## The Integration Plan (Phased)

### Phase 1: Seed Core Line With Battle Plan Data

Take everything from Micah's battle plan and load it into Supabase. This gives us real data to wire the UI against.

**Steps:**
1. Create Micah's user in v2_users with resume_text and preferences
2. Write a migration script that reads the battle plan HTML and creates:
   - v2_jobs rows for every active card (with fit_score, status, salary, url)
   - v2_contacts rows for every contact we identified
   - v2_job_contacts linking them
   - v2_outreach rows for every message already sent
   - v2_followups for pending follow ups
3. Generate Micah's API key for MCP access
4. Verify data loads correctly via the existing REST API

### Phase 2: Wire the UI to Real Data

Connect the mockup-warroom.html to the Express backend.

**Steps:**
1. Add Supabase Auth (login/signup) to the UI
2. War Room view: fetch from GET /api/jobs + GET /api/battle-plans/today
3. Battle Plan view: fetch from GET /api/battle-plans/today, render prioritized action queue
4. Pipeline view: fetch from GET /api/jobs grouped by status
5. Network view: fetch from GET /api/contacts
6. Follow-ups view: fetch from GET /api/followups with overdue highlighting
7. Each job card expands to show contacts, outreach history, and draft messages
8. Action buttons call the API: "Mark as Applied", "Log Outreach", "Snooze Follow-up"

### Phase 3: Build the Nightly AI Pipeline as an MCP Workflow

Replace the scheduled task prompt with MCP tool calls. The AI (any AI) connects via MCP and runs:

```
1. get_profile()                    -- load user preferences
2. search_jobs()                    -- scan LinkedIn/Indeed (new tool)
3. For each job found:
   a. score_job()                   -- match against profile (new tool)
   b. If score >= 70:
      - verify_posting()            -- confirm still live (new tool)
      - add_job()                   -- save to pipeline
      - add_contact()               -- save key contacts
      - generate_outreach()         -- write personalized message (new tool)
      - create_gmail_draft()        -- load into Gmail (new tool)
4. generate_battle_plan()           -- create morning brief
5. check_email_responses()          -- scan for replies (new tool)
6. get_followups_due()              -- surface overdue items
```

This is the exact same 9-phase pipeline I built for Micah's nightly search, but expressed as MCP tool calls instead of a monolithic prompt.

### Phase 4: Email Monitoring and Response Tracking

The AI monitors Gmail for responses and updates Core Line automatically.

**The flow:**
1. AI calls check_email_responses() every 2 hours
2. Tool searches Gmail sent folder for outreach we logged
3. Checks for replies in those threads
4. If reply found:
   - Calls mark_outreach_response() with outcome (positive/negative/interview_scheduled)
   - If interview: updates job status to "interviewing"
   - Cancels pending follow up for that contact
   - Notifies user: "Sarah from Chainguard replied. Here is what she said and what I recommend."
5. If rejection found:
   - Marks job as "rejected"
   - Removes from active pipeline
   - Logs for analytics (response rate tracking)
6. If no response after follow up window:
   - Surfaces follow up in battle plan
   - AI drafts a follow up message
   - User reviews and sends

### Phase 5: The Connection Graph

This is what makes Core Line different from a job tracker. Every outreach builds a relationship.

**What the user sees:**
- Network view shows all contacts with warmth scores
- Contacts who responded are "warm" (score goes up)
- Contacts with no response get follow up nudges
- When a job is rejected, the contact relationship persists
- "Sarah rejected you for VP Eng, but she knows people at 3 other companies in your pipeline"
- The AI suggests: "Sarah mentioned she knows the CTO at Five9. Want me to draft an intro request?"

**What the database tracks:**
- v2_contacts.warmth_score increases with each positive interaction
- v2_contacts.response_count tracks engagement
- v2_job_contacts links contacts across multiple jobs
- The AI can query: "Which contacts are linked to multiple jobs in my pipeline?"

### Phase 6: Autopilot Mode (Opt-in)

For users who want full automation:
1. AI runs nightly search, scores, verifies postings
2. AI writes outreach and creates Gmail drafts automatically
3. AI sends follow up messages after approval window (user has 4 hours to review before auto-send)
4. AI monitors responses and updates pipeline
5. User wakes up to: "I found 8 new jobs, wrote outreach for 5, and Sarah from Chainguard replied asking for a call Tuesday"

## What NOT To Build

- No built-in AI. Core Line is infrastructure. The AI connects via MCP.
- No resume builder. Users upload their resume. AI uses it for matching.
- No application tracking via scraping. Users tell Core Line they applied, or the AI detects it via email.
- No LinkedIn message sending. Users do that themselves. Core Line logs it.
- No payment processing yet. Get the product right first.

## Architecture Decision: Battle Plan as First Class Entity

The battle plan is not just a view. It is the daily artifact that drives everything. Every morning, the AI generates a new battle plan stored in v2_battle_plans with:

```json
{
  "plan_date": "2026-04-04",
  "summary": "8 new jobs found, 5 above 70% match. 3 follow-ups overdue.",
  "jobs": [
    {
      "id": "uuid",
      "company": "Circle",
      "title": "VP Engineering",
      "fit_score": 90,
      "action": "Apply + send outreach to Li Fan (CTO)",
      "resume_variant": "Engineering Leadership",
      "outreach_draft": "Li Fan, I saw the VP Engineering opening...",
      "contact": { "name": "Li Fan", "email": "lfan@circle.com" }
    }
  ],
  "followups_due": [
    {
      "contact": "Cameron Etezadi",
      "company": "LaunchDarkly",
      "days_since": 3,
      "draft_followup": "Cameron, following up on my note last week..."
    }
  ],
  "stats": {
    "total_pipeline": 35,
    "applied": 12,
    "interviewing": 2,
    "response_rate": "18%"
  }
}
```

The War Room UI renders this JSON. The user sees their marching orders. They execute. Core Line tracks it all.

## Timeline Estimate

- Phase 1 (Seed data): 1 session
- Phase 2 (Wire UI): 2-3 sessions
- Phase 3 (Nightly pipeline): 1-2 sessions
- Phase 4 (Email monitoring): 1 session
- Phase 5 (Connection graph): 1-2 sessions
- Phase 6 (Autopilot): 1-2 sessions

Total: 7-11 sessions to go from where we are to a fully functional Core Line 2.0 running for Micah as the first real user. The battle plan we built today IS the product spec. We just need to move it from static HTML into the platform.

---

## Customer Journey: The Two-Interface Model

### Corrected Understanding

Core Line IS the experience. Users WANT to come to Core Line because it is visually satisfying and shows them the full picture. The AI is the conversational interface for when they want to talk through things or work hands-free. Both paths read from and write to the same database. Both are always in sync.

### The Morning Flow (Core Line Web App)

1. User opens Core Line. War room says "8 actions today."
2. Each action is a card they expand.
3. Card shows: company, role, match score, resume variant, and action buttons.
4. "Apply" button opens the job posting. User applies. Comes back, clicks "Applied" or system detects it.
5. "LinkedIn" button opens the contact profile. User connects, sends message. Comes back, clicks "Sent" or tells their AI.
6. "View Email Draft" button opens Gmail to the pre-loaded draft. User reviews, hits send.
7. Each completed action moves the card forward visually. Satisfying. Momentum.
8. Checkboxes and "Mark Done" buttons on every action item for manual completion.

### The Conversational Flow (Any AI)

1. User opens Claude Desktop (or Gemini, ChatGPT).
2. "What should I work on today?" AI pulls battle plan via MCP, walks them through it.
3. "I just sent that email to Li Fan." AI calls log_outreach(), Core Line updates.
4. "I had a great call with Sarah, she wants a panel interview." AI logs it, updates status, drafts thank you, creates calendar hold.
5. Next time user opens Core Line, everything is current.

### Auto-Detection (No User Action Required)

1. Every 2 hours, AI scans Gmail sent folder and inbox.
2. Sent emails matching pipeline contacts: auto-marked as completed in Core Line.
3. Replies from contacts: card updated with "Li Fan replied on April 5th. Draft response ready."
4. Rejections: job marked as rejected, removed from active pipeline.
5. Interview requests: job moved to "Interviewing" stage.
6. User opens Core Line and sees it already updated. They did not have to tell anyone.

### Manual Override Always Available

Not everything gets caught automatically (LinkedIn messages, phone calls, in-person meetings). Every action item has a manual completion button in the Core Line UI. Users can also tell their AI about offline actions.

### Real-Time State

Core Line web UI needs websocket or polling so that when the AI updates something via MCP, the war room reflects it without a page refresh. The scoreboard is always live.

### The Prompt Problem: Solved

When a user connects their AI to Core Line via MCP:

1. The MCP tool descriptions tell the AI what each tool does.
2. A `get_system_instructions()` tool returns a context prompt: user profile, today's battle plan, what to do.
3. The user never copy/pastes prompts. They just talk to their AI naturally.
4. The AI knows what to do because Core Line tells it via the MCP tools.

### What The User Does NOT Do

- They do not write their own outreach (AI writes it).
- They do not search for jobs (AI searches nightly).
- They do not research companies (AI researches 70%+ matches).
- They do not track follow-ups manually (system auto-creates timers).
- They do not copy/paste prompts (MCP handles it).

### What The User DOES Do

- Review the battle plan each morning.
- Click through and apply to jobs.
- Send LinkedIn connection requests and messages.
- Review and send pre-drafted emails.
- Tell their AI about offline actions.
- Optionally, check things off manually in Core Line.
- Feel the momentum of watching their pipeline grow.

---

## The Nightly Battle Plan: Two Sources, One Plan

The battle plan is not just "new jobs found today." It is two things merged into one daily briefing:

### Source 1: Fresh Opportunities (New)
- AI searches LinkedIn/Indeed with 24hr freshness filters
- Scores against user profile
- 70%+ get deep research, outreach, Gmail drafts
- These are NEW cards in the battle plan

### Source 2: Pipeline Follow-ups (Existing)
- AI queries v2_followups for anything due today or overdue
- AI queries v2_outreach for sent messages with no response past the timer window
- AI checks Gmail/calendar for replies, interview confirmations, rejections
- AI checks v2_jobs for status changes that need action
- These are RETURNING cards in the battle plan with follow-up actions

### How Timers Work

Every outreach action starts a timer stored in v2_followups:

```
Action Taken              | Timer         | What Happens When It Expires
--------------------------|---------------|--------------------------------------------
Applied to job            | 5 biz days    | "No response from [company]. Draft follow-up?"
Sent outreach email       | 3 biz days    | "No reply from [contact]. Here is a check-in draft."
Sent LinkedIn connection  | 3 biz days    | "Connection not accepted. Try email instead?"
LinkedIn message sent     | 3 biz days    | "No response. Draft a bump message?"
Interview completed       | 2 biz days    | "Send thank-you if not already sent."
Follow-up sent            | 5 biz days    | "Still no response. Escalate to another contact?"
```

Timers are business days, not calendar days. Weekends and holidays do not count.

### The Morning Battle Plan Structure

When the AI generates the daily battle plan, it merges both sources into a prioritized action queue:

```
PRIORITY 1: URGENT FOLLOW-UPS (timers expired)
  - "3 days since you emailed Li Fan at Circle. No reply. Here is a follow-up draft."
  - "Sarah at Chainguard replied yesterday. You have not responded. Draft ready."
  - "Mutual of Omaha interview was Monday. Send thank-you. Draft ready."

PRIORITY 2: DUE TODAY (timers expiring)
  - "Follow up with Grant Halloran at Billtrust due today."
  - "Check status on Five9 application (5 days since applied)."

PRIORITY 3: NEW OPPORTUNITIES (from overnight search)
  - "8 new jobs found. 5 above 70% match."
  - "Top pick: [Company] VP Engineering, 92% match. Apply + outreach to [Contact]."
  - "Outreach drafted. Gmail draft ready. LinkedIn profile linked."

PRIORITY 4: PIPELINE HEALTH
  - "2 jobs have gone 10+ days with no movement. Consider closing or escalating."
  - "Your response rate is 22%. Industry average is 15%. You are doing well."
```

### What The AI Checks Each Night

Before building the morning plan, the AI runs this checklist against Core Line's database:

1. **v2_followups WHERE status='pending' AND due_date <= today** — overdue follow-ups
2. **v2_followups WHERE status='pending' AND due_date = today** — due today
3. **v2_outreach WHERE response_received=false AND sent_at < (today - 3 days)** — stale outreach
4. **v2_jobs WHERE status='applied' AND applied_at < (today - 5 days)** — applications with no movement
5. **v2_jobs WHERE status='interviewing'** — any interviews needing thank-yous or follow-ups
6. **Gmail sent folder** — match sent emails to pipeline contacts, auto-mark completed
7. **Gmail inbox** — match replies to pipeline contacts, update outcomes
8. **Calendar** — upcoming interviews, prep reminders
9. **LinkedIn/Indeed search** — new jobs posted in last 24 hours
10. **v2_jobs WHERE posting_status='live'** — re-verify top postings are still active

The result is one unified battle plan that says: "Here is everything you need to do today, in order of priority, with every draft and link ready to go."

### Database Support for Timers

The v2_followups table already supports this. Each follow-up has:
- `due_date` — when the timer expires
- `priority` — high/medium/low (overdue items auto-escalate to high)
- `status` — pending/done/snoozed
- `reason` — human-readable ("Follow up on outreach - no response yet")

New field needed:

```sql
ALTER TABLE v2_followups ADD COLUMN timer_type TEXT
  CHECK (timer_type IN ('application', 'outreach_email', 'outreach_linkedin',
    'linkedin_connection', 'interview_thankyou', 'general_followup'));
ALTER TABLE v2_followups ADD COLUMN business_days_window INT DEFAULT 3;
```

This lets the AI know what kind of follow-up it is and how many business days the window was, so it can write the right kind of follow-up message.

### The Escalation Path

If a follow-up goes unanswered after the second attempt:

1. First outreach: 3 business days, then follow-up draft
2. Follow-up sent: 5 business days, then escalation suggestion
3. Escalation: AI looks for another contact at the same company
4. If no other contact: card moves to "stale" and drops in priority
5. After 14 days total with no response: card auto-archives unless user overrides

This keeps the pipeline clean. Dead leads do not clog the battle plan forever.
