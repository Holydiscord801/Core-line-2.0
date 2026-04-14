/**
 * Cover Letter Generator — template-based approach, upgradeable to LLM later.
 * Generates professional cover letters from user profile + job data.
 */
export interface UserProfileForCL {
    full_name: string | null;
    resume_text: string | null;
    profile_data?: {
        career_highlights?: string;
        key_achievements?: string[];
        contact_email?: string;
        contact_phone?: string;
        skills?: string[];
    } | null;
}
export interface JobDataForCL {
    title: string;
    company: string;
    job_description?: string | null;
    location?: string | null;
    fit_score?: number | null;
    match_score?: number | null;
}
/**
 * Generate a complete cover letter text string, ready for storage and display.
 * Returns a multi-paragraph string with salutation and signature.
 */
export declare function generateCoverLetterText(profile: UserProfileForCL, job: JobDataForCL): string;
//# sourceMappingURL=cover-letter-generator.d.ts.map