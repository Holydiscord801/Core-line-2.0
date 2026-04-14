/**
 * JD Scraper — fetches full job descriptions from common job board URLs.
 * Supports: Greenhouse (API), Lever (API), Ashby (__NEXT_DATA__), BambooHR,
 * Workday (generic), Built In (generic), and any other URL via generic scraper.
 * Rate limits to 1 req/second per domain.
 */
export interface JdScrapeResult {
    text: string | null;
    source: string;
    error?: string;
}
/**
 * Detect job board from URL and fetch the full job description.
 * Returns { text, source } on success, { text: null, source, error } on failure.
 */
export declare const BLACKLISTED_DOMAINS: string[];
export declare function isBlacklistedJobUrl(url: string): boolean;
export declare function fetchJobDescription(url: string): Promise<JdScrapeResult>;
//# sourceMappingURL=jd-scraper.d.ts.map