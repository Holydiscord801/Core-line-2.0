/**
 * Core Line 2.0 - Contact Warmth Scoring
 *
 * Warmth score ranges: 0-100
 *   0-20: Cold (no interaction)
 *   21-40: Cool (initial outreach sent)
 *   41-60: Warm (got a response)
 *   61-80: Hot (positive engagement, interview)
 *   81-100: On fire (multiple positive interactions)
 */
export declare const WARMTH_EVENTS: {
    OUTREACH_SENT: number;
    RESPONSE_RECEIVED: number;
    POSITIVE_RESPONSE: number;
    INTERVIEW_SCHEDULED: number;
    REFERRAL_GIVEN: number;
    REJECTION: number;
    NO_RESPONSE_DECAY: number;
};
export type WarmthLevel = 'cold' | 'cool' | 'warm' | 'hot' | 'on_fire';
export declare function getWarmthLevel(score: number): WarmthLevel;
export declare function getWarmthColor(score: number): string;
/**
 * Calculate new warmth score after an event.
 * Clamps between 0 and 100.
 */
export declare function updateWarmthScore(currentScore: number, event: keyof typeof WARMTH_EVENTS): number;
/**
 * Calculate warmth decay based on time since last contact.
 * Reduces score by 2 points per week of inactivity (after first 2 weeks).
 */
export declare function applyWarmthDecay(currentScore: number, lastContactedAt: Date | null): number;
/**
 * Get warmth dots for display (5 dots like the mockup).
 * Returns array of 'filled' | 'partial' | 'empty'.
 */
export declare function getWarmthDots(score: number): ('filled' | 'partial' | 'empty')[];
//# sourceMappingURL=warmth.d.ts.map