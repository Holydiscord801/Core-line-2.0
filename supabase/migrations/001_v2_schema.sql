-- Coreline v2 Schema
-- All tables prefixed with v2_ to avoid conflicts with v1

-- ============================================
-- TABLES
-- ============================================

-- Users table
CREATE TABLE v2_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    resume_text TEXT,
    preferences JSONB DEFAULT '{}'::jsonb,
    -- preferences schema: { role_types: string[], salary_floor: number, locations: string[], remote_ok: boolean, industries: string[] }
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs table
CREATE TABLE v2_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    url TEXT,
    description TEXT,
    salary_min INT,
    salary_max INT,
    location TEXT,
    remote BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'researching', 'applied', 'interviewing', 'offer', 'closed', 'rejected')),
    fit_score INT CHECK (fit_score >= 0 AND fit_score <= 100),
    source TEXT CHECK (source IN ('linkedin', 'indeed', 'google', 'glassdoor', 'manual', 'other')),
    notes TEXT,
    posted_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contacts table
CREATE TABLE v2_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    title TEXT,
    company TEXT,
    linkedin_url TEXT,
    email TEXT,
    phone TEXT,
    relationship_type TEXT CHECK (relationship_type IN ('hiring_manager', 'reports_to', 'peer', 'recruiter', 'mutual_connection', 'warm_intro', 'other')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job-Contact junction table
CREATE TABLE v2_job_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES v2_jobs(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES v2_contacts(id) ON DELETE CASCADE,
    relevance_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(job_id, contact_id)
);

-- Outreach tracking table
CREATE TABLE v2_outreach (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
    job_id UUID REFERENCES v2_jobs(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES v2_contacts(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'linkedin', 'phone', 'in_person')),
    message_text TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    response_received BOOLEAN DEFAULT FALSE,
    response_text TEXT,
    response_at TIMESTAMPTZ,
    outcome TEXT CHECK (outcome IN ('no_response', 'positive', 'negative', 'interview_scheduled', 'referred')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Battle plans table
CREATE TABLE v2_battle_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
    plan_date DATE NOT NULL,
    jobs_found INT DEFAULT 0,
    contacts_identified INT DEFAULT 0,
    plan_data JSONB DEFAULT '{}'::jsonb,
    ai_prompt_used TEXT,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, plan_date)
);

-- Follow-ups table
CREATE TABLE v2_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
    job_id UUID REFERENCES v2_jobs(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES v2_contacts(id) ON DELETE SET NULL,
    due_date DATE NOT NULL,
    reason TEXT,
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'snoozed')),
    snoozed_until DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- API keys table
CREATE TABLE v2_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- User lookups
CREATE INDEX idx_v2_users_auth_user_id ON v2_users(auth_user_id);
CREATE INDEX idx_v2_users_email ON v2_users(email);

-- Jobs indexes
CREATE INDEX idx_v2_jobs_user_id ON v2_jobs(user_id);
CREATE INDEX idx_v2_jobs_status ON v2_jobs(status);
CREATE INDEX idx_v2_jobs_created_at ON v2_jobs(created_at DESC);
CREATE INDEX idx_v2_jobs_user_status ON v2_jobs(user_id, status);

-- Contacts indexes
CREATE INDEX idx_v2_contacts_user_id ON v2_contacts(user_id);
CREATE INDEX idx_v2_contacts_company ON v2_contacts(company);

-- Job-contacts indexes
CREATE INDEX idx_v2_job_contacts_job_id ON v2_job_contacts(job_id);
CREATE INDEX idx_v2_job_contacts_contact_id ON v2_job_contacts(contact_id);

-- Outreach indexes
CREATE INDEX idx_v2_outreach_user_id ON v2_outreach(user_id);
CREATE INDEX idx_v2_outreach_job_id ON v2_outreach(job_id);
CREATE INDEX idx_v2_outreach_contact_id ON v2_outreach(contact_id);
CREATE INDEX idx_v2_outreach_sent_at ON v2_outreach(sent_at DESC);

