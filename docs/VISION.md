# Core Line 2.0 — Core Vision (North Star)

Core Line 2.0's product is the instructions the connected AI receives on MCP handshake. Core Line provides the rails (database, tools, timers, frontend). The connected AI does the thinking (research, writing, judgment). The playbook IS the product.

## Why this matters

Micah's original Friday setup worked because the AI did hours of homework per job. It read the JD line by line, researched the company (news, funding, launches), researched contacts (LinkedIn, background, mutual connections), picked the right resume variant, and wrote cover letters and outreach that sounded like a human who had actually done the work.

Template-based generation is explicitly rejected. Direct quote from Micah:

> "We can't write generic emails, we can't write generic cover letters, we can't write generic outreaches. It needs to completely focus on doing deep dive research for each one of these people, each one of these jobs."

If you ever find yourself writing generic content, stop. Re-read this document before every Core Line decision.

## The non-negotiables

1. No generic output, ever. Every cover letter, outreach draft, and follow-up is written fresh after research. It must reference specific company news, specific JD language, specific contact background. If the AI cannot do that for a job, the record is incomplete and should not be scored or acted on.

2. Browser-first job discovery. The connected AI has browser tools (puppeteer or equivalent) and is logged in as the user. It navigates LinkedIn, Indeed, and company pages directly, reads the JD on the page, researches company and contacts on-page, and calls bulk_import_jobs with a COMPLETE record. URL alone is not acceptable. The backend src/utils/jd-scraper.ts is a fallback only for public API boards (Greenhouse, Lever, Ashby, BambooHR).

3. Deep research before scoring. Fit scores are reasoned context, not a formula. The AI must read the JD line by line, research the company (recent news, funding, product launches, leadership changes), and research the contact (LinkedIn profile, background, prior roles, mutual connections) before assigning a score or writing anything.

4. Resume variants. Micah has 5 resume variants matched to job types. The AI picks the right variant per job based on the JD's theme and tailors further. Restoring these variants is a dependency. Flag if missing.

5. First-handshake welcome with capability check. On MCP connect, the AI introduces itself ("Hey Micah! Core Line is live and connected. Here's what I'm set up to do for you..."), runs a capability check (browser tools, Gmail access, file access, web search), reports what's live and what's missing, and lays out the plan. No silent failures. If a capability is missing, the AI tells the user plainly and points to how to install or enable it.

6. Email monitoring on a cadence. Five scans: inbox replies, sent (manual outreach the user sent themselves), archived (missed/buried replies from the last 5 days), bounces and delivery failures, and social signals (LinkedIn accepts, DMs, InMails). Bounces and social signals are first-class scans, not buried in a keyword-filtered inbox sweep.

7. Hot Signals. Anything the AI discovers between morning summaries that is too urgent to wait for tomorrow gets written to v2_hot_signals with a pre-drafted next action. Examples: a CEO accepts your LinkedIn invite on application day, an outreach email bounces, a positive reply lands at 2pm. Every hot signal comes with a recommended action, never just an FYI.

8. Follow-up with full context loading. No follow-up is written cold. Before writing, reload the original outreach, contact background, company news since last touch, the job record, and any prior replies. Business-day timer: 3 days, then 5 days, then escalate to a different contact, then archive at 14 days.

9. Button behaviors. Apply opens the URL only. Done is the real commit (status update, timers, outreach send, confirmation).

10. New user onboarding. For empty profiles, the AI runs a day-one workflow before there is any data. This is what makes Core Line work for every new user automatically, not just Micah.

11. No em dashes in any user-facing writing, ever. Em dashes are an AI tell. Use commas, periods, parentheses, or restructure the sentence.

## Delivery mechanism

The full playbook is delivered via the server-level MCP `instructions` field in createMCPServer() in src/mcp/server.ts. Every connected AI auto-receives it on handshake. Not just via a tool call. The detailed playbook lives in docs/PLAYBOOK.md (or docs/PLAYBOOK_DRAFT.md while in review).

## The test

If you can take any cover letter, outreach draft, or follow-up produced by Core Line and ask "does this sound like a human did hours of homework?" and the answer is no, Core Line failed that interaction. Fix the playbook, fix the research step, fix the tools. But do not ship generic output.
