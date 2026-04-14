# Core Line 2.0 Email Monitoring Scan
**Date:** 2026-04-07
**Scope:** Last 7 days (2026-03-31 to 2026-04-07), with 30-day lookback for bounces
**user_id:** 349f82a7-2fd8-4d14-b309-ec94fb352b7a

---

## 1. Headline

**MOST URGENT:** Emily Hansen (BambooHR Recruiting Coordinator) sent an unread LinkedIn DM -- active interview thread, unanswered recruiter message is a real risk. Four confirmed hot bounces also need immediate re-verification before outreach is lost.

---

## 2. Bounces (Track 2) -- URGENT

Gmail live scan was **blocked: gmail_search_messages MCP tools are not connected in this Claude Code environment.** The bounce data below is sourced from `v2_hot_signals` rows already in Supabase from a prior scan today (2026-04-07). A live Gmail bounce scan is still needed.

### Hot Bounces (severity=hot)

| Bounced Address | Company | Original Subject | Date | Action |
|---|---|---|---|---|
| Girish Naganathan | Dexcom | Sr Director Algorithm Engineering outreach | pre-2026-04-07 | Find correct email -- LinkedIn message or mutual contact |
| Chris Brown | Evermore Health (sodahealth.com) | VP Engineering outreach | pre-2026-04-07 | Domain appears dead -- verify company is still operating before re-send |
| Ryan Byrd | Pattern | Outreach | pre-2026-04-07 | Search LinkedIn for current email or DM directly |
| Tom Sharpless | Conspicuous | Outreach | pre-2026-04-07 | Verify address and resend |

### Warm Bounces (severity=warm)

| Bounced Address | Company | Notes | Action |
|---|---|---|---|
| Even Realities contact | Even Realities | .bio TLD typo suspected | Verify correct domain and resend |
| Andrew Parry | OD Corp | Soft bounce or bad address | Confirm and retry |

**Re-verification recs:** For every hot bounce, go to LinkedIn, look up the person, and either (a) DM directly or (b) find a colleague who can forward. Do not let Dexcom or Evermore rot -- both are active pipeline entries.

---

## 3. Social Signals (Track 3) -- Warm Intros First

Gmail live scan blocked (same reason as above). Data from `v2_hot_signals`.

### Hot: LinkedIn Accepts with Cross-Reference Match

| Person | Company | Role | Signal | Job in DB | Action |
|---|---|---|---|---|---|
| Dan Lorenc | Chainguard | CEO | Accepted connection (2 signals: 1 actioned, 1 still new) | Yes -- `024a99c7`, VP Engineering, status=applied | DM Dan directly. This is a CEO-level warm intro on an active application. Send a 3-sentence message referencing what excites you about Chainguard's supply chain security work. |

**Cross-reference note:** Dan Lorenc is CEO of Chainguard which has an open VP Engineering role in DB. This is the highest-leverage warm intro available right now.

### Hot: LinkedIn DMs (Unread)

| Person | Company | Signal | Action |
|---|---|---|---|
| Emily Hansen | BambooHR | Unread DM -- likely scheduling or info request tied to active VP of Technology application | **Read and reply immediately.** BambooHR has an active interview thread. Unanswered recruiter DM during active pipeline is a real risk. |
| Simone Turner | Unknown | 3-DM barrage | Read all three DMs. Volume suggests genuine interest or follow-up. Triage and respond. |

### Warm: Recruiter InMails

None logged separately in current signals -- may be captured in inbox sweep or missed without Gmail access.

### Background: Profile Views / Endorsements

Not surfaced in current signals. Live Gmail scan would catch LinkedIn notification digests.

---

## 4. Inbox Sweep (Track 1) -- By Sentiment

Gmail live scan blocked. Data from `v2_hot_signals`.

### Positive (inbox_reply_positive)

| Company | Summary | Action |
|---|---|---|
| BambooHR | Active interview thread (VP of Technology, `b06faa85`) | Status in DB is still "applied" -- update to "interviewing". Prep for next stage. Check Emily Hansen DM immediately. |

