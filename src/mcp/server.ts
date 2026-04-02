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
