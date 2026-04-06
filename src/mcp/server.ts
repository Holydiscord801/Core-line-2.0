import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import type {
  V2User,
  V2Job,
  V2Contact,
  V2BattlePlan,
  V2Followup,
  V2Outreach,
  JobStatus,
  OutreachChannel,
  OutreachOutcome,
  RelationshipType,
  PipelineSummary,
  SearchJobsParams,
  ScoreJobParams,
  ScoreResult,
  VerifyPostingParams,
  GenerateOutreachParams,
  CreateGmailDraftParams,
  CheckEmailResponsesParams,
  BulkImportJobsParams,
  TimerType,
  PostingStatus,
} from '../types/index.js';
import crypto from 'crypto';

// ============================================
// Authentication
// ============================================

let currentUserId: string | null = null;

async function authenticateApiKey(apiKey: string): Promise<string | null> {
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const { data, error } = await supabase
    .from('v2_api_keys')
    .select('user_id')
    .eq('key_hash', keyHash)
    .single();

  if (error || !data) {
    return null;
  }

  // Update last_used_at
  await supabase
    .from('v2_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', keyHash);

  return data.user_id;
}

function requireAuth(): string {
  if (!currentUserId) {
    throw new Error('Not authenticated. Please provide a valid API key.');
  }
  return currentUserId;
}

// ============================================
// Tool Definitions
// ============================================

const tools: Tool[] = [
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
    description: 'Returns the AI-generated daily battle plan for job searching. Includes: jobs discovered that day, contacts identified to reach out to, priority actions ranked by impact, and draft messages. Default is today\'s plan. Use this each morning to see what actions to take.',
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
    description: 'Returns follow-up reminders due in the next N days. Includes: who to contact, which job it relates to, why follow-up is needed, days since last contact, and priority level. Default is 7 days ahead. Use this to stay on top of relationship nurturing.',
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
    description: 'Returns all sent outreach messages that have not received a response yet. The AI should:\n1. Check Gmail INBOX for replies to these threads\n2. Check Gmail SENT folder for outreach emails to known contacts (to detect when Micah sends outreach manually)\n3. Check Gmail ARCHIVED/ALL MAIL for missed replies\n\nFor inbox replies from known contacts: call mark_outreach_response() with the outcome.\nFor sent emails to known contacts not yet tracked: call log_outreach() to create the record, then this will auto-generate a follow-up timer.\n\nRun this every 2 hours during work hours.',
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
];

// ============================================
// Tool Implementations
// ============================================

async function getProfile(): Promise<V2User> {
  const userId = requireAuth();

  const { data, error } = await supabase
    .from('v2_users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error('User profile not found');
  }

  return data as V2User;
}

async function getBattlePlan(date?: string): Promise<V2BattlePlan | null> {
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

  return data as V2BattlePlan | null;
}

async function getJobs(status?: JobStatus, limit: number = 20): Promise<V2Job[]> {
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

  return data as V2Job[];
}

async function getContacts(jobId?: string): Promise<V2Contact[]> {
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

    return (data || []).map((jc: any) => jc.v2_contacts) as V2Contact[];
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

  return data as V2Contact[];
}

async function updateJobStatus(jobId: string, status: JobStatus, notes?: string): Promise<V2Job> {
  const userId = requireAuth();

  const updateData: any = {
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

  return data as V2Job;
}

async function logOutreach(
  jobId: string,
  contactId: string,
  channel: OutreachChannel,
  messageText: string
): Promise<V2Outreach> {
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

  return outreach as V2Outreach;
}

async function getFollowupsDue(daysAhead: number = 7): Promise<any[]> {
  const userId = requireAuth();

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysAhead);

  const { data, error } = await supabase
    .from('v2_followups')
    .select(`
      *,
      v2_jobs (id, title, company),
      v2_contacts (id, name, title, company)
    `)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lte('due_date', endDate.toISOString().split('T')[0])
    .order('due_date', { ascending: true });

  if (error) {
    throw new Error(`Error fetching follow-ups: ${error.message}`);
  }

  // Enrich with days since last contact
  const enriched = await Promise.all(
    (data || []).map(async (followup: any) => {
      if (followup.contact_id) {
        const { data: lastOutreach } = await supabase
          .from('v2_outreach')
          .select('sent_at')
          .eq('contact_id', followup.contact_id)
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (lastOutreach) {
          const daysSince = Math.floor(
            (Date.now() - new Date(lastOutreach.sent_at).getTime()) / (1000 * 60 * 60 * 24)
          );
          return { ...followup, days_since_last_contact: daysSince };
        }
      }
      return { ...followup, days_since_last_contact: null };
    })
  );

  return enriched;
}

