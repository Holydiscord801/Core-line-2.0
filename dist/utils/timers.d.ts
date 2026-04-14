/**
 * Core Line 2.0 - Business Day Timer Utilities
 *
 * Follow-up timers operate on business days (Mon-Fri).
 * Timer types and their default windows:
 *   application: 5 business days
 *   outreach_email: 3 business days
 *   outreach_linkedin: 3 business days
 *   linkedin_connection: 3 business days
 *   interview_thankyou: 2 business days
 *   general_followup: 3 business days
 *   interview_followup: 3 business days
 *   application_followup: 5 business days
 */
export type TimerType = 'application' | 'outreach_email' | 'outreach_linkedin' | 'linkedin_connection' | 'interview_thankyou' | 'general_followup' | 'interview_followup' | 'application_followup';
export declare const TIMER_DEFAULTS: Record<TimerType, number>;
export declare const ESCALATION: {
    FIRST_FOLLOWUP: number;
    SECOND_FOLLOWUP: number;
    ESCALATE_CONTACT: number;
    AUTO_ARCHIVE: number;
};
/**
 * Check if a date is a business day (Mon-Fri)
 */
export declare function isBusinessDay(date: Date): boolean;
/**
 * Add N business days to a date.
 * Skips weekends. Does not account for holidays.
 */
export declare function addBusinessDays(startDate: Date, businessDays: number): Date;
/**
 * Count business days between two dates.
 */
export declare function countBusinessDays(startDate: Date, endDate: Date): number;
/**
 * Calculate the due date for a follow-up based on timer type.
 */
export declare function calculateDueDate(sentDate: Date, timerType: TimerType): Date;
/**
 * Check if a follow-up is overdue based on its due date.
 */
export declare function isOverdue(dueDate: Date | string): boolean;
/**
 * Check if a follow-up is due today.
 */
export declare function isDueToday(dueDate: Date | string): boolean;
/**
 * Determine the escalation level based on total business days since first outreach.
 * Returns: 'followup' | 'second_followup' | 'escalate' | 'archive'
 */
export declare function getEscalationLevel(firstOutreachDate: Date): 'followup' | 'second_followup' | 'escalate' | 'archive';
/**
 * Get a human-readable description of the follow-up status.
 */
export declare function getFollowupDescription(timerType: TimerType, sentDate: Date): string;
//# sourceMappingURL=timers.d.ts.map