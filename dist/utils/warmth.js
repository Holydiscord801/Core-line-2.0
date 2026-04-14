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
export const WARMTH_EVENTS = {
    OUTREACH_SENT: 10,
    RESPONSE_RECEIVED: 15,
    POSITIVE_RESPONSE: 20,
    INTERVIEW_SCHEDULED: 25,
    REFERRAL_GIVEN: 20,
    REJECTION: -5, // Still a response, small negative
    NO_RESPONSE_DECAY: -2, // Per week of no response
};
export function getWarmthLevel(score) {
    if (score <= 20)
        return 'cold';
    if (score <= 40)
        return 'cool';
    if (score <= 60)
        return 'warm';
    if (score <= 80)
        return 'hot';
    return 'on_fire';
}
export function getWarmthColor(score) {
    if (score <= 20)
        return '#52525e'; // dim gray
    if (score <= 40)
        return '#3b82f6'; // blue
    if (score <= 60)
        return '#eab308'; // yellow
    if (score <= 80)
        return '#f97316'; // orange
    return '#22c55e'; // green
}
/**
 * Calculate new warmth score after an event.
 * Clamps between 0 and 100.
 */
export function updateWarmthScore(currentScore, event) {
    const delta = WARMTH_EVENTS[event];
    return Math.max(0, Math.min(100, currentScore + delta));
}
/**
 * Calculate warmth decay based on time since last contact.
 * Reduces score by 2 points per week of inactivity (after first 2 weeks).
 */
export function applyWarmthDecay(currentScore, lastContactedAt) {
    if (!lastContactedAt || currentScore <= 0)
        return currentScore;
    const weeksSince = Math.floor((Date.now() - lastContactedAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
    // Grace period: no decay for first 2 weeks
    if (weeksSince <= 2)
        return currentScore;
    const decayWeeks = weeksSince - 2;
    const decay = decayWeeks * Math.abs(WARMTH_EVENTS.NO_RESPONSE_DECAY);
    return Math.max(0, currentScore - decay);
}
/**
 * Get warmth dots for display (5 dots like the mockup).
 * Returns array of 'filled' | 'partial' | 'empty'.
 */
export function getWarmthDots(score) {
    const dots = [];
    const perDot = 20; // 100 / 5 dots
    for (let i = 0; i < 5; i++) {
        const threshold = (i + 1) * perDot;
        if (score >= threshold) {
            dots.push('filled');
        }
        else if (score >= threshold - 10) {
            dots.push('partial');
        }
        else {
            dots.push('empty');
        }
    }
    return dots;
}
//# sourceMappingURL=warmth.js.map