async function addJob(params: {
  title: string;
  company: string;
  url: string;
  salary_min?: number;
  salary_max?: number;
  location?: string;
  remote?: boolean;
  notes?: string;
}): Promise<V2Job> {
  const userId = requireAuth();

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

  return data as V2Job;
}

async function addContact(params: {
  name: string;
  title: string;
  company: string;
  relationship_type: RelationshipType;
  job_id?: string;
  linkedin_url?: string;
  email?: string;
  notes?: string;
}): Promise<V2Contact> {
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

  return contact as V2Contact;
}

async function getPipelineSummary(): Promise<PipelineSummary> {
  const userId = requireAuth();

  // Get all jobs
  const { data: jobs } = await supabase
    .from('v2_jobs')
    .select('status')
    .eq('user_id', userId);

  // Count by status
  const jobsByStatus: Record<JobStatus, number> = {
    new: 0,
    researching: 0,
    applied: 0,
    interviewing: 0,
    offer: 0,
    closed: 0,
    rejected: 0,
  };

  (jobs || []).forEach((job: any) => {
    jobsByStatus[job.status as JobStatus]++;
  });

  const totalApplied = jobsByStatus.applied + jobsByStatus.interviewing + jobsByStatus.offer + jobsByStatus.closed + jobsByStatus.rejected;

  // Get outreach stats
  const { data: outreach } = await supabase
    .from('v2_outreach')
    .select('response_received, contact_id, sent_at')
    .eq('user_id', userId);

  const totalOutreach = outreach?.length || 0;
  const responsesReceived = outreach?.filter((o: any) => o.response_received).length || 0;

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
  const activeContactIds = new Set(
    (outreach || [])
      .filter((o: any) => o.contact_id && new Date(o.sent_at) >= thirtyDaysAgo)
      .map((o: any) => o.contact_id)
  );

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

async function markOutreachResponse(
  outreachId: string,
  responseText: string,
  outcome: OutreachOutcome
): Promise<V2Outreach> {
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

  return data as V2Outreach;
}

async function snoozeFollowup(followupId: string, days: number): Promise<V2Followup> {
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

  return data as V2Followup;
}

// ============================================
// New Tool Implementations
// ============================================

async function getSystemInstructions(): Promise<object> {
  const instructions = `# Core Line 2.0 - AI System Instructions

You are connected to Core Line, a job search command center. The user has connected you via MCP to help manage their job search pipeline.

## What Core Line Is
Core Line is infrastructure, not AI. YOU are the AI. Core Line provides the database, the dashboard, and the tools. You do the thinking, searching, scoring, and writing.

## Your Daily Workflow
1. Call get_profile() to load user preferences and resume
2. Call get_battle_plan() to see today's priorities
3. Call get_followups_due() to check overdue follow-ups
4. Call get_pipeline_summary() for pipeline health
5. Execute actions: search for jobs, score matches, write outreach, log activities

## Available Tools (${tools.length} total)
${tools.map(t => '- ' + t.name + ': ' + (t.description || '').split('.')[0]).join('\n')}

## How to Format Battle Plans
When generating a battle plan, structure it as:
- PRIORITY 1: URGENT FOLLOW-UPS (timers expired)
- PRIORITY 2: DUE TODAY (timers expiring)
- PRIORITY 3: NEW OPPORTUNITIES (from search)
- PRIORITY 4: PIPELINE HEALTH (stale items)

## Key Rules
- "Core Line" is always two words
- Business days only for follow-up timers (skip weekends)
- Jobs scoring 70%+ get automatic deep research + outreach
- Always log outreach after sending messages
- Check for email responses every 2 hours during work hours
- Follow-up escalation: 3 days, then 5 days, then escalate to another contact, then archive at 14 days`;

  return {
    instructions,
    version: '2.0.0',
    tools_available: tools.length,
  };
}

async function searchJobs(params: SearchJobsParams): Promise<object> {
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
  };
}

