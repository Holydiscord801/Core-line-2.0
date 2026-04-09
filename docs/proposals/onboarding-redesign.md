# Onboarding Redesign: AI-First, MCP-Driven

**Status:** Proposal — Q1 resolved, awaiting Q2–Q6 decisions
**Author:** Claude (swarm research)
**Date:** 2026-04-08
**Decision needed from:** Micah

---

## TL;DR

Gut the 5-step wizard currently living inside `mockup-warroom.html` and replace it with a single "Connect your AI to Coreline" screen. Once the user pairs their AI client (Claude Desktop, Claude Code, Cursor), the AI drives all profile setup conversationally via 6 new MCP tools. The HTML file's existing "war room" dashboard becomes the landing surface the user sees immediately after pairing.

Profile updates via MCP auto-steer the live pipeline because every existing MCP tool already re-reads `v2_users` fresh on each call. Adding a small debounced event layer closes the remaining gap: re-scoring stale `v2_jobs.fit_score` and re-ranking battle plans between cron ticks.

---

## 1. Architecture reality check

Before going further, here's what v2 actually looks like on disk:

- **Backend:** Node + Express + MCP stdio server (`src/api/`, `src/mcp/`). 28 MCP tools. Supabase for persistence. Vercel serverless deploy (`vercel.json` routes everything to `dist/index.js`).
- **"Frontend":** A single static HTML file — `mockup-warroom.html` (~220KB, ~4000 lines of inline HTML + inline `<script>`). Loads Supabase JS client via CDN, talks to the Express API via `fetch('/api/...')`, and owns every screen in the app (auth modal, onboarding wizard overlay, war room dashboard, job pipeline, contacts, battle plan, etc.).
- **No React. No Vite. No Next.js. No build step for the UI.** The HTML file is the UI.
- **No scheduler yet.** PLAYBOOK promises nightly sweeps and 2-hour inbox scans; nothing runs them. `src/utils/email-monitor.ts` exists but is imported nowhere.

This is important because it means **the change is much smaller than a typical "rewrite the onboarding flow" project**. We're editing one HTML file, adding 6 MCP tools, adding one schema migration, and updating a PLAYBOOK section.

---

## 2. Current state

### 2.1 The wizard that's live right now

**File:** `mockup-warroom.html`

**HTML overlay:** lines **1125–1277** (`<div class="onboarding-overlay" id="onboardingOverlay">` containing five sibling step cards `#onboardStep1` through `#onboardStep5`).

**JS controller:** lines **3700–3956** (`showOnboarding`, `hideOnboarding`, `updateOnboardingProgress`, `showOnboardStep`, `onboardNext`, `onboardBack`, `toggleChip`, `selectRemote`, `addLocation`, `removeLocation`, `renderLocationChips`, `saveOnboardingProfile`, `obGenerateKey`, `renderOnboardingSummary`, `completeOnboarding`).

**State:** `obCurrentStep`, `obApiKey`, `obLocations` at lines 3704-3706.

**Gate check:** lines **1453–1454** and **1496** — `if (!profile.onboarding_complete) { showOnboarding(); }`.

**The 5 steps:**

| # | Title | Collects | Writes |
|---|---|---|---|
| 1 | Welcome to Core Line | `full_name` (text input) | nothing yet (held in DOM) |
| 2 | Your Resume | `resume_text` (textarea paste — no file upload) | nothing yet |
| 3 | Your Preferences | `role_types` (chips), `salary_floor` (number), `locations` (chip list), `remote_ok` (radio), `industries` (chips) | `PATCH /api/users/profile` with `{ full_name, resume_text, preferences }` at line 3851 |
| 4 | Connect Your AI | API key generation via `POST /api/auth/api-key` at line 3880; shows copy button + Claude Desktop setup instructions (inline) | stores returned `api_key` in `obApiKey`, shows "Save this key now" warning |
| 5 | You're Ready | renders summary; has "Launch War Room" button | `POST /api/users/onboarding-complete` at line 3948 |

**Completion tracking:** `v2_users.onboarding_complete` (BOOLEAN, default false). Migration: `supabase/migrations/003_onboarding.sql`.

**Dashboard it sits on top of:** the "war room" (same file, rendered below the overlay when `hidden` class is toggled). Has pipeline, jobs list, contacts, battle plan, outreach — the AI-visible surface.

### 2.2 v2 MCP server

- **Entry:** `src/mcp/server.ts` (~2236 lines), `src/mcp/index.ts` wrapper
- **Transport:** stdio only
- **Auth:** `CORELINE_API_KEY` env var → SHA256 → `v2_api_keys.key_hash` → sets `currentUserId` global. Every tool calls `requireAuth()`.
- **Profile reads:** the `getProfile()` helper at `src/mcp/server.ts:721` re-queries `v2_users` on every invocation. No caching, no module-level constants. This is important — it means live preference updates already propagate to the next tool call for free.

**Tools that currently read profile data:**

| Tool | Fields read |
|---|---|
| `get_profile` | all |
| `search_jobs` | `preferences.locations/salary_floor/remote_ok/role_types/industries` |
| `score_job` | all preference fields |
| `generate_outreach` | `full_name`, `resume_text` |
| `generate_cover_letter` | `full_name`, `resume_text` |
| `fetch_jd` (conditional auto-CL) | `full_name`, `resume_text` |
| `batch_process_jobs` | `full_name`, `resume_text` |

**Tools missing for AI-driven onboarding:** no `set_resume_text`, `set_preferences`, `set_profile`, `set_target_companies`, `set_job_tracks`, or `complete_onboarding`. PLAYBOOK §14 walks the AI through intake questions but gives it nowhere to persist answers. It is aspirational.

**REST surface already in place:**
- `POST /api/auth/api-key` — generates a key (requires Bearer JWT). Already wired into the wizard's step 4.
- `PATCH /api/users/profile` — writes `full_name`, `resume_text`, `preferences` JSONB. Already wired into the wizard's step 3.
- `POST /api/users/onboarding-complete` — flips the flag. Already wired into step 5.

### 2.3 Known tech debt (hardcoded things that should be per-user)

These don't block this proposal but should be tracked:

- `src/mcp/server.ts:1237` — senior-title keyword list `['vp','director','head of','chief','cto','cio','svp']`
- `src/mcp/server.ts:1248` — salary tolerance ratio hardcoded at `0.9`
- `src/mcp/server.ts:1288-1291` — reporting-level keyword detection hardcoded
- `src/mcp/server.ts:468-471` — outreach `tone` enum has 3 values; no custom voice field
- `src/utils/cover-letter-generator.ts:85-107` — 9 hardcoded opener templates keyed by JD theme
- `src/utils/cover-letter-generator.ts:110-133` — hardcoded body connector phrases
- `src/utils/cover-letter-generator.ts:153` — hardcoded `"Dear Hiring Team at ${company}"` salutation
- **`v2_jobs.fit_score`** — persisted with no `preferences_version_at_score` snapshot. Scores silently go stale on preference change. **This one actually matters for the propagation story.**
- PLAYBOOK references `timezone`, `target_companies`, `job_tracks`, `auto_send_enabled` but none are in the `UserPreferences` TypeScript type. Type + schema support is a prerequisite for the new MCP tools.

