# Deep Dive Job Search Re-Run: 2026-04-07

Four VP/Director Engineering roles re-investigated after previous subagents crashed or failed to write results. This is the second pass.

Source allowlist: linkedin, indeed, greenhouse, workday, direct (company careers page).
Blacklisted: Lever (jobs.lever.co), Built In (builtin.com), Ashby (jobs.ashby.com / ashbyhq.com), Gem (jobs.gem.com).

---

## 1. TrueML -- VP Software Engineering

**v2_jobs id:** f51450e1-b43f-4138-9ca4-d8fd80b7a5b0

**VERDICT: STILL CLOSED**

### What was searched

- trueml.com/careers (fetch): redirects to jobs.lever.co/trueml
- LinkedIn jobs: `site:linkedin.com/jobs "TrueML" "VP"`, `"TrueML" "VP Software Engineering"`, `"TrueML" engineering` -- all returned zero company-specific results for VP Engineering
- Indeed: indeed.com/cmp/Trueml/jobs -- page exists but all listings link back to Lever
- Greenhouse: site:boards.greenhouse.io "TrueML" -- no results
- Workday: no TrueML Workday presence found
- ZipRecruiter: listing at ziprecruiter.com/c/TrueML/Job/VP-of-Software-Engineering -- confirmed this is a mirror, deep-links to jobs.lever.co
- The Org engineering team page: no VP of Engineering or Director of Engineering listed; current eng leadership is three Engineering Managers (Chris Bojarski, Dmitry Sabanin, Richard Attfield)

### What was found

The VP Software Engineering role is confirmed live on Lever at:
`https://jobs.lever.co/trueml/9704c77e-3ea6-429d-8532-93d0b9d90784`

Salary range: $225k-$325k. TrueML exclusively uses Lever as their ATS. All job aggregators (ZipRecruiter, Indeed) redirect to the Lever posting. No LinkedIn Jobs posting exists for this role.

### Cross-check on role filled

The Org shows no VP/Director of Engineering currently placed at TrueML. The role appears genuinely open but inaccessible via allowed sources.

### Supabase action

No URL or source change. Notes field updated with full audit trail. Status remains `closed`.

---

## 2. Cobalt AI -- VP of Engineering

**v2_jobs id:** 5b64ff93-c105-4820-b23b-c8e424a73350

**VERDICT: FOUND -- new URL patched**

**New URL:** https://www.linkedin.com/jobs/view/vice-president-of-engineering-at-cobalt-ai-4390028161

### Company disambiguation

The original DB entry described Cobalt AI as "medical imaging / radiology AI." That is incorrect. Cobalt AI (LinkedIn: company/just-cobalt-ai) is a **physical security AI company** that makes Cobalt Monitoring Intelligence, a hybrid cloud/edge platform for AI-powered monitoring of surveillance cameras, alarms, and access control systems across enterprise locations. This is NOT a radiology or healthcare company.

There is no Cobalt AI medical imaging company with an active VP Engineering posting. The physical security Cobalt AI is the entity that matches the existing DB record (same company the original Built In link pointed to).

### What was searched

- cobalt.ai (fetch): redirects to physical security cobalt.ai homepage, confirmed not medical imaging
- cobaltai.com: this is a different physical security robotics company, not relevant
- LinkedIn company page (company/just-cobalt-ai): enumerated current job postings
- site:linkedin.com/jobs "Cobalt AI" engineering (search): found two active VP Engineering listings
- BambooHR direct URL (cobaltai.bamboohr.com/careers/81): returned 403; posting may have been pulled from BambooHR since it was distributed via Built In
- site:boards.greenhouse.io "Cobalt AI": no results
- site:indeed.com "Cobalt AI" VP Engineering: no specific results

### What was found

Two active LinkedIn VP of Engineering postings at Cobalt AI:

1. **Denver, Colorado** (used for DB update):
   https://www.linkedin.com/jobs/view/vice-president-of-engineering-at-cobalt-ai-4390028161
   - Posted: 2026-03-25
   - Expires: 2026-04-24
   - 128+ applicants at time of retrieval
   - Salary: $240k-$300k + equity

2. **San Francisco Bay Area** (secondary listing):
   https://www.linkedin.com/jobs/view/vice-president-of-engineering-at-cobalt-ai-4390609637
   - Posted: 2026-03-25
   - Same role, same salary range

### Cross-check on role filled

Role is actively open and accepting applicants per LinkedIn.

### Supabase action

PATCHed:
- `url` = https://www.linkedin.com/jobs/view/vice-president-of-engineering-at-cobalt-ai-4390028161
- `source` = linkedin
- `status` = new
- `notes` = updated with disambiguation and second LinkedIn URL
- `updated_at` = 2026-04-07T19:44:33Z (confirmed)

---

## 3. Bedrock Security -- Director/VP of Engineering

**v2_jobs id:** 491e185b-b638-4c1e-b6a5-5647db74aec1

**VERDICT: STILL CLOSED**

### What was searched

