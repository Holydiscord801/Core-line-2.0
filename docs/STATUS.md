# Core Line 2.0 — Status

**Last updated:** 2026-04-07

## Where We Left Off (read this first)

Core Line 2.0 is in active feature-parity mode with v1. The dashboard is live on `localhost:3001`. Hot Signals is the newest shipped feature and is the current focus of iteration. Ingestion, scoring, outreach drafting, and email monitoring are all running autonomously on cron. Do not touch the look and feel of the dashboard, only fix data and wire features.

## Autonomous Workers (running)

| Task | Cron | Last run | What it does |
|---|---|---|---|
| `nightly-job-search` | `0 1 * * *` (1:06 AM) | 2026-04-07 17:46 UTC | Full pipeline: search LinkedIn/Indeed, score against resume, deep dive 70%+, write outreach, find emails, create Gmail drafts (currently not landing, see B10), update battle plan HTML |
| `email-check-job-responses` | `0 8,10,12,14,16,18 * * *` (every 2h) | 2026-04-07 20:07 UTC | Gmail scan across 4 tracks (inbox, bounces, social signals, sent/archived), writes v2_hot_signals |
| `nightly-openclaw-sync` | `0 0 * * *` (12:03 AM) | 2026-04-07 17:46 UTC | Friday/Tuesday shared brain sync, updates auto-memory, writes sync log |

## Recently Shipped

- **Hot Signals migration** (`001_v2_hot_signals.sql`) applied. Table has `signal_type`, `severity`, `status`, `related_job_id`, `contact_id` foreign keys.
- **Hot Signals dashboard cards** rendering 17 signals live (1 actioned, 16 open).
- **Hot Signals View Card button** shipped commit `c7c48e1` on master 2026-04-07.
- **Phase 2a contact link fix** commit `1ed1345` on master 2026-04-07. Server-side hydration of `linked_job_ids` via `v2_job_contacts` join, dropped the company-name heuristic in frontend `getJobContacts()`.
- **Phase 2b Kevin Charles email backfill** commit `cf77530` on master 2026-04-07. Idempotent script, one row updated to `kcharles@bamboohr.com`.
- **Chris Brown / Dan Lorenc** signals seeded manually.
- **Lever and Built In blacklist** hardened in ingestion layer. Source allowlist is LinkedIn, Indeed, Greenhouse, Workday, direct. Lever, Built In, Ashby, Gem are filtered at ingest.
- **Built In cleanup** of 5 stale battle plan entries. Cobalt AI was re-found on LinkedIn and re-saved. The other 4 confirmed dead.
- **Deep dive rerun** for the 4 dead jobs documented in `docs/deep-dive-rerun-2026-04-07.md`.

## In Progress

- **Job Timeline build (Phases 2c and 3)** Bolt code task `local_bdaa2411` on Opus 4.6 1M. Phase 2c writes the multi-channel migrations `008_outreach_sequences.sql`, `009_outreach_attempts.sql`, `010_indexes_and_triggers.sql` and bundles them into `scripts/apply-multi-channel.sql` for Supabase dashboard paste. Phase 3 adds the expanding timeline section inside the existing expanded-row template, plus card-face fields for Reach via channel, Next followup date, and Next action verb phrase, plus war room auto-generate-if-missing. Preserves existing UI strictly.

## Urgent Business State

1. BambooHR VP of Technology interview loop active with Kevin Charles. Emily Hansen LinkedIn DM unanswered. DB job status still "applied", needs to move to "interviewing".
2. Dexcom outreach bounced today (gnaganathan@dexcom.com). Workday application itself is confirmed. Girish accepted LinkedIn connection and Micah sent the same body as a LinkedIn DM at 11:42 AM. Follow-up timer should restart on the DM once the multi-channel migration ships.
3. Dan Lorenc (Chainguard CEO) connection accepted. Chainguard VP Eng is an open applied job. Highest-leverage warm intro on the board.
4. SailPoint outreach to Shirish Puranik delivered, no contact row in DB. Backfill needed.
5. ZoomInfo Sr Director PM surfaced 2026-04-07. Contact is Henry (last name TBD). Outreach draft and cover letter exist in Core Line, but no Gmail draft was created (see B10). Candidate for manual draft creation.
6. Hot bounces needing re-verification: Girish Naganathan, Chris Brown (sodahealth.com may be dead), Ryan Byrd, Tom Sharpless, Even Realities (.bio typo), Andrew Parry.

