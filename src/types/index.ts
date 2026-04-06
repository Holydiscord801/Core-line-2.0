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
  autopilot_enabled: boolean;
  review_window_hours: number;
  onboarding_complete: boolean;
}

export type JobStatus = 'new' | 'researching' | 'applied' | 'interviewing' | 'offer' | 'closed' | 'rejected';
export type JobSource = 'linkedin' | 'indeed' | 'google' | 'glassdoor' | 'manual' | 'other';
export type PostingStatus = 'live' | 'dead' | 'expired' | 'unknown';
export type TimerType = 'application' | 'outreach_email' | 'outreach_linkedin' | 'linkedin_connection' | 'interview_thankyou' | 'general_followup';

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
  match_score: number | null;
  resume_variant: string | null;
  posting_status: 'live' | 'dead' | 'expired' | 'unknown';
  posting_verified_at: string | null;
  outreach_draft: string | null;
  apply_links: Array<{ label: string; url: string; source: string }> | null;
  job_description: string | null;
  cover_letter: string | null;
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
  warmth_score: number;
  last_contacted_at: string | null;
  response_count: number;
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
  gmail_draft_id: string | null;
  gmail_message_id: string | null;
  subject_line: string | null;
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
  timer_type: TimerType | null;
  business_days_window: number;
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
  jobs_by_status: Record<JobStatus, number>;
  total_applied: number;
  response_rate: number;
  interview_rate: number;
  overdue_followups: number;
  active_relationships: number;
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

export interface SearchJobsParams {
  keywords: string[];
  location?: string;
  remote_only?: boolean;
  salary_min?: number;
  freshness_hours?: number;
}

export interface ScoreJobParams {
  job_id?: string;
  title: string;
  company: string;
  salary_min?: number;
  salary_max?: number;
  location?: string;
  remote?: boolean;
  description?: string;
}

export interface ScoreResult {
  fit_score: number;
  breakdown: {
    title_match: number;
    salary_range: number;
    remote_preference: number;
    company_stage: number;
    industry_fit: number;
    reporting_level: number;
  };
  recommendation: string;
}

export interface VerifyPostingParams {
  job_id: string;
  url?: string;
}

export interface GenerateOutreachParams {
  job_id: string;
  contact_id: string;
  tone?: 'professional' | 'warm' | 'direct';
}

export interface CreateGmailDraftParams {
  to: string;
  subject: string;
  body: string;
  job_id?: string;
  contact_id?: string;
}

export interface CheckEmailResponsesParams {
  days_back?: number;
}

export interface BulkImportJobsParams {
  jobs: Array<{
    title: string;
    company: string;
    url: string;
    salary_min?: number;
    salary_max?: number;
    location?: string;
    remote?: boolean;
    fit_score?: number;
    source?: string;
    notes?: string;
  }>;
}

export interface AutopilotSettings {
  autopilot_enabled: boolean;
  review_window_hours: number;
}