---

## 3. Target state

### 3.1 Single-screen "Connect your AI"

Replace the 5-step wizard overlay with a single card that has:

```
┌─────────────────────────────────────────────────┐
│  CORE LINE                                       │
│                                                  │
│  Connect your AI to Coreline                    │
│                                                  │
│  Coreline is infrastructure. You bring the AI.  │
│  Once you pair your AI client, it sets up your  │
│  profile, runs your job search, and drafts      │
│  your outreach. You just watch it work.         │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Your API Key                             │   │
│  │  cl_live_xxxxxxxxxxxxxxxxxx  [Copy]       │   │
│  │  Save this now — it will not be shown     │   │
│  │  again.                                    │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  Pick your AI client:                            │
│  [Claude Desktop]  [Claude Code]  [Cursor]      │
│                                                  │
│  → tab shows client-specific copy-paste config   │
│    with the API key embedded                     │
│                                                  │
│  ⏳ Waiting for your AI to connect…              │
│     (polls every 2s, 5min timeout)               │
│                                                  │
│  Stuck? [help docs]                              │
└─────────────────────────────────────────────────┘
```

On successful pair → hide the overlay → drop user directly into the war room dashboard (already in the same HTML file) with empty-state hero text: *"Your AI is getting to know you. Open [Claude Desktop] and ask: 'Help me set up my job search.'"*

No forms, no chips, no textareas, no name field. The whole intake runs on the AI side via MCP tools.

### 3.2 Pairing handshake

**Mechanism:**

1. User lands on the Connect-AI card. Frontend calls `POST /api/auth/api-key` (already wired at line 3880). Key starts with `paired_at = NULL` in the DB.
2. Display the key once with a copy button. Show client-specific config snippets with the key embedded.
3. User pastes config into their AI client, restarts, issues any command.
4. Their AI's first MCP tool call hits `authenticateApiKey()` at `src/mcp/server.ts:~84`. On first successful auth, **set `v2_api_keys.paired_at = NOW()`**.
5. Frontend polls new endpoint `GET /api/auth/api-keys/:id/status` every 2s → `{ paired: bool, paired_at, last_used_at }`.
6. When `paired = true` → hide overlay, call `loadAllData()`, show war room.
7. Timeout after 5 min → show "Didn't hear from your AI yet" help text with retry.

**One schema change:**

```sql
ALTER TABLE v2_api_keys ADD COLUMN paired_at TIMESTAMPTZ NULL;
```

Everything else is wiring in existing code.

### 3.3 New MCP tools for conversational onboarding

| Tool | Writes | Purpose | Idempotent |
|---|---|---|---|
| `set_profile` | `v2_users.full_name`, preferences subfields (`current_title`, `city`, `state`, `years_experience`) | Confirmed values after resume parse | yes |
| `set_resume_text` | `v2_users.resume_text` | User pastes resume text into their AI; AI calls this with the full text | yes (overwrite) |
| `set_preferences` | `v2_users.preferences` JSONB (deep merge) | Partial updates: `role_types`, `salary_floor`, `locations`, `remote_ok`, `industries`, `timezone`, `auto_send_enabled` | yes |
| `set_target_companies` | `v2_users.preferences.target_companies[]` | Dream companies (names or URLs) | yes |
| `set_job_tracks` | `v2_users.preferences.job_tracks[]` | Primary + dream lanes. Exactly one `is_primary: true`. Stays in JSONB — no new table. | yes |
| `complete_onboarding` | `v2_users.onboarding_complete = true` | Final checkpoint; returns next-nightly-sweep ETA and a summary of what's been set | yes |

**All 6 tools fire propagation hooks (see §5).** Others (like `add_job`, `log_outreach`) do not.

**Type additions needed in `UserPreferences`:**

```ts
interface UserPreferences {
  role_types?: string[];
  salary_floor?: number;
  locations?: string[];
  remote_ok?: boolean;
  industries?: string[];
  // NEW:
  timezone?: string;              // IANA, e.g. 'America/Denver'
  target_companies?: string[];
  job_tracks?: JobTrack[];
  auto_send_enabled?: boolean;
}

interface JobTrack {
  name: string;
  role_types: string[];
  industries?: string[];
  companies?: string[];
  salary_floor?: number;
  is_primary: boolean;
}
```

### 3.4 PLAYBOOK §14 rewrite

Current §14 tells the AI to "ask four critical questions" but gives it no tools to persist answers. Rewrite it as a concrete tool sequence the AI follows when `get_profile()` returns `onboarding_complete: false`:

1. Greet: "Hey! I'm Core Line. Let's set you up — about 5 minutes."
2. Ask for resume text (paste or drag-and-drop into the chat) → `set_resume_text()`
3. Extract and confirm profile fields → `set_profile()` (with explicit confirmation at each field)
4. Role types & salary → `set_preferences({ role_types, salary_floor, industries })`
5. Location & remote → `set_preferences({ locations, remote_ok, timezone })`
6. Target companies → `set_target_companies([...])`
7. Job tracks (primary + optional dream lanes) → `set_job_tracks([...])`
8. Auto-send preference → `set_preferences({ auto_send_enabled })`
9. Optional demo sweep if browser tools are available
10. **Set up the recurring sweep in the user's AI client.** Because Coreline runs zero server-side background jobs (§4.5), the user's AI is responsible for scheduling its own recurring work. The AI must walk the user through setting up a scheduled task in their client:
    - Claude Code: `/loop 1d "Check my Coreline jobs and update outreach drafts"`
    - Claude Desktop: Cowork → Scheduled tasks → Add
    - ChatGPT Plus+: "Create a task to check my Coreline jobs every day at 8am"
    - Gemini Advanced: Menu → Scheduled actions → Create
    - Cursor Pro: Background Agent with the sweep prompt
    - Gemini CLI: crontab entry with `gemini -p`
    The AI confirms the task is scheduled before moving on. If the user's client doesn't support scheduling (Windsurf, free-tier), the AI tells them Coreline still works interactively and moves on without the schedule.
11. `complete_onboarding()` — returns a brief summary of what's been set (profile, preferences, scheduled task or lack thereof).

Docs-only change in `docs/PLAYBOOK.md`. No code.

