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

// Simple per-domain rate limiter
const _lastRequest = new Map<string, number>();
const RATE_LIMIT_MS = 1000;

async function rateLimit(domain: string): Promise<void> {
  const last = _lastRequest.get(domain) ?? 0;
  const wait = RATE_LIMIT_MS - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastRequest.set(domain, Date.now());
}

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Fetch raw HTML from a URL with browser-like headers and 10s timeout. */
async function fetchPage(url: string): Promise<string | null> {
  await rateLimit(getDomain(url));
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── Board-specific fetchers ──────────────────────────────────────────────────

async function fetchGreenhouse(url: string): Promise<JdScrapeResult> {
  const m = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (!m) return { text: null, source: 'greenhouse', error: 'Could not parse Greenhouse URL' };
  const [, company, jobId] = m;
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs/${jobId}`;
  try {
    await rateLimit('boards-api.greenhouse.io');
    const res = await fetch(apiUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { text: null, source: 'greenhouse', error: `API ${res.status}` };
    const data = await res.json() as { content?: string };
    const text = stripHtml(data.content || '');
    return { text: text || null, source: 'greenhouse' };
  } catch (e: any) {
    return { text: null, source: 'greenhouse', error: e.message };
  }
}

async function fetchLever(url: string): Promise<JdScrapeResult> {
  const m = url.match(/lever\.co\/([^/?#]+)\/([^/?#]+)/i);
  if (!m) return { text: null, source: 'lever', error: 'Could not parse Lever URL' };
  const [, company, jobId] = m;
  const apiUrl = `https://api.lever.co/v0/postings/${company}/${jobId}`;
  try {
    await rateLimit('api.lever.co');
    const res = await fetch(apiUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { text: null, source: 'lever', error: `API ${res.status}` };
    const data = await res.json() as { descriptionPlain?: string; description?: string; lists?: Array<{ text: string; content: string }> };
    let text = data.descriptionPlain || stripHtml(data.description || '');
    if (data.lists?.length) {
      for (const list of data.lists) {
        text += `\n\n${list.text}\n${stripHtml(list.content || '')}`;
      }
    }
    return { text: text.trim() || null, source: 'lever' };
  } catch (e: any) {
    return { text: null, source: 'lever', error: e.message };
  }
}

async function fetchAshby(url: string): Promise<JdScrapeResult> {
  const html = await fetchPage(url);
  if (!html) return { text: null, source: 'ashby', error: 'Failed to fetch page' };
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { text: null, source: 'ashby', error: 'No __NEXT_DATA__ found' };
  try {
    const data = JSON.parse(m[1]) as any;
    const job = data?.props?.pageProps?.jobPosting;
    if (!job) return { text: null, source: 'ashby', error: 'No jobPosting in page data' };
    const raw = job.descriptionHtml || job.descriptionPlain || '';
    const text = raw.includes('<') ? stripHtml(raw) : raw;
    return { text: text || null, source: 'ashby' };
  } catch (e: any) {
    return { text: null, source: 'ashby', error: e.message };
  }
}

async function fetchBambooHR(url: string): Promise<JdScrapeResult> {
  const m = url.match(/([^.]+)\.bamboohr\.com\/(?:careers|jobs\/view\.php[^/]*).*?(\d+)/i);
  if (!m) return fetchGeneric(url, 'bamboohr');
  const [, company, jobId] = m;
  try {
    await rateLimit(`${company}.bamboohr.com`);
    const res = await fetch(`https://${company}.bamboohr.com/careers/${jobId}.json`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      const raw = data.description || data.jobDescription || '';
      const text = raw.includes('<') ? stripHtml(raw) : raw;
      if (text) return { text, source: 'bamboohr' };
    }
  } catch { /* fall through to generic */ }
  return fetchGeneric(url, 'bamboohr');
}

async function fetchGeneric(url: string, source = 'generic'): Promise<JdScrapeResult> {
  const html = await fetchPage(url);
  if (!html) return { text: null, source, error: 'Failed to fetch page' };

  // Try structured patterns first (Workday, common class names, JSON-LD)
  const patterns: Array<{ re: RegExp; json?: boolean }> = [
    { re: /data-automation-id="jobPostingDescription"[^>]*>([\s\S]{100,}?)<\/div>/i },
    { re: /class="[^"]*job[_\-]?description[^"]*"[^>]*>([\s\S]{100,}?)<\/(?:div|section|article)>/i },
    { re: /id="[^"]*job[_\-]?description[^"]*"[^>]*>([\s\S]{100,}?)<\/(?:div|section|article)>/i },
    { re: /class="[^"]*description[^"]*"[^>]*>([\s\S]{200,}?)<\/(?:div|section)>/i },
    { re: /"description"\s*:\s*"((?:[^"\\]|\\.){100,})"/i, json: true },
  ];

  for (const { re, json } of patterns) {
    const m = html.match(re);
    if (m?.[1] && m[1].length > 100) {
      const text = json
        ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        : stripHtml(m[1]);
      if (text.length > 100) return { text: text.trim(), source };
    }
  }

  // Last resort: largest <article> or <main>
  const blockM = html.match(/<(?:article|main)[^>]*>([\s\S]{400,}?)<\/(?:article|main)>/i);
  if (blockM) {
    const text = stripHtml(blockM[1]);
    if (text.length > 200) return { text: text.trim(), source };
  }

  return { text: null, source, error: 'Could not extract job description from page' };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect job board from URL and fetch the full job description.
 * Returns { text, source } on success, { text: null, source, error } on failure.
 */
// Lever and Built In are blacklisted: they lag the hiring cycle and are not
// allowed sources. Any URL from these domains should never be ingested.
const BLACKLISTED_DOMAINS = ['lever.co', 'builtin.com', 'builtin.co', 'builtinnyc.com', 'builtinchicago.org', 'builtinseattle.com', 'builtinaustin.com', 'builtinboston.com', 'builtinla.com', 'builtincolorado.com'];

export function isBlacklistedJobUrl(url: string): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return BLACKLISTED_DOMAINS.some(domain => u.includes(domain));
}

