// Coreline v2 Type Definitions

// ============================================
// User Preferences
// ============================================

export interface UserPreferences {
  role_types?: string[];
  salary_floor?: number;
  locations?: string[];
  remote_ok?: boolean;
  industries?: string[];
}

// ============================================
// Database Tables
// ============================================

export interface V2User {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string | null;
  resume_text: string | null;
  preferences: UserPreferences;
  created_at: string;
  updated_at: string;
}

export type JobStatus = 'new' | 'researching' | 'applied' | 'interviewing' | 'offer' | 'closed' | 'rejected';
export type JobSource = 'linkedin' | 'indeed' | 'google' | 'glassdoor' | 'manual' | 'other';

export interface V2Job {
  id: string;
  user_id: string;
  title: string;
  company: string;
  url: string | null;
  description: string | null;
  salary_min: number | null;
  salary_max: number | null;
  location: string | null;
  remote: boolean;
  status: JobStatus;
  fit_score: number | null;
  source: JobSource | null;
  notes: string | null;
  posted_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export type RelationshipType = 'hiring_manager' | 'reports_to' | 'peer' | 'recruiter' | 'mutual_connection' | 'warm_intro' | 'other';

export interface V2Contact {
  id: string;
  user_id: string;
  name: string;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  relationship_type: RelationshipType | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface V2JobContact {
  id: string;
  job_id: string;
  contact_id: string;
  relevance_notes: string | null;
  created_at: string;
}

export type OutreachChannel = 'email' | 'linkedin' | 'phone' | 'in_person';
export type OutreachOutcome = 'no_response' | 'positive' | 'negative' | 'interview_scheduled' | 'referred';

export interface V2Outreach {
  id: string;
  user_id: string;
  job_id: string | null;
  contact_id: string | null;
  channel: OutreachChannel;
  message_text: string | null;
  sent_at: string;
  response_received: boolean;
  response_text: string | null;
  response_at: string | null;
  outcome: OutreachOutcome | null;
  created_at: string;
}

export interface BattlePlanData {
  jobs?: Array<{
    id: string;
    title: string;
    company: string;
    fit_score?: number;
    action?: string;
  }>;
  contacts_to_reach?: Array<{
    id: string;
    name: string;
    company: string;
    job_id?: string;
    suggested_action?: string;
    draft_message?: string;
  }>;
  priority_actions?: string[];
  summary?: string;
}

export interface V2BattlePlan {
  id: string;
  user_id: string;
  plan_date: string;
  jobs_found: number;
  contacts_identified: number;
  plan_data: BattlePlanData;
  ai_prompt_used: string | null;
  generated_at: string;
  created_at: string;
}

export type FollowupPriority = 'high' | 'medium' | 'low';
export type FollowupStatus = 'pending' | 'done' | 'snoozed';

export interface V2Followup {
  id: string;
  user_id: string;
  job_id: string | null;
  contact_id: string | null;
  due_date: string;
  reason: string | null;
  priority: FollowupPriority;
  status: FollowupStatus;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface V2ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
}

// ============================================
// API Request/Response Types
// ============================================

export interface CreateJobInput {
  title: string;
  company: string;
  url?: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  location?: string;
  remote?: boolean;
  source?: JobSource;
  notes?: string;
  posted_at?: string;
}

export interface UpdateJobInput {
  title?: string;
  company?: string;
  url?: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  location?: string;
  remote?: boolean;
  status?: JobStatus;
  fit_score?: number;
  source?: JobSource;
  notes?: string;
  posted_at?: string;
  applied_at?: string;
}

export interface CreateContactInput {
  name: string;
  title?: string;
  company?: string;
  linkedin_url?: string;
  email?: string;
  phone?: string;
  relationship_type?: RelationshipType;
  notes?: string;
}

export interface UpdateContactInput {
  name?: string;
  title?: string;
  company?: string;
  linkedin_url?: string;
  email?: string;
  phone?: string;
  relationship_type?: RelationshipType;
  notes?: string;
}

export interface CreateOutreachInput {
  job_id?: string;
  contact_id?: string;
  channel: OutreachChannel;
  message_text?: string;
  sent_at?: string;
}

export interface PipelineSummary {
  total_jobs: number;
  jobs_by_status: Record<JobStatus, number>;
  response_rate: number;
  interview_rate: number;
  avg_days_in_pipeline: number;
  overdue_followups: number;
}

// ============================================
// MCP Tool Parameter Types
// ============================================

export interface GetJobsParams {
  status?: JobStatus;
  limit?: number;
}

export interface GetContactsParams {
  job_id?: string;
}

export interface UpdateJobStatusParams {
  job_id: string;
  status: JobStatus;
  notes?: string;
}

export interface LogOutreachParams {
  job_id: string;
  contact_id: string;
  channel: OutreachChannel;
  message_text: string;
}

export interface GetFollowupsDueParams {
  days_ahead?: number;
}

export interface AddJobParams {
  title: string;
  company: string;
  url: string;
  salary_min?: number;
  salary_max?: number;
  location?: string;
  remote?: boolean;
  notes?: string;
}

export interface AddContactParams {
  name: string;
  title: string;
  company: string;
  relationship_type: RelationshipType;
  job_id?: string;
  linkedin_url?: string;
  email?: string;
  notes?: string;
}

export interface MarkOutreachResponseParams {
  outreach_id: string;
  response_text: string;
  outcome: OutreachOutcome;
}

export interface SnoozeFollowupParams {
  followup_id: string;
  days: number;
}

export interface GetBattlePlanParams {
  date?: string;
}