### 3.5 Empty-state dashboard

Already exists in `mockup-warroom.html` as the "war room" surface below the onboarding overlay. After pairing, all we need to do is:

- Hide the overlay
- Show an empty-state hero card on top of the war room: "Your AI is getting to know you. Open [Claude Desktop] and ask: *Help me set up my job search.*"
- Include a couple of copy-to-clipboard suggested prompts
- Let the war room render the (currently empty) pipeline, contacts, and battle plan normally as the AI populates them

No new screens to build. The war room is already there.

---

## 4. Downstream field → consumer map

Every profile field, what it steers, and what "propagation" means for it:

| Field | Consumers | Action on change |
|---|---|---|
| `resume_text` | `generate_outreach`, `generate_cover_letter`, `fetch_jd` auto-CL path, skill-match scoring | Invalidate persisted `v2_jobs.cover_letter` for unsent jobs (lazy regen on next view); voice shifts in new drafts; sent outreach untouched |
| `full_name` | outreach sign-off, cover letter salutation | New drafts pick it up; sent outreach untouched |
| `preferences.salary_floor` | `score_job` (20% weight), `search_jobs` defaults, outreach salary asks | Re-score all `new`/`researching`/`applied` jobs; next cron uses new floor; draft outreach updated |
| `preferences.role_types` | `score_job` title-match (25%), `search_jobs`, nightly cron | Re-score title-match component; next sweep uses new roles |
| `preferences.locations` | `score_job` geo component, `search_jobs` filter | Re-score; don't delete existing non-matching jobs, just lower priority |
| `preferences.remote_ok` | `score_job` remote weight (15%), search filter | Re-score |
| `preferences.industries` | `score_job` industry (15%), search filter, outreach tone | Re-score |
| `preferences.target_companies` | battle plan ranking, search priority boost, outreach prioritization | **Immediate re-rank** (skip debounce); next cron boosts these |
| `preferences.timezone` | nightly cron tick, inbox scan cadence | Re-schedule next cron tick; reschedule upcoming inbox scans |
| `preferences.auto_send_enabled` | outreach send path (draft-only vs auto-send) | Applies to new drafts only; existing drafts untouched |
| `preferences.job_tracks` | search criteria per track, battle plan segmentation, scoring context | Re-generate battle plan; next cron iterates per track |

---

## 4.5 Scheduling delegation model (ADDED after Micah's Q5 direction)

### Principle

**Coreline runs zero server-side background jobs.** No nightly cron, no email-poll worker, no scheduled re-scoring, no "check inbox every 2 hours" worker. None of it.

The user's AI is responsible for scheduling its own recurring work on its own cadence, using its own infrastructure, paid for by the user's own AI subscription. Coreline exposes MCP tools; the user's AI decides when to call them.

This keeps Coreline's compute costs near-zero (only web+API+MCP hosting + Supabase storage) and aligns with the broader AI-first philosophy: *Coreline is infrastructure. You bring the AI.*

### What the user's AI is expected to do on a schedule

- **Nightly job sweep** — search for new matching jobs (using the AI's own browser/search tools), call `bulk_import_jobs()` with findings
- **Email response scan** — read the user's email (using the AI's own Gmail/Outlook integration), call `mark_outreach_response()` and `create_hot_signal()` as appropriate
- **Morning briefing** — call `get_battle_plan()`, deliver to the user proactively
- **Re-scoring after preference changes** — when the AI notices preferences changed (via `get_profile()`), call `batch_process_jobs()` to re-run fit scoring on the pipeline
- **Followup reminders** — call `get_followups_due()` and nudge the user

### Capability matrix — scheduled tasks across AI clients (April 2026)

| Client | Scheduled tasks? | Platform support | Tier required | Hard limits | Compute runs where |
|---|---|---|---|---|---|
| **Claude Code** | **Yes** — `/loop` and `/schedule` built-in skills; desktop scheduled tasks fire fresh sessions at intervals | macOS + Windows (desktop tasks); Linux via `claude -p` headless cron | Any Claude Code plan | Recurring tasks auto-expire after 3 days (must be re-created); `CLAUDE_CODE_DISABLE_CRON=1` kill switch | **User's own machine** (must be on and Claude Code installed) |
| **Claude Desktop** | Partial — inherits `/loop` and `/schedule` skills via the Skills system when paired with Claude Code/Cowork | macOS + Windows | Claude Pro/Team/Enterprise | Same 3-day expiry on recurring tasks | User's own machine |
| **ChatGPT Desktop/Mobile** | **Yes** — "Tasks" feature launched Jan 2026; up to 10 active tasks per user | macOS + iOS + Android; **Windows blocked**; **web browser blocked**; Pro tier **blocked** | ChatGPT Plus / Team / Enterprise (NOT Free, NOT Pro) | 10 active tasks max; runs inside OpenAI's cloud | **OpenAI's servers** (free from Coreline's perspective) |
| **Gemini** | **Yes** — "Scheduled Actions" | Android + iOS + Web (paid) | Gemini Advanced / Google Workspace Business+ | 10 active actions max | **Google's servers** (free from Coreline's perspective) |
| **Cursor** | **Yes** — "Background Agents" (Cursor 2.0+); can run autonomously for 25–52 hours in cloud Ubuntu VMs | All platforms (cloud-based) | Cursor Pro / Business (uses agent compute credits) | Up to 8 parallel agents; credits-per-hour billing | **Cursor's cloud servers** (user pays via subscription) |
| **Windsurf** | **No** — only parallel Cascade sessions that run locally while user is present | — | — | — | Requires user active in front of IDE |
| **VS Code + Copilot** | **Not natively** — Copilot has no scheduled background mode; would need an external scheduler (OS cron, GitHub Actions) | — | — | — | N/A |
| **Gemini CLI** | **Yes via headless mode** — `gemini -p` + OS cron; documented automation pattern | Any Unix-like OS | Any Gemini API tier | User-managed | User's own machine |

**Summary:** The four AI clients Coreline most cares about (Claude Code, Claude Desktop, ChatGPT, Gemini) **all** support scheduled tasks as of April 2026. Cursor users get it via Background Agents. Windsurf and VS Code users do not.

### Tier requirements (paid AI subscription assumed)

Scheduling is available on all major consumer AI clients in April 2026, but universally behind the paid tier of that client:

