# Coreline v2

**Display + data + MCP server. That's it.**

Coreline is the war room. Your AI is the operator.

You bring your own AI (Claude, ChatGPT, Gemini, OpenClaw -- anything). It connects to the Coreline MCP server, reads the playbook, and runs your job search for you. It checks your email, creates Gmail drafts, researches contacts, scores jobs, and updates the battle plan. Coreline never touches your credentials and never pays for AI compute.

The playbook -- delivered to your AI on every connection -- is the intelligence. Coreline is the infrastructure.

## Architecture

- **MCP Server** -- your AI connects here. Reads the playbook on handshake, calls tools to update pipeline, log outreach, create hot signals, manage battle plan
- **REST API** (Express) -- powers the warroom UI and any direct integrations
- **Supabase** -- Postgres with RLS, auth, real-time
- **Warroom UI** -- beautiful display of everything your AI is doing

### What Coreline builds
- MCP tools (clean, well-documented, stable)
- Warroom UI (display layer)
- The playbook (the IP that makes AIs effective)
- Onboarding docs (how to connect your AI, how to set up crons, what to expect)

### What Coreline never builds
- Gmail/email integration (your AI handles this with its own access)
- LinkedIn scraping (your AI handles this)
- AI inference or model hosting
- OAuth for third-party services
- Cron job infrastructure (your AI or your OpenClaw instance runs the crons)

## Setup

```bash
npm install
cp .env.example .env
# Fill in your Supabase URL and service role key
```

Run the Supabase migration:

```sql
-- Execute supabase/migrations/001_v2_schema.sql against your Supabase project
```

### Development

```bash
npm run dev     # REST API with hot reload
npm run build   # Compile TypeScript
npm start       # Production server
```

### MCP Server

```bash
npm run mcp     # Start MCP server (stdio transport)
```

## Connecting Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "coreline": {
      "command": "node",
      "args": ["/path/to/coreline-v2/dist/mcp/index.js"],
      "env": {
        "CORELINE_API_KEY": "cl_your_api_key_here",
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```

## Getting an API Key

```bash
curl -X POST http://localhost:3001/api/auth/api-key \
  -H "Authorization: Bearer <your_supabase_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-ai-agent"}'
```

The raw API key is returned once. Store it securely.

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_profile` | User profile, resume summary, preferences |
| `get_battle_plan` | Daily battle plan -- jobs, contacts, priority actions |
| `get_jobs` | Job pipeline with status filter |
| `get_contacts` | Network contacts, optionally filtered by job |
| `update_job_status` | Move a job through the pipeline |
| `log_outreach` | Record outreach, auto-creates 3-day followup |
| `get_followups_due` | Pending follow-ups for the next N days |
| `add_job` | Add a new job to the pipeline |
| `add_contact` | Add a contact, optionally link to a job |
| `get_pipeline_summary` | Stats: jobs by status, response rate, interview rate |
| `mark_outreach_response` | Record a response, auto-updates job if interview scheduled |
| `snooze_followup` | Snooze a followup reminder for N days |

## REST API

All routes require `Authorization: Bearer <api_key_or_jwt>`.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/jobs` | List jobs |
| POST | `/api/jobs` | Create job |
| GET | `/api/jobs/:id` | Get job |
| PATCH | `/api/jobs/:id` | Update job |
| GET | `/api/contacts` | List contacts |
| POST | `/api/contacts` | Create contact |
| POST | `/api/outreach` | Log outreach |
| GET | `/api/outreach` | List outreach |
| GET | `/api/battle-plan` | Get battle plan |
| POST | `/api/battle-plan/generate` | Create/update battle plan |
| GET | `/api/followups` | List due followups |
| PATCH | `/api/followups/:id` | Update/snooze followup |
| GET | `/api/summary` | Pipeline summary stats |
| POST | `/api/auth/api-key` | Generate new API key |
| GET | `/health` | Health check (no auth) |
