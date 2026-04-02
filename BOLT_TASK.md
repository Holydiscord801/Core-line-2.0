You are Bolt, Micah Baird's senior engineering AI. You are building Coreline v2 from scratch. This is a greenfield build -- no legacy constraints. Build it right.

=== VISION ===
Coreline v2 is the AI-native backend for job search. NOT a manual CRM. The AI is the primary user; humans just watch the dashboard.

Core truth: Relationships first. Jobs second. Coreline tracks both.

The product:
- User uploads resume, sets preferences (role, salary floor, location, remote/hybrid)
- Overnight AI agent scans jobs, scores them against resume, identifies key relationships to build
- Morning battle plan delivered: "12 jobs, here are 8 people to reach out to, here are the draft messages"
- AI monitors email for responses, auto-updates pipeline
- Follow-up nudges: "3 days since you contacted Sarah at Stripe -- here's a draft check-in"
- MCP server: any AI (Claude, ChatGPT, Gemini, OpenClaw) connects with an API key and operates it

Decisions locked:
1. No built-in AI -- bring your own (we are infrastructure, not a brain)
2. Pricing: low ($9-15/mo), we just cover Supabase + hosting
3. Job scanning: tiered -- public APIs for any AI, browser automation for AIs with computer control
4. Autopilot: opt-in only -- we store and expose data, user's AI decides what to do

=== SUPABASE ===
Project URL: https://hazsxuznwftwagpbuhre.supabase.co
Service role key: read /home/micah/clawd/.env.friday and find line starting with SUPABASE_SERVICE_ROLE_KEY=
Use v2_ prefix on all tables to avoid touching existing v1 tables.

=== BUILD THIS -- PHASE BY PHASE ===

PHASE 1: Project scaffold
Create package.json (name: coreline-v2, Node 20, TypeScript, deps: @supabase/supabase-js, @modelcontextprotocol/sdk, express, cors, dotenv, zod; devdeps: typescript, @types/node, @types/express, ts-node, nodemon)
Create tsconfig.json (ES2022, NodeNext modules, strict mode, outDir: dist)
Create .env.example with: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT=3001, JWT_SECRET
Create .gitignore (node_modules, dist, .env)
Run: npm install

PHASE 2: Supabase schema
Create /supabase/migrations/001_v2_schema.sql with ALL these tables:

v2_users: id uuid pk default gen_random_uuid(), auth_user_id uuid unique references auth.users, email text, full_name text, resume_text text, preferences jsonb, created_at timestamptz default now(), updated_at timestamptz default now()

v2_jobs: id uuid pk default gen_random_uuid(), user_id uuid references v2_users, title text, company text, url text, description text, salary_min int, salary_max int, location text, remote bool default false, status text default 'new', fit_score int, source text, notes text, posted_at timestamptz, applied_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()

v2_contacts: id uuid pk default gen_random_uuid(), user_id uuid references v2_users, name text not null, title text, company text, linkedin_url text, email text, phone text, relationship_type text, notes text, created_at timestamptz default now(), updated_at timestamptz default now()

v2_job_contacts: id uuid pk default gen_random_uuid(), job_id uuid references v2_jobs on delete cascade, contact_id uuid references v2_contacts on delete cascade, relevance_notes text, created_at timestamptz default now()

v2_outreach: id uuid pk default gen_random_uuid(), user_id uuid references v2_users, job_id uuid references v2_jobs, contact_id uuid references v2_contacts, channel text, message_text text, sent_at timestamptz default now(), response_received bool default false, response_text text, response_at timestamptz, outcome text, created_at timestamptz default now()

v2_battle_plans: id uuid pk default gen_random_uuid(), user_id uuid references v2_users, plan_date date not null, jobs_found int default 0, contacts_identified int default 0, plan_data jsonb, ai_prompt_used text, generated_at timestamptz, created_at timestamptz default now()

v2_followups: id uuid pk default gen_random_uuid(), user_id uuid references v2_users, job_id uuid references v2_jobs, contact_id uuid references v2_contacts, due_date date not null, reason text, priority text default 'medium', status text default 'pending', snoozed_until date, created_at timestamptz default now(), updated_at timestamptz default now()

v2_api_keys: id uuid pk default gen_random_uuid(), user_id uuid references v2_users, name text not null, key_hash text unique not null, key_prefix text not null, last_used_at timestamptz, created_at timestamptz default now()