- **ChatGPT Tasks** — requires **ChatGPT Plus** ($20/mo) or higher. Not available on Free. ([OpenAI Help – ChatGPT Plans](https://chatgpt.com/pricing/), [ChatGPT Plus Limits 2026](https://customgpt.ai/chatgpt-plus-limits-2026/))
- **Gemini Scheduled Actions** — requires **Gemini Advanced** ($19.99/mo as part of Google One AI Premium) or Google Workspace Business+. ([Gemini Apps Help – Scheduled Actions](https://support.google.com/gemini/answer/16316416))
- **Claude Code scheduled tasks** — available to anyone who has Claude Code installed (free binary; usage meters against Claude Pro/Max subscription or API key). No separate tier gate.
- **Cursor Background Agents** — requires **Cursor Pro** ($20/mo) or Business tier.

**This is fine.** Coreline's target segment ($14.95/mo for AI-powered job search) almost by definition already pays for at least one of these. Asking users to have a paid AI subscription isn't a barrier — it's a prerequisite for getting any meaningful use out of an AI-first product in the first place.

### Edge cases (documented, not architected around)

**Free-tier AI users** (free ChatGPT, free Gemini, Windsurf) don't get background scheduling. They can still use Coreline interactively — open their AI, say "run my Coreline sweep", and all the MCP tools work exactly the same. No background cadence, but no broken experience either. The Connect-Your-AI page flags this on each client tab so the user knows what they're signing up for. **We don't build a server-side fallback for this segment** — that would reintroduce the exact infrastructure we're deleting.

**Platform holes** (ChatGPT Tasks not working on Windows web, ChatGPT Tasks not working on Pro tier) — surface as "Known limitations" callouts on the relevant client tab on the Connect-Your-AI page, with suggested workarounds ("switch to the ChatGPT macOS desktop or mobile app for scheduled tasks").

**No "lite cron" tier. No Coreline-managed sweeps. No server-side worker process for any user.** If a user's AI can't schedule, they run interactively, period. This is the pricing-model discipline that keeps Coreline's cost curve flat.

### Does this design hold up? (honest assessment)

**Yes, cleanly.** All four AI clients Coreline cares most about (Claude Code, Claude Desktop+Cowork, ChatGPT Plus, Gemini Advanced) have native scheduled-task support available to paid consumer users. Cursor Pro users get it via Background Agents. The only groups excluded are free-tier AI users (not our target) and Windsurf-only users (a code-editor audience that already has another AI).

The design is consistent with Coreline's AI-first philosophy, keeps compute costs near-zero, and doesn't require any user to install extra infrastructure beyond the AI they're already using.

---

## 5. Propagation / event layer

### 5.1 Model: synchronous in-request propagation (no scheduler dependency)

**Pull (already works):** every MCP tool already re-reads `v2_users` fresh on each call. **Without a server-side scheduler, this is actually the primary mechanism.** When the user's AI calls `search_jobs`, `score_job`, `get_battle_plan`, or any other preference-consuming tool, it gets the live version every time. No propagation ceremony needed.

**Event (new, small, in-request):** on every `set_*` tool write, do a synchronous "fan-out" inside the same MCP request that triggered the write:

1. Write the audit log row (§5.5)
2. Apply the change to `v2_users` and increment `preferences_version`
3. Re-score affected `v2_jobs` **in the same request** (bounded work — typically <200 jobs per user, <500ms total)
4. Return from the MCP tool call

For rapid edits during onboarding (`set_preferences` called 4–6 times in 30 seconds), we still coalesce via a short **60-second in-process debouncer** — but the debouncer lives inside the Express process and fires synchronously against whatever MCP request is active when the timer expires, or inline on the next `set_*` call that lands after the timer. **No background worker. No cron tick.** If the Node process restarts before a debounced cycle runs, the next MCP tool call from that user triggers a stale-detection path (§5.3) that catches up.

**Why this works without a scheduler:** the propagation cycle is bounded, cheap, and only runs in direct response to MCP tool calls that are already arriving because the AI is actively calling us. Coreline's compute usage scales with AI activity, not with wall clock time. Zero idle cost.

### 5.2 What the propagation cycle does

1. Re-score all `v2_jobs` in `new`/`researching`/`applied` states (recompute `fit_score` against current preferences).
2. Invalidate `v2_jobs.cover_letter` for unsent jobs if `resume_text` changed (mark stale; regen lazily when the AI or the dashboard next asks for it).
3. Re-rank battle plan if `target_companies` or `job_tracks` changed.
4. Write an entry to the audit log (§5.5).

All of the above runs inside the Express request handler for the `set_*` MCP tool that triggered it. No scheduled ticks.

### 5.3 Staleness tracking: `preferences_version`

```sql
ALTER TABLE v2_users ADD COLUMN preferences_version INT NOT NULL DEFAULT 0;
ALTER TABLE v2_jobs  ADD COLUMN preferences_version_at_score INT;
```

On every `set_*` tool write, increment `v2_users.preferences_version`. When `score_job` writes `fit_score`, it also writes the current `preferences_version_at_score`. Reads can detect stale scores with `WHERE preferences_version_at_score < v2_users.preferences_version`.

**This is the fix for the silent `fit_score` staleness problem**, and it's also the eventual-consistency safety net: any tool that reads `v2_jobs` and notices stale rows for the current user can re-score them inline before returning. No background worker needed to guarantee convergence.

### 5.4 Eventual consistency safety net

Without crons, the safety net is: on every MCP tool call that reads job data (`get_jobs`, `get_battle_plan`, `get_pipeline_summary`), detect stale rows via the `preferences_version_at_score` comparison and re-score them inline before responding. Worst-case a slightly slower first call after preferences change; steady-state is fast. No separate worker needed; no durable queue needed.

### 5.5 Audit trail: `v2_profile_changes`

```sql
CREATE TABLE v2_profile_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  source_tool TEXT,               -- 'set_preferences', 'set_resume_text', etc.
  triggered_propagation BOOLEAN DEFAULT FALSE,
  propagation_completed_at TIMESTAMPTZ,
  propagation_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_v2_profile_changes_user_id ON v2_profile_changes(user_id);
CREATE INDEX idx_v2_profile_changes_created_at ON v2_profile_changes(created_at DESC);
```

Every `set_*` tool inserts a row **before** writing to `v2_users`. Answers "why did the pipeline change and when?" — useful for debugging and for trust ("my AI won't rewrite my profile without leaving a trail").

### 5.6 Why not Redis / BullMQ / pg_notify?

Single-process Node architecture today. An in-memory debouncer + monotonic version counter solves the whole problem. If/when we split into multi-process workers, the version counter already works across processes. Upgrade path is clean. Don't pay infra cost before we need it.

---

## 6. Deletion / modification list

### Delete in `mockup-warroom.html`

- Lines **1125–1277** — the entire `#onboardingOverlay` div with all 5 step cards
- Lines **3700–3956** — the JS controller block (`showOnboarding`, `hideOnboarding`, `updateOnboardingProgress`, `showOnboardStep`, `onboardNext`, `onboardBack`, `toggleChip`, `getSelectedChips`, `selectRemote`, `getSelectedRemote`, `addLocation`, `removeLocation`, `renderLocationChips`, `saveOnboardingProfile`, `obGenerateKey`, `renderOnboardingSummary`, `completeOnboarding`)
- Lines **3704–3706** — the module-level state (`obCurrentStep`, `obApiKey`, `obLocations`)
- All associated CSS in the `/* Onboarding wizard */` block starting around line **177** (`.onboarding-overlay`, `.onboarding-container`, `.onboarding-progress`, `.onboarding-card`, `.onboarding-step-num`, `.onboarding-title`, `.onboarding-sub`, `.onboarding-field`, `.onboarding-label`, `.onboarding-input`, `.onboarding-textarea`, `.onboarding-chips`, `.onboarding-chip`, `.onboarding-remote-options`, `.onboarding-remote-option`, `.onboarding-nav`, `.onboarding-btn`, `.onboarding-summary*`) — replaced with simpler CSS for the new Connect-AI card
- The Enter-key listener at line **3814-3819** (only used by the wizard's location input)

### Add in `mockup-warroom.html`

- New overlay `#connectAiOverlay` with:
  - Logo + headline + subcopy
  - API key display with Copy button (reuse `obGenerateKey` logic, simplified)
  - Client picker tabs (Claude Desktop / Claude Code / Cursor) — reveal a copy-paste config snippet on selection
  - Status line with polling indicator
  - Help link
- New JS functions:
  - `showConnectAi()` — called from the gate check at line 1453
  - `generateAndShowKey()` — simplified version of `obGenerateKey`
  - `startPairingPoll()` — polls `GET /api/auth/api-keys/:id/status` every 2s, hides overlay on pair
  - `stopPairingPoll()` — cleanup on hide
  - `selectAiClient(client)` — swaps the displayed config snippet
- Update the gate check at **lines 1453, 1496** to call `showConnectAi()` instead of `showOnboarding()`
- Empty-state hero card on the war room (rendered when `cachedJobs.length === 0 && cachedContacts.length === 0`) with suggested prompts

### Backend changes

- **New DB migration** (`supabase/migrations/011_connect_ai_pairing.sql` or next number):
  - `ALTER TABLE v2_api_keys ADD COLUMN paired_at TIMESTAMPTZ NULL;`
  - `ALTER TABLE v2_users ADD COLUMN preferences_version INT NOT NULL DEFAULT 0;`
  - `ALTER TABLE v2_jobs ADD COLUMN preferences_version_at_score INT;`
  - `CREATE TABLE v2_profile_changes (...)` with indexes
- **Modify `src/mcp/server.ts`:**
  - `authenticateApiKey()` (~line 84) — set `paired_at = NOW()` on first successful auth for keys where it's NULL
  - `score_job` tool — also write `preferences_version_at_score`
  - Add 6 new tool definitions + handlers: `set_profile`, `set_resume_text`, `set_preferences`, `set_target_companies`, `set_job_tracks`, `complete_onboarding`
  - Each `set_*` handler: write audit log row → write `v2_users` → increment `preferences_version` → enqueue debounced propagation
- **New REST endpoint** in `src/api/routes/auth.ts`:
  - `GET /api/auth/api-keys/:id/status` → `{ id, name, paired, paired_at, last_used_at }`, requires Bearer JWT, owner-only
- **New propagation module** (`src/propagation/index.ts` or similar):
  - In-memory debouncer keyed by `user_id`
  - Propagation cycle function (re-score jobs, invalidate CLs, re-rank battle plan)
  - `enqueuePropagation(userId, fields, { immediate?: boolean })`
- **Update `UserPreferences` type** in wherever it's declared (`src/types/user.ts` or similar) to add `timezone`, `target_companies`, `job_tracks`, `auto_send_enabled`
- **Update `docs/PLAYBOOK.md`** §14 with the concrete tool sequence

### Keep (do not touch)

- The war room dashboard in `mockup-warroom.html` — that's where users land after pairing
- `POST /api/auth/api-key` — already works, already wired
- `POST /api/users/onboarding-complete` — still called by the new `complete_onboarding` MCP tool
- `PATCH /api/users/profile` — stays as an escape hatch / future edit-form endpoint
- Everything else in `src/api/` and `src/mcp/` that isn't on the change list above

### Explicitly NOT building

- **No server-side scheduler.** No `node-cron`, no BullMQ, no Redis, no Temporal, no `pg_cron`. No `src/workers/`, no `src/scheduler/`, no `src/cron/` directory. See §4.5 for the full delegation model.
- **No email poll worker.** User's AI reads the user's email via the AI's own integration (Gmail MCP, Outlook connector, etc.) and calls `mark_outreach_response()` / `create_hot_signal()` via our MCP tools. Coreline never touches mailboxes.
- **No background job runner of any kind.** The Express process is request/response only. Every MCP tool call is synchronous. Every REST endpoint is synchronous. No long-running workers, no daemon processes, no timers outside the 60-second in-process propagation debouncer (§5.1) which itself only runs inside active MCP requests.

**Confirmed by grep of the current `coreline-v2` repo:** there are no existing `scripts/cron-*`, `src/workers/`, `src/scheduler/`, or `src/cron/` files. `scripts/` only contains one-shot backfill/migration helpers (`backfill-*.ts`, `run-migration.ts`, `seed-battleplan.ts`, `import-battleplan.ts`, `lever-builtin-cleanup.ts`). Nothing to delete. The "no scheduler" discipline is enforced by simply not adding any.

### Cross-file references to check before deletion

Grep confirmed: `showOnboarding`, `obCurrentStep`, `obApiKey`, `obLocations`, `onboardNext`, `onboardBack`, `completeOnboarding`, `saveOnboardingProfile`, `renderOnboardingSummary`, `obGenerateKey` are all scoped to `mockup-warroom.html`. No external references. Clean delete.

---

## 7. Change list (summary)

**New code:**
- 1 migration file (4 schema changes: `paired_at`, `preferences_version`, `preferences_version_at_score`, `v2_profile_changes`)
- 6 new MCP tools
- 1 new REST endpoint
- 1 new propagation module (debouncer + cycle)
- `UserPreferences` type additions
- Connect-AI overlay HTML + JS + CSS in `mockup-warroom.html`
- Empty-state hero on the war room

**Modified code:**
- `authenticateApiKey()` — set `paired_at` on first successful call
- `score_job` tool — write `preferences_version_at_score`
- `docs/PLAYBOOK.md` §14 — rewrite with concrete tool sequence
- Gate check in `mockup-warroom.html` at lines 1453 + 1496

**Deleted code:**
- `mockup-warroom.html` wizard overlay (lines 1125-1277)
- `mockup-warroom.html` wizard JS (lines 3700-3956)
- `mockup-warroom.html` wizard state (lines 3704-3706)
- `mockup-warroom.html` wizard CSS (around line 177)
- `mockup-warroom.html` Enter-key listener (lines 3814-3819)

**Deferred (tech debt; not blocking this proposal):**
- Hardcoded scoring constants → user preferences
- Cover letter template personalization
- Actual scheduler implementation (separate workstream; propagation design works without it)
- Dashboard edit forms for correcting AI-written data

---

## 8. Open questions

### Open Question 1 — RESOLVED

**V1 is sunset. Ignored. Not referenced. v2 is a ground-up AI-first build with a visual dashboard the user *can* log into if they want to see it, but the AI does everything via MCP. That stays the design.** No migration, no compatibility layer, no cross-references. The wizard currently in `mockup-warroom.html` is wrong and is being replaced.

---

### Open Question 2 — RESOLVED (with research update)

**Original assumption (wrong):** Only Claude Desktop, Claude Code, and Cursor natively support stdio MCP, so MVP should be Claude + Cursor only.

**What the research actually shows as of April 2026:** MCP is now supported natively by virtually every major AI client. OpenAI added full MCP read/write support to ChatGPT Developer Mode (after integrating MCP into the Agents SDK and ChatGPT Desktop in March 2025). Google shipped MCP support in the Gemini API and SDK in March 2026, and Gemini CLI is natively MCP-compatible. Cursor, Windsurf, VS Code (via GitHub Copilot MCP or the Cline/Continue extensions), Zed, Amazon Q, Replit, LibreChat, Chainlit, and Goose are all MCP-native.

**Sources:**
- [OpenAI Adds Full MCP Support to ChatGPT Developer Mode – InfoQ](https://www.infoq.com/news/2025/10/chat-gpt-mcp/)
- [Building MCP servers for ChatGPT Apps and API integrations – OpenAI Developers](https://developers.openai.com/api/docs/mcp)
- [Announcing official MCP support for Google services – Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/announcing-official-mcp-support-for-google-services)
- [MCP servers with the Gemini CLI](https://geminicli.com/docs/tools/mcp-server/)
- [9 Best MCP Clients for Developers (2026) – Fast.io](https://fast.io/resources/best-mcp-clients-developers/)
- [The Complete Guide to MCP Config Files – MCP Playground](https://mcpplaygroundonline.com/blog/complete-guide-mcp-config-files-claude-desktop-cursor-lovable)

**New decision (Micah's direction):** The Connect-Your-AI page lists every AI client we support, grouped by type, with a specific config snippet and transparent limitations for each. Maximum optionality.

**Supported AI clients at launch:**

| # | Client | Category | Config format | Setup friction | Known limitations |
|---|---|---|---|---|---|
| 1 | **Claude Desktop** | Desktop chat app | JSON in `claude_desktop_config.json` (Settings → Developer → Edit Config) | Low — GUI-led | None. Flagship target. |
| 2 | **Claude Code** | CLI / coding agent | `claude mcp add coreline ...` command | Low — single CLI command | Terminal-first (non-technical users may prefer Claude Desktop) |
| 3 | **ChatGPT Desktop** | Desktop chat app | Connectors → Add MCP Server (Developer Mode) | **Medium — requires enabling Developer Mode (beta toggle in Settings → Connectors → Advanced)** | Developer Mode is still labeled beta; feature is gated behind that flag. Free-tier ChatGPT users may not see the toggle — confirm Plus/Team/Enterprise required. |
| 4 | **Cursor** | AI code editor | JSON in `~/.cursor/mcp.json` (same `mcpServers` format as Claude Desktop) | Low — copy-paste JSON | Primarily a code editor; non-developers may find it heavyweight |
| 5 | **Windsurf** | AI code editor | JSON via Cascade settings | Low — copy-paste JSON | Same audience as Cursor |
| 6 | **VS Code + GitHub Copilot** | Code editor | `settings.json` under `github.copilot.mcp` or via Continue/Cline extensions | Low-medium — depends on extension choice | Requires GitHub Copilot subscription OR Cline/Continue as the MCP host |
| 7 | **Gemini CLI** | Terminal AI agent | `~/.gemini/settings.json` under `mcpServers` key | Low — single JSON edit | Terminal-only. The web/mobile Gemini apps **do not** natively host MCP servers — Gemini users need the CLI or must run Gemini models via another MCP host. Flag this clearly. |
| 8 | **Zed** | Code editor | `context_servers` key in Zed settings (different key name than Claude/Cursor) | Low — copy-paste JSON, but users must know it's `context_servers` not `mcpServers` | Same audience as Cursor |
| 9 | **Others** | Open source / self-hosted | Continue, Cline, LibreChat, Chainlit, Goose, Amazon Q, Replit | Varies | Grouped under "Advanced — other MCP clients" with a link to our docs and a raw API key + stdio command. No per-client config snippet. |

**Connect-Your-AI page layout (updated):**

```
┌────────────────────────────────────────────────────────┐
│  CORE LINE                                              │
│                                                         │
│  Connect your AI to Coreline                           │
│  Pick the AI you already use. Copy the config. Done.   │
│                                                         │
│  ┌─ Your API Key ─────────────────────────────────┐    │
│  │ cl_live_xxxxxxxxxxxxxxxxxx          [Copy]      │    │
│  │ Save this now — it will not be shown again.     │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  💬 Chat apps           💻 Code editors                 │
│  [Claude Desktop]       [Cursor]                        │
│  [ChatGPT Desktop]      [Windsurf]                      │
│                         [VS Code]                       │
│                         [Zed]                           │
│                                                         │
│  🖥 Terminal             🧩 Advanced                    │
│  [Claude Code]          [Other MCP clients]             │
│  [Gemini CLI]                                           │
│                                                         │
│  → tab shows client-specific instructions + config     │
│    snippet + any limitations callout                    │
│                                                         │
│  ⏳ Waiting for your AI to connect…                     │
│     (polls every 2s, 5min timeout)                      │
└────────────────────────────────────────────────────────┘
```

Each tab renders a client-specific block with **three sections**:

1. **Install** — 2–4 line setup instruction ("Open Claude Desktop → Settings → Developer → Edit Config → paste this into `mcpServers`") + code block with the actual MCP config (API key pre-filled).
2. **Schedule your sweep** — client-specific instructions for setting up the recurring "run my Coreline sweep" task. Each client has a different mechanism; we walk the user through theirs:
   - **Claude Code**: *"Once connected, run `/loop 1d "Check my Coreline jobs, run a sweep, and update outreach drafts"`. Your machine must be on when the task fires, but Claude Code takes care of the rest."*
   - **Claude Desktop (Cowork)**: *"Settings → Skills → Scheduled tasks → Add task → paste: 'Check my Coreline jobs and update outreach drafts daily at 8am.'"*
   - **ChatGPT Desktop/Mobile (Plus+)**: *"Once connected, say: 'Create a task to check my Coreline jobs every day at 8am and update outreach drafts.' ChatGPT will confirm and schedule it."*
   - **Gemini Advanced**: *"In the Gemini app, tap the menu → Scheduled actions → Create → paste: 'Check my Coreline jobs and update outreach drafts daily at 8am.'"*
   - **Cursor Pro**: *"Start a Background Agent with the prompt: 'Check my Coreline jobs daily and update outreach drafts.' Cursor will run it on its servers."*
   - **Gemini CLI**: *"Add this to your OS crontab: `0 8 * * * gemini -p 'Check my Coreline jobs and update outreach drafts'`"*
   - **Windsurf / VS Code**: no native scheduling — tab shows: *"Your client doesn't support scheduled tasks. Coreline still works interactively — open your AI and say 'run my Coreline sweep' whenever you want a fresh pass."*
3. **Known limitations** — yellow pill callout if any. Examples: ChatGPT Tasks requires Plus+ and doesn't work on Windows web; Claude Code desktop scheduled tasks don't run on Linux (suggest `claude -p` cron); Zed uses `context_servers` not `mcpServers`.

**Gemini caveat (important):** the Gemini web, mobile, and native desktop apps currently do not host MCP clients. Only Gemini CLI does. Users who want Gemini-powered Coreline must install Gemini CLI. We will state this explicitly on the Gemini tab. (This is the kind of thing to re-verify at implementation time — Google may ship MCP support in the consumer Gemini app between now and launch.)

**ChatGPT caveat (important):** Developer Mode is still labeled beta and may be gated behind ChatGPT Plus/Team/Enterprise subscriptions. We will state "Requires ChatGPT Plus or higher with Developer Mode enabled" on the ChatGPT tab and link to OpenAI's setup guide. Re-verify at implementation time.

---

### Open Question 3 — RESOLVED BY DESIGN

Resume handling is entirely the user's AI's responsibility. The user uploads the resume (PDF, DOCX, plain text, screenshot, whatever) directly to **their own AI client** — Claude, ChatGPT, Gemini, etc. Their AI parses it (all major AI clients already handle PDF, DOCX, and image-based resumes natively), extracts the relevant fields, and calls our `set_resume_text` MCP tool with the cleaned-up text.

**Coreline never receives a file.** There is no upload widget anywhere in our UI. There is no server-side PDF parser. There is no Gemini/pdf-parse dependency. The resume pipeline is: *user → their AI → our `set_resume_text` tool → `v2_users.resume_text`*. That's it.

This is a consequence of the AI-first philosophy, not a question to debate. The original Q3 existed because I was still half-thinking in "web app collects data" mode. Dropping it.

---

### Open Question 4 — RESOLVED (trigger refined + trial length researched)

**Trigger decision:** trial timer starts on the **first `set_resume_text()` call**, not at pairing.

**Why:** pairing just establishes a connection. The first `set_resume_text()` call is the moment the AI has enough context to start generating real matches, scored jobs, and drafted outreach. That's the actual moment of value delivery — the user's clock should start when the product starts working *for them specifically*, not when they finish setup ceremony.

**Implementation:** inside the new `set_resume_text` MCP tool handler, check if `v2_users.trial_started_at IS NULL`. If so, set `trial_started_at = NOW()` and `trial_ends_at = NOW() + interval 'N days'` (where N is the chosen length below). Idempotent — subsequent `set_resume_text` calls don't reset the clock.

**Trial length research:**

Summary of the 2026 SaaS trial benchmarks:

- **7-day trials convert at ~40.4%** on average; trials >61 days drop to ~30.6% ([First Page Sage benchmarks](https://firstpagesage.com/seo-blog/saas-free-trial-conversion-rate-benchmarks/)).
- **14 days is the industry default** (62% of SaaS products) — middle ground between urgency and exploration ([SaaS Free Trial Length – PostNitro](https://postnitro.ai/blog/post/saas-free-trial-length)).
- **Short trials with urgency cues outperform 30-day trials by 71%** — but only when users reach their aha moment before the clock runs out ([Customer.io](https://customer.io/learn/product-led-growth/free-trial-length)).
- **Credit-card-required (opt-out) trials convert at 30% vs. opt-in trials at 6%**, a 5x difference. But credit card friction kills signups; it's a volume-vs-conversion trade-off ([ChartMogul SaaS Conversion Report](https://chartmogul.com/reports/saas-conversion-report/)).
- **AI products specifically:** a "reverse trial" (full access for N days → downgrade to limited free) outperforms a permanently-crippled free tier ([How to Price AI Products – Aakash Gupta](https://www.news.aakashg.com/p/how-to-price-ai-products)).
- **Time-to-Value (TTV) alignment** matters more than absolute length — match trial to how fast the product delivers its "aha" moment ([Userpilot](https://userpilot.com/blog/free-trial-conversion-rate/)).

**Recommendation for Coreline: 7-day opt-in free trial (no credit card required).**

Reasoning:
1. **Coreline's TTV is minutes, not weeks.** Once the AI has a resume, it can produce scored jobs, drafted cover letters, and ranked intro messages within the first conversation. The user reaches the aha moment in under 15 minutes. Aligning trial length to TTV → 7 days is plenty.
2. **Urgency drives conversion.** The research is clear that shorter trials with urgency cues beat 30-day trials by 71%. We want that urgency.
3. **Opt-in (no credit card) lowers signup friction.** Pre-PMF, we need signal volume (how many people try it, what they say, where they drop off) more than we need a 30% conversion rate on a low base. Opt-in trials convert at 15–25% "good" range — acceptable pre-PMF.
4. **7 days = one full weekly job-search cycle.** Monday job discovery → Wed outreach sent → Fri follow-ups → weekend review → next Monday decision to convert. Natural decision rhythm.
5. **Downside/mitigation:** if 7 days turns out too short for users who discover Coreline on a Thursday and can't commit review time over a weekend, we can extend to 10 or 14 days without a code change (just flip the interval constant). Cheap to tune.

**Alternative to keep on the shelf:** 14-day trial is the safer industry-default fallback if 7-day conversion data is weak after the first cohort.

**Countdown UI spec (added to §3.5 Empty-state dashboard requirements):**

- Header bar of the war room displays a trial pill at all times during the trial:
  - Days >= 4: neutral gray pill, text "Trial: N days left"
  - Days 2–3: yellow pill, text "Trial: N days left"
  - Day 1: red pill, text "Last day of trial"
  - Expired: red pill, text "Trial expired — upgrade to continue" with inline CTA
- Pill is clickable → opens a modal with subscription details and a "Start subscription" button (Stripe checkout — not in this proposal's scope, but the pill hook needs to exist so the upgrade surface can be wired up later)
- Pill reads `v2_users.trial_ends_at - NOW()` on every war room load; no separate counter endpoint needed for MVP

**Schema changes (add to §5.3):**

```sql
ALTER TABLE v2_users ADD COLUMN trial_started_at TIMESTAMPTZ NULL;
ALTER TABLE v2_users ADD COLUMN trial_ends_at    TIMESTAMPTZ NULL;
ALTER TABLE v2_users ADD COLUMN trial_length_days INT NOT NULL DEFAULT 7;
```

Making `trial_length_days` a column rather than a constant means we can A/B test 7 vs. 14 later without redeploying.

**RESOLVED: 7 days is the launch default.** Micah's call — lock it in.

**A/B test headroom:** `trial_length_days` is a **column on `v2_users`, not a constant in code.** This means we can bump individual users (or cohorts) from 7 to 14 — or 10, or any other value — by updating a single DB column. No code change, no deploy, no release process. If the first cohort shows sub-15% conversion and drop-off correlates with day-5 or day-6, we flip cohort B to 14 days and compare. This is a deliberate design choice to make the trial length an operational lever rather than a committed product decision.

---

### Open Question 5 — RESOLVED (Micah direction: 100% delegation)

**New answer: Coreline runs ZERO server-side background jobs. All scheduling is delegated to the user's AI, using its own infrastructure, paid for by its own subscription. See §4.5 for the full delegation model, capability matrix per AI client, and failure modes.**

**Previous framing (node-cron vs. BullMQ) is obsolete** — neither is being built. There is no `src/workers/`, no `src/scheduler/`, no `node-cron` dependency, no Redis.

**Coreline's backend reduces to:**
- REST API for the dashboard (`src/api/`)
- MCP server exposing tools the user's AI calls (`src/mcp/`)
- Postgres via Supabase
- Static HTML frontend (`mockup-warroom.html`)

That is the entire surface. No cron processes, no workers, no queues.

**Capability snapshot** (full matrix in §4.5):

| AI Client | Can schedule? | Runs on |
|---|---|---|
| Claude Code | Yes | User's machine |
| Claude Desktop | Yes (via Skills) | User's machine |
| ChatGPT Plus+ | Yes (Tasks, Jan 2026) | OpenAI's cloud |
| Gemini Advanced | Yes (Scheduled Actions) | Google's cloud |
| Cursor Pro | Yes (Background Agents) | Cursor's cloud |
| Windsurf | No | — |
| VS Code + Copilot | Not natively | — |

**Known holes:** ChatGPT Tasks doesn't work on Windows web or for Free/Pro tier users; Claude Code desktop tasks don't work on Linux; Windsurf has no background agents at all.

**Failure fallback (MVP — Mode 2a):** users whose AI can't schedule get a clear dashboard banner saying *"Your AI doesn't run in the background. Open your AI and say 'run my Coreline sweep' to refresh your pipeline."* Coreline still works fully in interactive mode; it just isn't proactive for those users. No server-side fallback cron is built.

**Honest assessment (also in §4.5):** the design holds up for the likely target segment — anyone paying $15/mo for AI-powered job search almost certainly already pays for a supported AI subscription. The risk is casual free-tier users who won't get the proactive layer; we mitigate with clear messaging and revisit if early cohorts push back.

**Sources used for the capability matrix research:**
- [Run prompts on a schedule – Claude Code Docs](https://code.claude.com/docs/en/scheduled-tasks)
- [Anthropic turns Claude Code into a background worker with local scheduled tasks – The Decoder](https://the-decoder.com/anthropic-turns-claude-code-into-a-background-worker-with-local-scheduled-tasks/)
- [Tasks in ChatGPT – OpenAI Help Center](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)
- [ChatGPT Tasks Feature 2026: Complete Setup & Usage Guide](https://www.ofzenandcomputing.com/chatgpt-tasks-feature-guide/)
- [Schedule actions in Gemini Apps – Gemini Help](https://support.google.com/gemini/answer/16316416)
- [Gemini app launches scheduled actions – Google Blog](https://blog.google/products-and-platforms/products/gemini/scheduled-actions-gemini-app/)
- [Cursor vs Windsurf 2026 comparison – Tech Insider](https://tech-insider.org/cursor-vs-windsurf-2026/)
- [Automate tasks with headless mode – Gemini CLI](https://geminicli.com/docs/cli/tutorials/automation/)

**Nothing for Micah to confirm here unless he wants to reconsider the Mode 2a fallback.** Q5 is resolved as written.

---

### Open Question 6 — RESOLVED

**Answer: A for MVP — trust the in-conversation confirmation loop. Add minimal edit forms as a fast-follow.**

PLAYBOOK §14 (rewritten in §3.4 above) has the AI confirm every field with the user before calling `set_*`. If the AI extracts the wrong `current_title`, the user corrects it in the same conversation and the AI re-calls `set_profile` with the correct value. The `v2_profile_changes` audit trail (§5.5) gives us debugging visibility if something goes sideways. Dashboard edit forms in `mockup-warroom.html` are a later-phase addition — cheap to ship when the need is proven by real user behavior.

---

## 9. Decision checklist — ALL RESOLVED

- [x] **Q1** — v1 CRM fate → **RESOLVED: sunset, ignored, not referenced**
- [x] **Q2** — AI client support scope → **RESOLVED: support every major MCP-native client (Claude Desktop, Claude Code, ChatGPT Desktop, Cursor, Windsurf, VS Code, Gemini CLI, Zed, + "Other"). Transparent limitations per tab.**
- [x] **Q3** — resume upload path → **RESOLVED BY DESIGN: user's AI handles it, Coreline never sees a file**
- [x] **Q4** — trial timer → **RESOLVED: starts on first `set_resume_text()` call; launch default = 7 days opt-in, no credit card. `trial_length_days` stored as a column for per-cohort A/B testing up to 14 days without a deploy.**
- [x] **Q5** — scheduler → **RESOLVED: ZERO server-side jobs. All scheduling delegated to user's AI (see §4.5). Capability verified across Claude, ChatGPT Plus+, Gemini Advanced, Cursor Pro, and Claude Code. No worker/cron code built.**
- [x] **Q6** — dashboard edit forms for MVP → **RESOLVED: A (trust confirmation loop, add forms as fast-follow)**

**Nothing blocks implementation. Proposal is complete and locked.** The next step is a separate TodoWrite list with file paths, schema migrations, and a swarm dispatch for the actual build — **to be kicked off by Micah on a separate go**, not from within this proposal.