async function scoreJob(params: ScoreJobParams): Promise<ScoreResult> {
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
  } else if (jobData.salary_min && jobData.salary_min >= salaryFloor * 0.9) {
    salaryScore = 15;
  } else if (!jobData.salary_min && !jobData.salary_max) {
    salaryScore = 10; // Unknown salary, give benefit of doubt
  }

  // Remote preference (15 points)
  let remoteScore = 0;
  if (prefs.remote_ok) {
    if (jobData.remote) {
      remoteScore = 15;
    } else {
      const prefLocations = (prefs.locations || []).map((l: string) => l.toLowerCase());
      const jobLoc = (jobData.location || '').toLowerCase();
      if (prefLocations.some((l: string) => jobLoc.includes(l))) {
        remoteScore = 12;
      } else {
        remoteScore = 5;
      }
    }
  } else {
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
  } else if (titleLower.includes('director') || titleLower.includes('head')) {
    reportingScore = 8;
  }

  const fitScore = titleScore + salaryScore + remoteScore + companyScore + industryScore + reportingScore;

  const result: ScoreResult = {
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

  // Update job in DB if job_id provided
  if (params.job_id) {
    await supabase
      .from('v2_jobs')
      .update({ fit_score: result.fit_score, match_score: result.fit_score })
      .eq('id', params.job_id)
      .eq('user_id', userId);
  }

  return result;
}

