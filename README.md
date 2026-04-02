# Coreline v2

AI-native backend for job search. The AI is the primary user; humans watch the dashboard.

Coreline tracks relationships and jobs. An overnight AI agent scans opportunities, scores them against your resume, identifies key relationships, and delivers a morning battle plan with draft messages. Follow-up nudges keep your pipeline moving.

## Architecture

- **MCP Server** (stdio) -- any AI (Claude Desktop, OpenClaw, etc.) connects and operates your job pipeline
- **REST API** (Express) -- for dashboards, mobile apps, or direct integration
- **Supabase** -- Postgres database with RLS, auth, and real-time

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