export async function fetchJobDescription(url: string): Promise<JdScrapeResult> {
  if (!url) return { text: null, source: 'none', error: 'No URL provided' };

  const u = url.toLowerCase();

  if (u.includes('lever.co')) {
    return { text: null, source: 'lever', error: 'Lever is a blacklisted source. Find this role on LinkedIn, Indeed, Greenhouse, Workday, or the company careers page instead.' };
  }
  if (u.includes('builtin') && u.includes('.com')) {
    return { text: null, source: 'builtin', error: 'Built In is a blacklisted source. Find this role on LinkedIn, Indeed, Greenhouse, Workday, or the company careers page instead.' };
  }

  if (u.includes('greenhouse.io')) return fetchGreenhouse(url);
  if (u.includes('ashbyhq.com')) return fetchAshby(url);
  if (u.includes('bamboohr.com')) return fetchBambooHR(url);

  if (u.includes('linkedin.com')) {
    return { text: null, source: 'linkedin', error: 'LinkedIn blocks automated fetching. Copy the JD text manually.' };
  }
  if (u.includes('indeed.com')) {
    return { text: null, source: 'indeed', error: 'Indeed blocks automated fetching. Copy the JD text manually.' };
  }

  if (u.includes('myworkdayjobs.com')) return fetchGeneric(url, 'workday');
  if (u.includes('smartrecruiters.com')) return fetchGeneric(url, 'smartrecruiters');
  if (u.includes('jobvite.com')) return fetchGeneric(url, 'jobvite');
  if (u.includes('icims.com')) return fetchGeneric(url, 'icims');

  return fetchGeneric(url);
}