async function verifyPosting(params: VerifyPostingParams & { status?: string }): Promise<object> {
  const userId = requireAuth();

  const { data: job } = await supabase
    .from('v2_jobs')
    .select('id, title, company, url, posting_status, posting_verified_at')
    .eq('id', params.job_id)
    .eq('user_id', userId)
    .single();

  if (!job) throw new Error('Job not found');

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

async function generateOutreach(params: GenerateOutreachParams): Promise<object> {
  const userId = requireAuth();
  const profile = await getProfile();

  const { data: job } = await supabase
    .from('v2_jobs')
    .select('*')
    .eq('id', params.job_id)
    .eq('user_id', userId)
    .single();

  if (!job) throw new Error('Job not found');

  const { data: contact } = await supabase
    .from('v2_contacts')
    .select('*')
    .eq('id', params.contact_id)
    .eq('user_id', userId)
    .single();

  if (!contact) throw new Error('Contact not found');

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

interface GenerateCoverLetterParams {
  job_id: string;
  style?: 'formal' | 'conversational' | 'executive';
}

async function generateCoverLetter(params: GenerateCoverLetterParams): Promise<object> {
  const userId = requireAuth();
  const profile = await getProfile();

  const { data: job } = await supabase
    .from('v2_jobs')
    .select('*')
    .eq('id', params.job_id)
    .eq('user_id', userId)
    .single();

  if (!job) throw new Error('Job not found');

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

async function createGmailDraft(params: CreateGmailDraftParams): Promise<object> {
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

  if (error) throw new Error(`Error creating outreach record: ${error.message}`);

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

async function checkEmailResponses(params: CheckEmailResponsesParams): Promise<object> {
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

  if (error) throw new Error(`Error checking responses: ${error.message}`);

  const pending = (outreach || []).map((o: any) => {
    const daysSince = Math.floor(
      (Date.now() - new Date(o.sent_at).getTime()) / (1000 * 60 * 60 * 24)
    );
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
  const contactEmails = new Set<string>();
  for (const p of pending) {
    if (p.contact_email) contactEmails.add(p.contact_email);
  }

  // Also get all known contacts with email addresses for SENT scanning
  const { data: allContacts } = await supabase
    .from('v2_contacts')
    .select('id, name, email, company')
    .eq('user_id', userId)
    .not('email', 'is', null);

  const contacts_to_scan = (allContacts || [])
    .filter((c: any) => c.email)
    .map((c: any) => ({
      contact_id: c.id,
      name: c.name,
      email: c.email,
      company: c.company,
    }));

  return {
    pending_responses: pending,
    total: pending.length,
    overdue: pending.filter((p: any) => p.is_overdue).length,
    contacts_to_scan,
    instructions: `Check Gmail for replies to these ${pending.length} outreach messages. For each:
1. Search Gmail INBOX for threads with these contacts
2. Search Gmail SENT folder for emails to contacts_to_scan addresses (detect manual outreach by Micah)
3. Search Gmail ALL MAIL/ARCHIVED for missed replies
4. If reply found: call mark_outreach_response() with the outcome
5. If positive reply: outcome='positive' or outcome='interview_scheduled'
6. If rejection: outcome='negative'
7. If sent email to known contact not yet tracked: call log_outreach() to create the record
8. If no reply and overdue: the follow-up system will handle it`,
  };
}

async function bulkImportJobs(params: BulkImportJobsParams): Promise<object> {
  const userId = requireAuth();

  const results = {
    imported: 0,
    skipped: 0,
    errors: [] as string[],
    jobs: [] as any[],
  };

  for (const job of params.jobs) {
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
    } else if (data) {
      results.imported++;
      results.jobs.push({ id: data.id, title: data.title, company: data.company, fit_score: data.fit_score });

      // Auto-score if no fit_score provided
      if (!job.fit_score) {
        try {
          const score = await scoreJob({ ...job, job_id: data.id });
          results.jobs[results.jobs.length - 1].fit_score = score.fit_score;
        } catch (e) {
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

// ============================================
// Server Setup
// ============================================

export async function createMCPServer(): Promise<Server> {
  const server = new Server(
    {
      name: 'coreline-v2',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: any;

      switch (name) {
        case 'get_profile':
          result = await getProfile();
          break;

        case 'get_battle_plan':
          result = await getBattlePlan(args?.date as string);
          break;

        case 'get_jobs':
          result = await getJobs(args?.status as JobStatus, args?.limit as number);
          break;

        case 'get_contacts':
          result = await getContacts(args?.job_id as string);
          break;

        case 'update_job_status':
          result = await updateJobStatus(
            args?.job_id as string,
            args?.status as JobStatus,
            args?.notes as string
          );
          break;

        case 'log_outreach':
          result = await logOutreach(
            args?.job_id as string,
            args?.contact_id as string,
            args?.channel as OutreachChannel,
            args?.message_text as string
          );
          break;

        case 'get_followups_due':
          result = await getFollowupsDue(args?.days_ahead as number);
          break;

        case 'add_job':
          result = await addJob({
            title: args?.title as string,
            company: args?.company as string,
            url: args?.url as string,
            salary_min: args?.salary_min as number,
            salary_max: args?.salary_max as number,
            location: args?.location as string,
            remote: args?.remote as boolean,
            notes: args?.notes as string,
          });
          break;

        case 'add_contact':
          result = await addContact({
            name: args?.name as string,
            title: args?.title as string,
            company: args?.company as string,
            relationship_type: args?.relationship_type as RelationshipType,
            job_id: args?.job_id as string,
            linkedin_url: args?.linkedin_url as string,
            email: args?.email as string,
            notes: args?.notes as string,
          });
          break;

        case 'get_pipeline_summary':
          result = await getPipelineSummary();
          break;

        case 'mark_outreach_response':
          result = await markOutreachResponse(
            args?.outreach_id as string,
            args?.response_text as string,
            args?.outcome as OutreachOutcome
          );
          break;

        case 'snooze_followup':
          result = await snoozeFollowup(
            args?.followup_id as string,
            args?.days as number
          );
          break;

        case 'get_system_instructions':
          result = await getSystemInstructions();
          break;

        case 'search_jobs':
          result = await searchJobs({
            keywords: args?.keywords as string[],
            location: args?.location as string,
            remote_only: args?.remote_only as boolean,
            salary_min: args?.salary_min as number,
            freshness_hours: args?.freshness_hours as number,
          });
          break;

        case 'score_job':
          result = await scoreJob({
            job_id: args?.job_id as string,
            title: args?.title as string,
            company: args?.company as string,
            salary_min: args?.salary_min as number,
            salary_max: args?.salary_max as number,
            location: args?.location as string,
            remote: args?.remote as boolean,
            description: args?.description as string,
          });
          break;

        case 'verify_posting':
          result = await verifyPosting({
            job_id: args?.job_id as string,
            url: args?.url as string,
            status: args?.status as string,
          });
          break;

        case 'generate_outreach':
          result = await generateOutreach({
            job_id: args?.job_id as string,
            contact_id: args?.contact_id as string,
            tone: args?.tone as 'professional' | 'warm' | 'direct',
          });
          break;

        case 'generate_cover_letter':
          result = await generateCoverLetter({
            job_id: args?.job_id as string,
            style: args?.style as 'formal' | 'conversational' | 'executive',
          });
          break;

        case 'create_gmail_draft':
          result = await createGmailDraft({
            to: args?.to as string,
            subject: args?.subject as string,
            body: args?.body as string,
            job_id: args?.job_id as string,
            contact_id: args?.contact_id as string,
          });
          break;

        case 'check_email_responses':
          result = await checkEmailResponses({
            days_back: args?.days_back as number,
          });
          break;

        case 'bulk_import_jobs':
          result = await bulkImportJobs({
            jobs: args?.jobs as BulkImportJobsParams['jobs'],
          });
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
    } catch (error) {
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

export async function setAuthFromApiKey(apiKey: string): Promise<boolean> {
  const userId = await authenticateApiKey(apiKey);
  if (userId) {
    currentUserId = userId;
    return true;
  }
  return false;
}

export function setUserId(userId: string): void {
  currentUserId = userId;
}