### Negative (inbox_reply_negative)

| Company | Summary | Action |
|---|---|---|
| Iron Mountain | Rejection (Director role, `f5d5b60c`) | Update job status to "closed". No action needed unless you want to request feedback. |

### Neutral / No Data

Without Gmail live access, full inbox sweep (recruiter outreach, scheduling requests, offer signals) could not be executed. This is a gap -- run the scan manually or connect Gmail MCP.

---

## 5. Sent and Archived Sweep (Track 4)

Gmail live scan blocked. Data from `v2_hot_signals` (sent_outreach_captured signals).

### Outreach Without Contact Rows

| Person | Company | Gap | Action |
|---|---|---|---|
| Shirish Puranik | SailPoint | Outreach sent today (ac0d7e99 -- SailPoint Sr Dir/VP PM Agentic), no contact row | Add to v2_contacts |
| Dan Hu | Even Realities | Multi-touch outreach, zero DB rows | Add contact + job row |
| David Yu | Even Realities | Same thread as Dan Hu | Add contact row |
| Jonathan Rosenberg | Unknown | Email outreach, no contact row | Backfill v2_contacts |
| Taylor Wetzel | Unknown | Email outreach, no contact row | Backfill v2_contacts |
| Kevin Charles | Unknown | Email outreach, no contact row | Backfill v2_contacts |

### Archived Replies Found

No archived_reply_found signals in current hot_signals set. Cannot confirm without Gmail access.

---

## 6. v2_hot_signals Rows Inserted This Run

**0 new rows inserted.** Gmail MCP tools were unavailable -- no live scan was performed.

The `v2_hot_signals` table already contains **17 rows** from a prior scan run earlier today (2026-04-07), all with `status=new` except one marked `actioned`. Those 17 rows are the basis for this report.

---

## 7. Things Micah Probably Missed

1. **Emily Hansen DM on LinkedIn.** If you haven't checked LinkedIn today, you may not know she messaged. Go look right now before the BambooHR window closes.

2. **Dan Lorenc Chainguard accept has TWO signals -- one still status=new.** The actioned one is resolved but the duplicate new signal should be dismissed or merged to avoid confusion.

3. **Evermore Health domain (sodahealth.com) may be dead.** Before spending time re-verifying Chris Brown's email, first confirm the company is still operating and the VP Engineering role is still open.

4. **Even Realities contact gap is significant.** Multi-touch email outreach with no contact or job row means you have no pipeline visibility on that opportunity. Add it manually.

5. **Gmail MCP is not connected.** This scan was heavily degraded. Without gmail_search_messages access, all four tracks were blind to live inbox data. The full scan will surface many more signals (recruiter InMails, scheduling emails, additional replies, new bounces) once Gmail is wired up. See setup notes below.

6. **BambooHR job status is stale.** DB shows "applied" but signals indicate active interview thread. Update to "interviewing" so it surfaces correctly in dashboard views.

7. **Shirish Puranik outreach sent today to SailPoint with no contact row.** If he replies, you have no Supabase linkage to surface it. Add the contact row now.

---

## Setup: Connect Gmail MCP

To enable full live scanning in future runs, connect a Gmail MCP server to Claude Code:

```bash
# Option 1: Google Workspace MCP (official)
# Add to ~/.claude/settings.json mcpServers section

# Option 2: community gmail server
npx @anthropic-ai/create-mcp-server gmail
# Follow OAuth flow for your Google account
```

Once connected, `gmail_search_messages`, `gmail_read_message`, and `gmail_read_thread` tools will be available and the full four-track scan will run without degradation.

---

*Generated by Core Line 2.0 email monitoring scan -- 2026-04-07*
*Gmail tracks 1-4: BLOCKED (MCP unavailable)*
*Supabase cross-reference: COMPLETE (52 jobs, 68 contacts, 17 existing hot signals)*
