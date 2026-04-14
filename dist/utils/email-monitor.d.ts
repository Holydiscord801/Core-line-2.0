import { type TimerType } from './timers.js';
/**
 * Core Line 2.0 - Email Monitoring Utilities
 *
 * The email monitoring cycle:
 * 1. check_email_responses MCP tool returns pending outreach
 * 2. AI checks Gmail for replies to those threads
 * 3. AI calls mark_outreach_response with outcomes
 * 4. These utilities handle the DB updates and cascading effects
 */
/**
 * Process a positive email response.
 * Updates outreach, contact warmth, and optionally job status.
 */
export declare function processPositiveResponse(userId: string, outreachId: string, responseText: string, isInterview: boolean): Promise<void>;
/**
 * Process a rejection/negative response.
 * Updates outreach, job status, archives follow-ups.
 */
export declare function processNegativeResponse(userId: string, outreachId: string, responseText: string): Promise<void>;
export type OutreachChannel = 'email' | 'linkedin_dm' | 'linkedin_inmail' | 'linkedin_connection_note' | 'phone' | 'in_person';
type LegacyOrCurrentChannel = OutreachChannel | 'linkedin';
/**
 * Process a manually sent outreach detected via email scanning.
 * Creates outreach record tied to a sequence and auto-generates follow-up timer.
 */
export declare function processSentOutreach(userId: string, jobId: string | null, contactId: string | null, channel: LegacyOrCurrentChannel, messageText: string, sentAt: string): Promise<{
    outreachId: string;
    followupId: string;
} | null>;
/**
 * Process an inbound response detected via email scanning.
 * Marks outreach as responded, surfaces as priority action.
 */
export declare function processInboundResponse(userId: string, contactId: string, responseText: string, isPositive: boolean, isInterview: boolean): Promise<void>;
/**
 * Create a follow-up reminder based on timer type.
 */
export declare function createFollowup(userId: string, jobId: string | null, contactId: string | null, timerType: TimerType, reason: string, fromDate?: Date): Promise<void>;
/**
 * Find contacts linked to multiple jobs in the pipeline.
 * This powers the "Sarah knows people at 3 other companies" feature.
 */
export declare function findCrossJobContacts(userId: string): Promise<any[]>;
/**
 * Get overdue follow-ups with escalation recommendations.
 */
export declare function getOverdueWithEscalation(userId: string): Promise<any[]>;
export {};
//# sourceMappingURL=email-monitor.d.ts.map