- bedrock.security/careers (fetch): **301 redirect to bedrockdata.ai/careers** -- this is Bedrock Data, a completely different company. The redirect is a domain collision, not the same company.
- bedrock.engineering (fetch): returns Bedrock Security landing page but no jobs page found at that domain
- jobs.ashbyhq.com/bedrock (fetch): confirms Ashby as the ATS; page requires JavaScript so full board is not enumerable via WebFetch, but URL structure confirms Ashby
- jobs.ashbyhq.com/bedrock/cd5ced16-720f-41c2-9038-1507e173f255 (fetch): Ashby single-posting URL; requires JavaScript to render, confirmed Ashby-hosted
- site:linkedin.com/jobs "Bedrock Security" engineering: **zero results**
- site:linkedin.com/jobs "Bedrock Security" Director OR VP: **zero results**
- site:indeed.com "Bedrock Security" Director Engineering: **zero results** (Indeed search returned "no jobs found" for bedrock security)
- site:boards.greenhouse.io "Bedrock Security": no results
- Greylock portfolio board jobs.greylock.com/jobs/bedrock-security: exists but links back to Ashby
- Workday: no results
- site:linkedin.com "Bedrock Security" "Director of Engineering": only returned Jonas Pfoh (Director of Security Engineering at BedRock Systems -- a different company)

### What was found

Every search path for a Director/VP Engineering listing at Bedrock Security leads back to:
`https://jobs.ashbyhq.com/bedrock/cd5ced16-720f-41c2-9038-1507e173f255`

This is the only live posting and it is on Ashby (blacklisted). The company posts exclusively on Ashby and does not mirror roles to LinkedIn or Indeed.

### Cross-check on role filled

The Org page for Bedrock Security shows Pranava Adduri as Co-founder and CTO. No VP/Director of Engineering is listed as currently placed. The role appears genuinely open.

### Supabase action

No URL change. Notes field updated with full audit trail including the bedrock.security redirect issue. Status remains `closed`.

---

## 4. Helm Health -- VP of Engineering

**v2_jobs id:** f9074dba-ec84-4beb-9e22-fa9bf0bdcc3f

**VERDICT: STILL CLOSED -- status corrected from 'new' to 'closed'**

### What was searched

- helmhealth.com/careers (fetch): **404**
- helmhealth.com (fetch): homepage exists; company is health insurance tech, 11-50 employees, $14.3M raised, Columbus OH / New York NY
- jobs.gem.com/helm-health (fetch): Gem job board landing page for Helm Health -- standard Gem marketing page, no source ATS link exposed
- jobs.gem.com/helm-health/am9icG9zdDoKtsABCD57ywd8Dsw77p2M (the specific URL): Gem posting page; fetched content shows Google Analytics / Bootstrap only, no ATS source link visible. Gem does not expose the originating ATS URL in its HTML.
- site:linkedin.com/jobs "Helm Health" VP of Engineering: **zero results**
- site:linkedin.com/jobs "Helm Health" engineering: **zero results**
- site:boards.greenhouse.io "Helm Health": **zero results**
- site:indeed.com "Helm Health" VP Engineering: **zero results**
- wellfound.com/company/helm-health-1 (fetch): 403
- careers.flarecapital.com/companies/helm-health (fetch): shows "10 active jobs" at Helm Health, Software Engineering function listed, but individual job titles and URLs are not in the renderable HTML (JavaScript-rendered content)
- WellFound search results: shows a "Data Integration Engineer" listing for Helm Health (Dec 2025), but no VP Engineering

### What was found

The existing DB record has `apply_links` pointing to `builtin.com/job/vp-engineering/8890563` (Built In -- blacklisted). The Gem URL in the `url` field is a sourcing/outreach tool, not a canonical job posting. The notes field already stated "removed 2026-04-07 per source allowlist."

No VP Engineering posting for Helm Health was found on any allowed source. The company is very small (19 employees as of early 2026) and appears to source this role passively through outreach tools rather than public job boards. The role may still be open but is not posted publicly on any allowed platform.

### Cross-check on role filled

LinkedIn search for Helm Health engineering leadership returned Ross Klosterman (MPH -- likely clinical, not engineering) and company page employees, but no VP Engineering profile. Role likely still open but sourced via Gem/passive channels.

### Supabase action

PATCHed:
- `status` = closed (was incorrectly 'new' despite having a Gem/blacklisted URL)
- `notes` = updated with full audit trail
- `updated_at` = 2026-04-07T19:44:53Z (confirmed)

---

## Summary Table

| Company | v2_jobs id (short) | Previous source | Result | New URL | Supabase change |
|---|---|---|---|---|---|
| TrueML | f51450e1 | Lever (blacklisted) | STILL CLOSED | n/a -- Lever only | notes updated |
| Cobalt AI | 5b64ff93 | Built In (blacklisted) | FOUND on LinkedIn | linkedin.com/jobs/view/...4390028161 | url + source + status = new |
| Bedrock Security | 491e185b | Built In (blacklisted) | STILL CLOSED | n/a -- Ashby only | notes updated |
| Helm Health | f9074dba | Gem (blacklisted) | STILL CLOSED | n/a -- no public posting | status corrected to closed |

---

## Notes on company disambiguation

**Cobalt AI:** The DB record's company description ("medical imaging / radiology AI") was incorrect. The actual company is Cobalt AI, a workplace physical security platform. This was verified via their LinkedIn company page (just-cobalt-ai), their website, the Built In job listing, and the LinkedIn VP Engineering posting content. No radiology/medical-imaging Cobalt AI company with an active VP Engineering role was found anywhere.

**Bedrock Security / Bedrock Data:** bedrock.security 301-redirects to bedrockdata.ai. These are different companies. Bedrock Security (bedrocksec on LinkedIn, backed by Greylock) is a data security startup. Bedrock Data is an unrelated data integration company. The redirect is a DNS/domain issue and does not indicate the companies are related.