-- Battle plans indexes
CREATE INDEX idx_v2_battle_plans_user_id ON v2_battle_plans(user_id);
CREATE INDEX idx_v2_battle_plans_plan_date ON v2_battle_plans(plan_date DESC);

-- Follow-ups indexes
CREATE INDEX idx_v2_followups_user_id ON v2_followups(user_id);
CREATE INDEX idx_v2_followups_due_date ON v2_followups(due_date);
CREATE INDEX idx_v2_followups_status ON v2_followups(status);
CREATE INDEX idx_v2_followups_user_due ON v2_followups(user_id, due_date) WHERE status = 'pending';

-- API keys indexes
CREATE INDEX idx_v2_api_keys_user_id ON v2_api_keys(user_id);
CREATE INDEX idx_v2_api_keys_key_hash ON v2_api_keys(key_hash);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE v2_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_job_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_battle_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_api_keys ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view own profile" ON v2_users
    FOR SELECT USING (auth.uid() = auth_user_id);
CREATE POLICY "Users can update own profile" ON v2_users
    FOR UPDATE USING (auth.uid() = auth_user_id);
CREATE POLICY "Users can insert own profile" ON v2_users
    FOR INSERT WITH CHECK (auth.uid() = auth_user_id);

-- Jobs policies
CREATE POLICY "Users can view own jobs" ON v2_jobs
    FOR SELECT USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can insert own jobs" ON v2_jobs
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can update own jobs" ON v2_jobs
    FOR UPDATE USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can delete own jobs" ON v2_jobs
    FOR DELETE USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

-- Contacts policies
CREATE POLICY "Users can view own contacts" ON v2_contacts
    FOR SELECT USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can insert own contacts" ON v2_contacts
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can update own contacts" ON v2_contacts
    FOR UPDATE USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can delete own contacts" ON v2_contacts
    FOR DELETE USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

-- Job-contacts policies (access via job ownership)
CREATE POLICY "Users can view own job_contacts" ON v2_job_contacts
    FOR SELECT USING (job_id IN (SELECT id FROM v2_jobs WHERE user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid())));
CREATE POLICY "Users can insert own job_contacts" ON v2_job_contacts
    FOR INSERT WITH CHECK (job_id IN (SELECT id FROM v2_jobs WHERE user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid())));
CREATE POLICY "Users can delete own job_contacts" ON v2_job_contacts
    FOR DELETE USING (job_id IN (SELECT id FROM v2_jobs WHERE user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid())));

-- Outreach policies
CREATE POLICY "Users can view own outreach" ON v2_outreach
    FOR SELECT USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can insert own outreach" ON v2_outreach
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can update own outreach" ON v2_outreach
    FOR UPDATE USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

-- Battle plans policies
CREATE POLICY "Users can view own battle_plans" ON v2_battle_plans
    FOR SELECT USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can insert own battle_plans" ON v2_battle_plans
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can update own battle_plans" ON v2_battle_plans
    FOR UPDATE USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

-- Follow-ups policies
CREATE POLICY "Users can view own followups" ON v2_followups
    FOR SELECT USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can insert own followups" ON v2_followups
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can update own followups" ON v2_followups
    FOR UPDATE USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can delete own followups" ON v2_followups
    FOR DELETE USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

-- API keys policies
CREATE POLICY "Users can view own api_keys" ON v2_api_keys
    FOR SELECT USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can insert own api_keys" ON v2_api_keys
    FOR INSERT WITH CHECK (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Users can delete own api_keys" ON v2_api_keys
    FOR DELETE USING (user_id IN (SELECT id FROM v2_users WHERE auth_user_id = auth.uid()));

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_v2_users_updated_at BEFORE UPDATE ON v2_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_v2_jobs_updated_at BEFORE UPDATE ON v2_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_v2_contacts_updated_at BEFORE UPDATE ON v2_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_v2_followups_updated_at BEFORE UPDATE ON v2_followups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