## Backlog (tracked, not forgotten)

Items that came out of audits and decisions but are deferred to keep scope honest. Each one has a trigger for when it becomes active. Nothing on this list is forgotten. When a trigger fires, the item graduates to "In Progress."

| # | Item | Why deferred | Trigger to activate |
|---|---|---|---|
| B1 | Wire the real send pipeline (manual LinkedIn DMs, manual emails) into `POST /api/outreach` so live activity actually logs | Root cause of the Dexcom case: the POST endpoint works, nothing is calling it. Bigger than the timeline build. Needs the multi-channel data model to exist first or it writes to the wrong shape. | After Phase 3 ships. Becomes Phase 4. |
| B2 | Gmail inbound body capture into `v2_outreach.response_text` or a new `v2_email_bodies` table | Timeline can only show hot signal summaries as placeholders for response content until this ships. Bolt will label them "from Gmail thread, not stored locally" in Phase 3. | After Phase 3 ships. Becomes Phase 5. |
| B3 | Real LLM next-action generation per job | Phase 3 will stub this as "AI suggestion (draft)" derived from the most recent `v2_hot_signals.ai_recommendation`. Real generation is a separate ML surface. | After Phase 3 ships. |
| B4 | Convert `email-check-job-responses` cron to a readable-transcript variant, or write a run-log markdown file each invocation | Cron works and writes rows but Dispatch cannot audit what it did. Not blocking, just opaque. | Next cron maintenance pass. |
| B5 | Gmail MCP connection inside code task and cron environments | Code tasks cannot run the full 4-track Gmail scan today. Dispatch has Gmail MCP, cron sessions do not. | Before next major email scan overhaul. |
| B6 | Fix `email-check-job-responses` cron to catch LinkedIn connection-accept notifications as first-class signals | Missed the Girish Naganathan accept on 2026-04-07 even though it fired on the same day as the bounce. | Next cron iteration, bundle with B4. |
| B7 | Rewrite Cobalt AI research memo (physical security AI, not medical imaging) | Factual error in existing memo. Low priority since the job is already re-saved on LinkedIn. | Opportunistic, next time Cobalt AI is touched. |
| B8 | Merge or dismiss duplicate Dan Lorenc hot signal | One actioned, one still new. Data hygiene only. | Phase 2 sub-task or opportunistic. |
| B9 | Audit `v2_hot_signals.related_job_id` vs `job_id` column naming inconsistency | Phase 1 audit found the column is `related_job_id`, not `job_id` as some code assumes. | Fold into Phase 2 if it bites, otherwise flag for cleanup sweep. |
| B10 | Gmail draft auto-creation is not actually creating drafts in Gmail | Nightly pipeline generates outreach text and cover letters correctly, but the Gmail draft step is not landing. Reported 2026-04-07 for ZoomInfo Sr Director PM (contact: Henry). Text exists in Core Line, draft does not exist in Gmail. Likely related to B1 (send pipeline not wiring through). Meanwhile, Tuesday can create drafts manually via Gmail MCP from the existing outreach text when Micah needs to send immediately. | Investigate alongside B1 in Phase 4. |
| B11 | Delete button on pipeline and contact cards | No way to remove a job or contact the user no longer wants to pursue. Remaining Built In entries, stale jobs, rejected-by-user jobs. Currently requires direct DB edit. Small frontend + `DELETE /api/jobs/:id` endpoint (and contacts equivalent) with a confirm modal. | Can ship as a Phase 2.5 micro-task alongside Phase 3, or fold into Phase 3 card UI work. |

## Known Gaps (not yet triaged into backlog)

- `gmail_search_messages` query filter appears to ignore `from:` clauses in some environments and returns the most recent N messages regardless. Worked around by reading specific threads directly.

## Architecture Reminder

- **MCP server** (stdio) for any AI to operate the pipeline.
- **REST API** (Express) on port 3001 for dashboards.
- **Supabase** Postgres with RLS, service role key for backend writes.
- **Tables:** v2_jobs, v2_contacts, v2_job_contacts (junction), v2_outreach, v2_battle_plan, v2_followups, v2_hot_signals.

## Cross-Project

The human-facing job search narrative and active pipeline table live in the Jobs project at `/home/micah/Documents/Claude/Projects/Jobs/JOB_SEARCH_STATUS.md`. When that doc and this one disagree, this one is authoritative for product/tech state and that one is authoritative for the job search narrative.
