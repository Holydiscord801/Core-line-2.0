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

export const TIMER_DEFAULTS: Record<TimerType, number> = {
  application: 5,
  outreach_email: 3,
  outreach_linkedin: 3,
  linkedin_connection: 3,
  interview_thankyou: 2,
  general_followup: 3,
  interview_followup: 3,
  application_followup: 5,
};

// Escalation path thresholds (in business days)
export const ESCALATION = {
  FIRST_FOLLOWUP: 3,      // First outreach, no response
  SECOND_FOLLOWUP: 5,     // Follow-up sent, still no response
  ESCALATE_CONTACT: 10,   // Try another contact at same company
  AUTO_ARCHIVE: 14,        // Total days with no response, archive
};

/**
 * Check if a date is a business day (Mon-Fri)
 */
export function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/**
 * Add N business days to a date.
 * Skips weekends. Does not account for holidays.
 */
export function addBusinessDays(startDate: Date, businessDays: number): Date {
  const result = new Date(startDate);
  let added = 0;

  while (added < businessDays) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result)) {
      added++;
    }
  }

  return result;
}

/**
 * Count business days between two dates.
 */
export function countBusinessDays(startDate: Date, endDate: Date): number {
  let count = 0;
  const current = new Date(startDate);

  while (current < endDate) {
    current.setDate(current.getDate() + 1);
    if (isBusinessDay(current)) {
      count++;
    }
  }

  return count;
}

/**
 * Calculate the due date for a follow-up based on timer type.
 */
export function calculateDueDate(sentDate: Date, timerType: TimerType): Date {
  const window = TIMER_DEFAULTS[timerType];
  return addBusinessDays(sentDate, window);
}

/**
 * Check if a follow-up is overdue based on its due date.
 */
export function isOverdue(dueDate: Date | string): boolean {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : new Date(dueDate.getTime());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

/**
 * Check if a follow-up is due today.
 */
export function isDueToday(dueDate: Date | string): boolean {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const today = new Date();
  return due.toISOString().split('T')[0] === today.toISOString().split('T')[0];
}

/**
 * Determine the escalation level based on total business days since first outreach.
 * Returns: 'followup' | 'second_followup' | 'escalate' | 'archive'
 */
export function getEscalationLevel(firstOutreachDate: Date): 'followup' | 'second_followup' | 'escalate' | 'archive' {
  const bizDays = countBusinessDays(firstOutreachDate, new Date());

  if (bizDays >= ESCALATION.AUTO_ARCHIVE) return 'archive';
  if (bizDays >= ESCALATION.ESCALATE_CONTACT) return 'escalate';
  if (bizDays >= ESCALATION.SECOND_FOLLOWUP) return 'second_followup';
  return 'followup';
}

/**
 * Get a human-readable description of the follow-up status.
 */
export function getFollowupDescription(timerType: TimerType, sentDate: Date): string {
  const dueDate = calculateDueDate(sentDate, timerType);

  if (isOverdue(dueDate)) {
    const overdueDays = countBusinessDays(dueDate, new Date());
    return `Overdue by ${overdueDays} business day${overdueDays !== 1 ? 's' : ''}`;
  }

  if (isDueToday(dueDate)) {
    return 'Due today';
  }

  const remaining = countBusinessDays(new Date(), dueDate);
  return `Due in ${remaining} business day${remaining !== 1 ? 's' : ''}`;
}