Add RLS: enable row level security on all tables, add policies so users can only access their own rows.
Add indexes: on user_id, status, due_date, plan_date, created_at.

PHASE 3: Supabase client + TypeScript types
Create /src/lib/supabase.ts -- Supabase admin client from env vars
Create /src/types/index.ts -- TypeScript interfaces for all v2 tables

PHASE 4: MCP Server at /src/mcp/server.ts
Use @modelcontextprotocol/sdk to create a fully compliant MCP server.
Transport: stdio (for Claude Desktop / OpenClaw connection).
Auth: API key lookup in v2_api_keys table, passed via environment variable CORELINE_API_KEY.

Implement these 12 tools with excellent descriptions (external AIs read these to understand capabilities):

1. get_profile -- Returns user profile: resume summary, preferences, salary floor, target roles/locations/industries. No params.

2. get_battle_plan -- Returns AI-generated battle plan. Param: date (string, optional, default today YYYY-MM-DD). Returns jobs found, contacts to reach, priority actions for the day.

3. get_jobs -- Returns jobs pipeline. Params: status (string, optional: new/researching/applied/interviewing/offer/closed/rejected), limit (number, optional, default 20). Returns id, title, company, salary range, fit_score, status, location, remote, applied_at.

4. get_contacts -- Returns contacts. Param: job_id (string, optional). If provided, returns only contacts linked to that job. Returns id, name, title, company, relationship_type, linkedin_url, email.

5. update_job_status -- Updates a job status. Params: job_id (string required), status (string required), notes (string optional). Also sets applied_at when status becomes 'applied'.

6. log_outreach -- Records an outreach action and auto-creates a followup. Params: job_id (string required), contact_id (string required), channel (string required: email/linkedin/phone), message_text (string required). Auto-creates followup due in 3 days.

7. get_followups_due -- Returns pending follow-ups. Param: days_ahead (number, optional, default 7). Returns followup id, job info, contact info, due_date, reason, days_since_outreach.

8. add_job -- Adds a new job to pipeline. Params: title, company, url (all required), salary_min, salary_max, location, remote, notes (all optional). Sets status to 'new'.

9. add_contact -- Adds a contact, optionally links to job. Params: name, title, company, relationship_type (all required), job_id, linkedin_url, email, notes (all optional).

10. get_pipeline_summary -- Returns stats: jobs by status (object), total_applied, response_rate (%), interview_rate (%), overdue_followups count, active_relationships count.

11. mark_outreach_response -- Records a response received. Params: outreach_id (string required), response_text (string required), outcome (string required: no_response/positive/negative/interview_scheduled/referred). If outcome is interview_scheduled, updates linked job status to 'interviewing'.

12. snooze_followup -- Snoozes a followup reminder. Params: followup_id (string required), days (number required). Updates due_date and sets status to 'snoozed'.

Create /src/mcp/index.ts as entry point.

PHASE 5: REST API at /src/api/
Create Express app with these routes:
- GET/POST /api/jobs
- GET/PUT/PATCH /api/jobs/:id
- GET/POST /api/contacts
- POST /api/outreach, GET /api/outreach
- GET /api/battle-plan, POST /api/battle-plan/generate
- GET /api/followups, PATCH /api/followups/:id
- GET /api/summary
- POST /api/auth/api-key (generates new API key, returns raw key once)

Auth middleware: accepts Bearer JWT (Supabase) or Bearer API key (v2_api_keys lookup).

Create files:
/src/api/middleware/auth.ts
/src/api/routes/jobs.ts
/src/api/routes/contacts.ts
/src/api/routes/outreach.ts
/src/api/routes/battleplan.ts
/src/api/routes/followups.ts
/src/api/routes/summary.ts
/src/api/routes/auth.ts
/src/api/server.ts

PHASE 6: Entry points + config
/src/index.ts -- starts REST API
package.json scripts: start (node dist/index.js), dev (nodemon src/index.ts), build (tsc), mcp (node dist/mcp/index.js)
vercel.json -- route all requests to Express
README.md -- what Coreline v2 is, how to connect Claude Desktop via MCP (example config block), how to get an API key, available MCP tools list

PHASE 7: Commit
git add -A
git commit -m "feat: Coreline v2 -- MCP server, REST API, Supabase schema, full TypeScript foundation"

IMPORTANT: When you are completely finished with all 7 phases and the commit is done, run this exact command:
openclaw system event --text "Done: Bolt finished Coreline v2 foundation" --mode now
