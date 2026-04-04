/**
 * Core Line 2.0 -- Battle Plan HTML Importer
 *
 * Parses /tmp/battle_plan.html and imports all company cards into Supabase.
 * Creates jobs, contacts, job-contact links, and outreach records.
 *
 * Usage:  npx tsx scripts/import-battleplan.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (project root)
 * or as environment variables.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Set them in .env at the project root or export them directly.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const HTML_PATH = '/tmp/battle_plan.html';
const USER_EMAIL = 'micah.processmodel@gmail.com';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedCard {
  company: string;
  role: string;
  salary_text: string;
  salary_min: number | null;
  salary_max: number | null;
  location: string;
  remote: boolean;
  badge_class: string;
  badge_text: string;
  status: string;
  posting_status: string;
  match_score: number | null;
  resume_variant: string | null;
  notes: string | null;
  outreach_draft: string | null;
  apply_url: string | null;
  contacts: ParsedContact[];
  sent_outreach: SentOutreach[];
  section: string;
}

interface ParsedContact {
  name: string;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
}

interface SentOutreach {
  contact_name: string;
  message: string;
  channel: string;
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

const stats = {
  jobs_imported: 0,
  jobs_skipped: 0,
  contacts_created: 0,
  contacts_linked: 0,
  outreach_logged: 0,
  warnings: [] as string[],
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2019;/g, "'")
    .replace(/&#x2013;/g, '-')
    .replace(/&#x2014;/g, '-')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&#xfe0f;/g, '')
    .replace(/&#x26a0;/g, '')
    .replace(/&#x274c;/g, '')
    .replace(/&#x2605;/g, '')
    .replace(/&#x1f4c4;/g, '')
    .replace(/&#x1f4cd;/g, '')
    .replace(/&#x1f4cb;/g, '')
    .replace(/&#x1f517;/g, '')
    .replace(/&#x1f4e4;/g, '')
    .replace(/&#x2709;/g, '')
    .replace(/&#x2705;/g, '')
    .replace(/&bull;/g, '*');
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function extractText(html: string): string {
  return decodeHtmlEntities(stripHtmlTags(html)).trim();
}

function parseSalary(text: string): { min: number | null; max: number | null } {
  if (!text || text === 'TBD' || text === 'Not Listed') {
    return { min: null, max: null };
  }

  const cleaned = text.replace(/,/g, '').replace(/\s+/g, ' ').trim();

  // Handle "Up to $284K"
  const upToMatch = cleaned.match(/Up\s+to\s+\$(\d+(?:\.\d+)?)(K?)/i);
  if (upToMatch) {
    const val = parseFloat(upToMatch[1]);
    const max = upToMatch[2]?.toUpperCase() === 'K' ? val * 1000 : val;
    return { min: null, max };
  }

  // Handle "$400,000/year" or "$400000/year"
  const singleMatch = cleaned.match(/\$(\d+(?:\.\d+)?)(K?)\/year/i);
  if (singleMatch) {
    const val = parseFloat(singleMatch[1]);
    const amount = singleMatch[2]?.toUpperCase() === 'K' ? val * 1000 : val;
    return { min: amount, max: amount };
  }

  // Handle ranges like "$220K - $325K", "~$180K - $220K", "$220,000 - $325,000",
  // "$287,000 - $464,000", "$250,000 - $300,000 + Equity", "$220K - $300K (est.)"
  const rangeMatch = cleaned.match(
    /~?\$(\d+(?:\.\d+)?)(K?)\s*[-\u2013]\s*\$(\d+(?:\.\d+)?)(K?)/i
  );
  if (rangeMatch) {
    let minVal = parseFloat(rangeMatch[1]);
    if (rangeMatch[2]?.toUpperCase() === 'K') minVal *= 1000;

    let maxVal = parseFloat(rangeMatch[3]);
    if (rangeMatch[4]?.toUpperCase() === 'K') maxVal *= 1000;

    return { min: minVal, max: maxVal };
  }

  // Handle single amounts like "$225K" or "$320000"
  const singleAmount = cleaned.match(/\$(\d+(?:\.\d+)?)(K?)/i);
  if (singleAmount) {
    const val = parseFloat(singleAmount[1]);
    const amount = singleAmount[2]?.toUpperCase() === 'K' ? val * 1000 : val;
    return { min: amount, max: amount };
  }

  return { min: null, max: null };
}

function parseMatchScore(text: string): number | null {
  const match = text.match(/(\d+)%/);
  return match ? parseInt(match[1], 10) : null;
}

function mapResumeVariant(tag: string): string | null {
  const cleaned = tag.trim().toUpperCase();
  if (cleaned.includes('ENG LEADERSHIP')) return 'Engineering Leadership';
  if (cleaned.includes('OPS') || cleaned.includes('COO')) return 'Operations Leadership';
  if (cleaned.includes('PRODUCT') || cleaned.includes('TECH')) return 'Product & Technology';
  if (cleaned.includes('DIGITAL TRANSFORM')) return 'Digital Transformation';
  return tag.trim() || null;
}

function mapBadgeToStatus(
  badgeClass: string,
  badgeText: string
): { status: string; posting_status: string } {
  const text = badgeText.toUpperCase();
  const cls = badgeClass.toLowerCase();

  if (text.includes('POSTING DEAD') || text === 'POSTING DEAD') {
    return { status: 'closed', posting_status: 'dead' };
  }

  if (cls.includes('rejected')) {
    // Check if it says POSTING DEAD in text
    if (text.includes('POSTING DEAD')) {
      return { status: 'closed', posting_status: 'dead' };
    }
    return { status: 'closed', posting_status: 'dead' };
  }

  if (cls.includes('interviewed')) return { status: 'interviewing', posting_status: 'live' };
  if (cls.includes('sent')) return { status: 'applied', posting_status: 'live' };
  if (cls.includes('ready')) return { status: 'new', posting_status: 'live' };
  if (cls.includes('followup')) {
    // Check for POSTING DEAD in the text
    if (text.includes('POSTING DEAD')) {
      return { status: 'closed', posting_status: 'dead' };
    }
    return { status: 'applied', posting_status: 'live' };
  }
  if (cls.includes('closed')) return { status: 'closed', posting_status: 'dead' };

  return { status: 'new', posting_status: 'live' };
}

function mapSectionToStatus(section: string): string {
  if (section === 'active') return 'applied';
  if (section === 'leads') return 'new';
  return 'new';
}

function parseLocation(text: string): { location: string; remote: boolean } {
  // Remove pin emoji and clean up
  const cleaned = text
    .replace(/\u{1F4CD}/gu, '')
    .replace(/📍/g, '')
    .trim();

  // Check for clearly remote-only
  if (/^remote$/i.test(cleaned.trim())) {
    return { location: 'Remote', remote: true };
  }

  // "Remote (US)" or "Remote (All 50 States)"
  if (/^remote\s*\(/i.test(cleaned)) {
    return { location: 'Remote', remote: true };
  }

  // "Hybrid / Remote" or "Remote / Hybrid"
  if (/hybrid\s*\/\s*remote|remote\s*\/\s*hybrid/i.test(cleaned)) {
    return { location: cleaned, remote: true };
  }

  // "City (Remote?)" or "City (Remote unclear)" -- means unclear, default to false
  if (/\(remote\s*\?\)|\(remote\s+unclear\)/i.test(cleaned)) {
    const loc = cleaned.replace(/\(remote\s*\?\)|\(remote\s+unclear\)/i, '').trim();
    return { location: loc || cleaned, remote: false };
  }

  // "Remote/In-Office" or "Remote (15-25% travel)" or "Remote US/Europe"
  if (/remote/i.test(cleaned)) {
    // Keep the full text as location context, just clean it up
    const loc = cleaned
      .replace(/[()]/g, '')
      .replace(/\d+-\d+%\s*travel/i, '')
      .trim();
    return { location: loc || 'Remote', remote: true };
  }

  // "City (Hybrid)" or "Draper, UT (Hybrid)" or "Chicago Hybrid / UT Eligible"
  if (/hybrid/i.test(cleaned)) {
    const loc = cleaned
      .replace(/\(?\s*hybrid\s*\)?/i, '')
      .replace(/\s+/g, ' ')
      .replace(/^\s*[,/]\s*/, '')
      .trim();
    return { location: loc || cleaned, remote: false };
  }

  // "City (Local)"
  if (/\(local\)/i.test(cleaned)) {
    const loc = cleaned.replace(/\(?\s*local\s*\)?/i, '').trim();
    return { location: loc, remote: false };
  }

  return { location: cleaned || 'Not specified', remote: false };
}

function parseContactNameTitle(text: string): { name: string; title: string | null } {
  const cleaned = decodeHtmlEntities(stripHtmlTags(text)).trim();

  // Match "Name (Title)" pattern
  const match = cleaned.match(/^([^(]+)\(([^)]+)\)/);
  if (match) {
    return {
      name: match[1].trim(),
      title: decodeHtmlEntities(match[2].trim()),
    };
  }

  // Match "Name, email" - strip email part
  const commaMatch = cleaned.match(/^([^,]+),/);
  if (commaMatch && commaMatch[1].trim().includes(' ')) {
    return { name: commaMatch[1].trim(), title: null };
  }

  return { name: cleaned, title: null };
}

// ---------------------------------------------------------------------------
// Card Parser
// ---------------------------------------------------------------------------

function parseCards(html: string): ParsedCard[] {
  const cards: ParsedCard[] = [];

  // Determine sections by position
  const activeStart = html.indexOf('id="active"');
  const leadsStart = html.indexOf('id="leads"');
  const priorityStart = html.indexOf('Priority Actions');

  // Extract all card blocks
  const cardRegex = /<div class="card(?:\s+featured)?"[^>]*onclick="toggle\(this\)">/g;
  const cardPositions: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = cardRegex.exec(html)) !== null) {
    cardPositions.push(match.index);
  }

  for (let i = 0; i < cardPositions.length; i++) {
    const start = cardPositions[i];
    // Find the end of this card -- look for the closing pattern
    // Each card ends with </div></div> before the next card or section
    const end = i < cardPositions.length - 1
      ? cardPositions[i + 1]
      : (priorityStart > 0 ? priorityStart : html.length);

    const cardHtml = html.substring(start, end);

    // Determine section
    let section = 'other';
    if (activeStart > 0 && start > activeStart && (leadsStart < 0 || start < leadsStart)) {
      section = 'active';
    } else if (leadsStart > 0 && start > leadsStart) {
      section = 'leads';
    }

    try {
      const parsed = parseOneCard(cardHtml, section);
      if (parsed) {
        cards.push(parsed);
      }
    } catch (err) {
      const companySnippet = cardHtml.substring(0, 100);
      stats.warnings.push(`Failed to parse card near: ${companySnippet}`);
    }
  }

  return cards;
}

function parseOneCard(cardHtml: string, section: string): ParsedCard | null {
  // Company name -- match text directly between the div tags (no nested elements)
  const companyMatch = cardHtml.match(/<div class="card-company">([^<]+)<\/div>/);
  if (!companyMatch) {
    stats.warnings.push('Could not find company name in card');
    return null;
  }
  let company = decodeHtmlEntities(companyMatch[1])
    .replace(/^\s*\u2605?\s*/, '')  // remove star unicode
    .replace(/^\s*\*?\s*/, '')      // remove star prefix
    .trim();

  // Role -- match the card-role div, stopping at its closing tag
  // The card-role contains the role text plus optional span tags for match-score and resume-tag
  const roleMatch = cardHtml.match(/<div class="card-role">([\s\S]*?)<\/div>\s*<div class="card-meta">/);
  let role = '';
  let matchScoreFromRole: number | null = null;
  let resumeVariantRaw: string | null = null;

  if (roleMatch) {
    const roleHtml = roleMatch[1];

    // Extract match score from span
    const scoreMatch = roleHtml.match(/<span class="match-score[^"]*">([^<]*)<\/span>/);
    if (scoreMatch) {
      matchScoreFromRole = parseMatchScore(scoreMatch[1]);
    }

    // Extract resume tag
    const tagMatch = roleHtml.match(/<span class="resume-tag"[^>]*>([^<]*)<\/span>/);
    if (tagMatch) {
      resumeVariantRaw = decodeHtmlEntities(tagMatch[1]).trim();
    }

    // Get clean role text by stripping all span tags and their content
    role = decodeHtmlEntities(
      roleHtml.replace(/<span[^>]*>[^<]*<\/span>/g, '')
    )
      .replace(/<[^>]*>/g, '')
      .trim();
  }

  // Salary
  const salaryMatch = cardHtml.match(/<span class="salary"[^>]*>([^<]*)<\/span>/);
  const salaryText = salaryMatch ? decodeHtmlEntities(salaryMatch[1]).trim() : '';
  const salary = parseSalary(salaryText);

  // Location (second span in card-meta, after salary span)
  // The card-meta div contains multiple spans: first is salary, second is location
  const metaMatch = cardHtml.match(/<div class="card-meta">([\s\S]*?)<\/div>\s*<\/div>\s*<span class="badge/);
  let location = '';
  let remote = false;
  if (metaMatch) {
    // Find all spans in the meta div
    const spanTexts: string[] = [];
    const spanRegex = /<span[^>]*>([^<]*)<\/span>/g;
    let sm: RegExpExecArray | null;
    while ((sm = spanRegex.exec(metaMatch[1])) !== null) {
      spanTexts.push(decodeHtmlEntities(sm[1]).trim());
    }
    // Second span is location (first is salary)
    if (spanTexts.length >= 2) {
      const locText = spanTexts[1];
      const parsed = parseLocation(locText);
      location = parsed.location;
      remote = parsed.remote;
    }
  } else {
    // Fallback: try simpler card-meta match
    const metaFallback = cardHtml.match(/<div class="card-meta">([\s\S]*?)<\/div>/);
    if (metaFallback) {
      const spanTexts: string[] = [];
      const spanRegex = /<span[^>]*>([^<]*)<\/span>/g;
      let sm: RegExpExecArray | null;
      while ((sm = spanRegex.exec(metaFallback[1])) !== null) {
        spanTexts.push(decodeHtmlEntities(sm[1]).trim());
      }
      if (spanTexts.length >= 2) {
        const parsed = parseLocation(spanTexts[1]);
        location = parsed.location;
        remote = parsed.remote;
      }
    }
  }

  // Badge
  const badgeMatch = cardHtml.match(/<span class="badge\s+([^"]*)"[^>]*>([^<]*)<\/span>/);
  const badgeClass = badgeMatch ? badgeMatch[1] : '';
  const badgeText = badgeMatch ? decodeHtmlEntities(badgeMatch[2]).trim() : '';
  const { status, posting_status } = mapBadgeToStatus(badgeClass, badgeText);

  // Resume variant mapping
  const resumeVariant = resumeVariantRaw ? mapResumeVariant(resumeVariantRaw) : null;

  // Match score
  const matchScore = matchScoreFromRole;

  // Fit score = match score or default based on section
  const fitScore = matchScore ?? (section === 'active' ? 80 : 75);

  // Notes -- notes div contains only inline text (no nested divs)
  const notesMatch = cardHtml.match(/<div class="notes">([\s\S]*?)<\/div>/);
  const notes = notesMatch ? extractText(notesMatch[1]).trim() : null;

  // Apply URL
  let applyUrl: string | null = null;
  const applyMatches = cardHtml.matchAll(/<a\s+[^>]*class="link-btn"[^>]*href="([^"]*)"[^>]*>[^<]*Apply[^<]*<\/a>/gi);
  for (const am of applyMatches) {
    applyUrl = am[1];
    break; // take first apply link
  }

  // First outreach text as outreach_draft
  // The outreach-text div ends with </div> followed by a <button class="copy-btn">
  const outreachTextMatch = cardHtml.match(/<div class="outreach-text"[^>]*>([\s\S]*?)<\/div>\s*<button class="copy-btn"/);
  const outreachDraft = outreachTextMatch ? extractText(outreachTextMatch[1]).trim() : null;

  // Parse contacts
  const contacts = parseContacts(cardHtml, company);

  // Parse sent outreach
  const sentOutreach = parseSentOutreach(cardHtml);

  return {
    company,
    role,
    salary_text: salaryText,
    salary_min: salary.min,
    salary_max: salary.max,
    location,
    remote,
    badge_class: badgeClass,
    badge_text: badgeText,
    status,
    posting_status,
    match_score: matchScore,
    resume_variant: resumeVariant,
    notes,
    outreach_draft: outreachDraft,
    apply_url: applyUrl,
    contacts,
    sent_outreach: sentOutreach,
    section,
  };
}

function parseContacts(cardHtml: string, company: string): ParsedContact[] {
  const contacts: ParsedContact[] = [];
  const seenNames = new Set<string>();

  // Parse contacts from detail grid items with "Contact", "Reach Out To", "Hiring Manager",
  // "Likely Hiring Manager", "Other Contacts", "CEO"
  // The dv div may contain links and complex HTML, so we match until </div></div> (end of detail-item)
  const detailItemRegex = /<div class="dl">([^<]*)<\/div>\s*<div class="dv"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let dm: RegExpExecArray | null;

  while ((dm = detailItemRegex.exec(cardHtml)) !== null) {
    const label = extractText(dm[1]).trim().toLowerCase();
    const valueHtml = dm[2];

    if (
      label.includes('contact') ||
      label.includes('reach out') ||
      label.includes('hiring manager') ||
      label === 'ceo'
    ) {
      // This div may contain multiple contacts separated by bullet
      const parts = valueHtml.split(/&bull;|&#x2022;|\u2022/);

      for (const part of parts) {
        const contact = extractContactFromHtml(part.trim());
        if (contact && contact.name && !seenNames.has(contact.name.toLowerCase())) {
          seenNames.add(contact.name.toLowerCase());
          contacts.push(contact);
        }
      }
    }
  }

  // Also extract contacts from link-btn anchors that have LinkedIn URLs and names
  // Pattern: <a href="linkedin..." class="link-btn">Name (Title)</a>
  const linkBtnRegex = /<a\s+[^>]*href="(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"]*)"[^>]*class="link-btn"[^>]*>([^<]*)<\/a>/g;
  let lm: RegExpExecArray | null;

  while ((lm = linkBtnRegex.exec(cardHtml)) !== null) {
    const linkedinUrl = lm[1];
    let nameText = extractText(lm[2]).trim();

    // Skip if it's just "View Profile" or "Open LinkedIn"
    if (nameText.includes('View Profile') || nameText.includes('Open LinkedIn')) continue;
    if (nameText.includes('Apply')) continue;

    // Parse name and title from text like "Dustin Kirkland (SVP Eng)"
    const { name, title } = parseContactNameTitle(nameText);

    if (name && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());

      // Look for email near this LinkedIn link
      const email = findEmailNearLink(cardHtml, linkedinUrl);

      contacts.push({
        name,
        title,
        email,
        linkedin_url: linkedinUrl,
      });
    } else if (name && seenNames.has(name.toLowerCase())) {
      // Update existing contact with LinkedIn URL if missing
      const existing = contacts.find(
        (c) => c.name.toLowerCase() === name.toLowerCase()
      );
      if (existing && !existing.linkedin_url) {
        existing.linkedin_url = linkedinUrl;
      }
      // Update email if found
      const email = findEmailNearLink(cardHtml, linkedinUrl);
      if (existing && !existing.email && email) {
        existing.email = email;
      }
    }
  }

  // Also look for link-btn with pattern: class="link-btn" before href
  const linkBtnRegex2 = /<a\s+[^>]*class="link-btn"[^>]*href="(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"]*)"[^>]*>([^<]*)<\/a>/g;
  let lm2: RegExpExecArray | null;

  while ((lm2 = linkBtnRegex2.exec(cardHtml)) !== null) {
    const linkedinUrl = lm2[1];
    let nameText = extractText(lm2[2]).trim();

    if (nameText.includes('View Profile') || nameText.includes('Open LinkedIn')) continue;
    if (nameText.includes('Apply')) continue;

    const { name, title } = parseContactNameTitle(nameText);

    if (name && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      const email = findEmailNearLink(cardHtml, linkedinUrl);
      contacts.push({ name, title, email, linkedin_url: linkedinUrl });
    } else if (name && seenNames.has(name.toLowerCase())) {
      const existing = contacts.find(
        (c) => c.name.toLowerCase() === name.toLowerCase()
      );
      const email = findEmailNearLink(cardHtml, linkedinUrl);
      if (existing) {
        if (!existing.linkedin_url) existing.linkedin_url = linkedinUrl;
        if (!existing.email && email) existing.email = email;
      }
    }
  }

  // Extract contacts from dv divs that have inline links
  // Pattern: <a href="linkedin...">Name</a> (Title)
  const dvRegex = /<div class="dv"[^>]*>([\s\S]*?)<\/div>/g;
  let dvm: RegExpExecArray | null;

  while ((dvm = dvRegex.exec(cardHtml)) !== null) {
    const dvHtml = dvm[1];
    // Find linked names: <a href="linkedin...">Name</a> (Title)
    const linkedNameRegex = /<a\s+href="(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"]*)"[^>]*>([^<]*)<\/a>\s*\(([^)]+)\)/g;
    let lnm: RegExpExecArray | null;

    while ((lnm = linkedNameRegex.exec(dvHtml)) !== null) {
      const linkedinUrl = lnm[1];
      const name = extractText(lnm[2]).trim();
      const title = lnm[3].trim();

      if (name && !seenNames.has(name.toLowerCase())) {
        seenNames.add(name.toLowerCase());
        const email = findEmailNearLink(cardHtml, linkedinUrl);
        contacts.push({ name, title, email, linkedin_url: linkedinUrl });
      } else if (name && seenNames.has(name.toLowerCase())) {
        const existing = contacts.find(
          (c) => c.name.toLowerCase() === name.toLowerCase()
        );
        if (existing) {
          if (!existing.linkedin_url) existing.linkedin_url = linkedinUrl;
          if (!existing.title) existing.title = title;
          const email = findEmailNearLink(cardHtml, linkedinUrl);
          if (!existing.email && email) existing.email = email;
        }
      }
    }
  }

  return contacts;
}

function extractContactFromHtml(html: string): ParsedContact | null {
  // Could have format: <a href="linkedin...">Name</a> (Title)
  // Or: Name (Title), email
  // Or: Name (Title)
  // Or: Already connected: Name1, Name2
  // Or: plain text "Name (Title)"

  const linkedMatch = html.match(
    /<a\s+href="(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"]*)"[^>]*>([^<]*)<\/a>\s*\(([^)]+)\)/
  );
  if (linkedMatch) {
    return {
      name: decodeHtmlEntities(stripHtmlTags(linkedMatch[2])).trim(),
      title: decodeHtmlEntities(linkedMatch[3]).trim(),
      email: null,
      linkedin_url: linkedMatch[1],
    };
  }

  // Linked name without title: <a href="linkedin...">Name</a>
  const linkedNoTitle = html.match(
    /<a\s+href="(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"]*)"[^>]*>([^<]*)<\/a>/
  );
  if (linkedNoTitle) {
    const name = decodeHtmlEntities(stripHtmlTags(linkedNoTitle[2])).trim();
    if (name && !name.includes('View Profile') && !name.includes('Apply')) {
      return {
        name,
        title: null,
        email: null,
        linkedin_url: linkedNoTitle[1],
      };
    }
  }

  // Plain text: "Name (Title)" or "Name (Title), email"
  const plainText = extractText(html).trim();
  if (!plainText || plainText.length < 3) return null;
  if (plainText.startsWith('Already connected:')) return null;
  if (plainText.startsWith('April') || plainText.startsWith('March')) return null;

  const { name, title } = parseContactNameTitle(plainText);

  // Skip non-name strings
  if (!name || name.length < 3) return null;
  if (/^\d/.test(name)) return null;
  if (name.includes('$') || name.includes('posted') || name.includes('search')) return null;

  return { name, title: title ? decodeHtmlEntities(title) : null, email: null, linkedin_url: null };
}

function findEmailNearLink(cardHtml: string, linkedinUrl: string): string | null {
  // Find email associated with a LinkedIn link.
  // The HTML has btn-stack divs with link-btn and email-under links.
  // Sometimes multiple contacts share a btn-stack, with all link-btns first, then all emails.
  // Strategy: extract the contact name from the link-btn, then find matching email by name.
  const liPos = cardHtml.indexOf(linkedinUrl);
  if (liPos < 0) return null;

  // Get the link-btn element text to extract the contact name
  const linkEnd = cardHtml.indexOf('</a>', liPos);
  if (linkEnd < 0) return null;
  const linkText = cardHtml.substring(liPos, linkEnd);
  const nameInLink = extractText(linkText.replace(/^[^>]*>/, '')).trim();

  // Try to find email by matching against the contact's name
  // e.g., name "Chandra Gnanasambandam" -> look for "chandra" in email
  if (nameInLink) {
    const nameParts = nameInLink.split(/[\s(]+/);
    const firstName = nameParts[0]?.toLowerCase();
    const lastName = nameParts.length > 1 ? nameParts[1]?.toLowerCase().replace(/[^a-z]/g, '') : null;

    if (firstName && firstName.length > 2) {
      // Search all mailto links in the card for one matching this name
      const allMailtos = cardHtml.matchAll(/href="mailto:([^"]*)"/g);
      for (const m of allMailtos) {
        const email = m[1].toLowerCase();
        // Check if email contains the first name or last name
        if (email.includes(firstName)) return m[1];
        if (lastName && lastName.length > 3 && email.includes(lastName)) return m[1];
      }
    }
  }

  // Fallback: find email-under immediately after this link in the same btn-stack
  const afterLink = cardHtml.substring(linkEnd, linkEnd + 200);
  const immediateEmail = afterLink.match(
    /<\/a>\s*<a\s+class="email-under"\s+href="mailto:([^"]*)"/
  );
  if (immediateEmail) return immediateEmail[1];

  return null;
}


function parseSentOutreach(cardHtml: string): SentOutreach[] {
  const sent: SentOutreach[] = [];

  // Find outreach labels that contain "SENT" or "Sent"
  // Pattern: <div class="outreach-label">...SENT...</div><div class="outreach-text"...>content</div><button...>
  // The outreach-text ends at </div> before a <button class="copy-btn">
  // Label div contains only plain text (no nested tags)
  const outreachSectionRegex =
    /<div class="outreach-label">([^<]*)<\/div>\s*<div class="outreach-text"[^>]*>([\s\S]*?)<\/div>\s*<button class="copy-btn"/g;
  let om: RegExpExecArray | null;

  while ((om = outreachSectionRegex.exec(cardHtml)) !== null) {
    const label = om[1];
    const message = extractText(om[2]).trim();

    // Check if label contains SENT marker (the checkmark emoji or text)
    if (/SENT|Outreach Message \(Sent\)/i.test(label)) {
      // Extract contact name from label
      // Patterns: "To Cameron Etezadi (CTO, appointed Jan 2026) SENT"
      // "Outreach Message (Sent)"
      let contactName = 'Unknown';
      const nameMatch = label.match(/To\s+([^(]+)/i);
      if (nameMatch) {
        contactName = extractText(nameMatch[1]).trim();
      } else if (/Outreach Message \(Sent\)/i.test(label)) {
        contactName = 'Primary Contact';
      }

      // Determine channel from content
      const channel = message.toLowerCase().includes('subject:') ? 'email' : 'linkedin';

      sent.push({ contact_name: contactName, message, channel });
    }
  }

  return sent;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Core Line 2.0 -- Battle Plan HTML Importer\n');
  console.log(`Reading HTML from: ${HTML_PATH}`);

  // 1. Read the HTML file
  if (!fs.existsSync(HTML_PATH)) {
    console.error(`File not found: ${HTML_PATH}`);
    process.exit(1);
  }

  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  console.log(`  HTML file loaded (${(html.length / 1024).toFixed(1)} KB)\n`);

  // 2. Look up user
  console.log('[1/5] Looking up user...');
  const { data: user, error: userError } = await supabase
    .from('v2_users')
    .select('id')
    .eq('email', USER_EMAIL)
    .single();

  if (userError || !user) {
    console.error(`  User not found with email: ${USER_EMAIL}`);
    console.error('  Run scripts/seed-battleplan.ts first to create the user.');
    process.exit(1);
  }

  const userId = user.id;
  console.log(`  Found user: ${USER_EMAIL} (${userId})\n`);

  // 3. Parse cards
  console.log('[2/5] Parsing HTML cards...');
  const cards = parseCards(html);
  console.log(`  Found ${cards.length} cards\n`);

  // 4. Get existing jobs for duplicate check
  console.log('[3/5] Checking for existing jobs...');
  const { data: existingJobs } = await supabase
    .from('v2_jobs')
    .select('company, title')
    .eq('user_id', userId);

  const existingCompanies = new Set(
    (existingJobs ?? []).map((j) => `${j.company}|||${j.title}`)
  );
  console.log(`  Found ${existingJobs?.length ?? 0} existing jobs\n`);

  // 5. Import each card
  console.log('[4/5] Importing cards...\n');

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const cardNum = i + 1;

    // Check for duplicates
    const key = `${card.company}|||${card.role}`;
    if (existingCompanies.has(key)) {
      console.log(`  [${cardNum}/${cards.length}] SKIP (duplicate): ${card.company} - ${card.role}`);
      stats.jobs_skipped++;
      continue;
    }

    console.log(`  [${cardNum}/${cards.length}] Importing: ${card.company} - ${card.role}`);

    // Insert job
    const jobRow = {
      user_id: userId,
      title: card.role,
      company: card.company,
      url: card.apply_url,
      salary_min: card.salary_min,
      salary_max: card.salary_max,
      location: card.location,
      remote: card.remote,
      status: card.status,
      fit_score: card.match_score ?? (card.section === 'active' ? 80 : 75),
      match_score: card.match_score,
      source: 'linkedin' as const,
      resume_variant: card.resume_variant,
      posting_status: card.posting_status,
      notes: card.notes,
      outreach_draft: card.outreach_draft,
      applied_at:
        card.status === 'applied' || card.status === 'interviewing'
          ? new Date().toISOString()
          : null,
    };

    const { data: insertedJob, error: jobError } = await supabase
      .from('v2_jobs')
      .insert(jobRow)
      .select('id')
      .single();

    if (jobError) {
      console.error(`    Job insert failed: ${jobError.message}`);
      stats.warnings.push(`Job insert failed for ${card.company}: ${jobError.message}`);
      continue;
    }

    const jobId = insertedJob!.id;
    stats.jobs_imported++;
    existingCompanies.add(key);

    // Insert contacts
    for (const contact of card.contacts) {
      if (!contact.name || contact.name.length < 2) continue;

      const contactRow = {
        user_id: userId,
        name: contact.name,
        title: contact.title,
        company: card.company,
        linkedin_url: contact.linkedin_url,
        email: contact.email,
        relationship_type: 'hiring_manager' as const,
        warmth_score: 0,
        response_count: 0,
      };

      const { data: insertedContact, error: contactError } = await supabase
        .from('v2_contacts')
        .insert(contactRow)
        .select('id')
        .single();

      if (contactError) {
        stats.warnings.push(
          `Contact insert failed for ${contact.name} at ${card.company}: ${contactError.message}`
        );
        continue;
      }

      stats.contacts_created++;
      const contactId = insertedContact!.id;

      // Link contact to job
      const { error: linkError } = await supabase
        .from('v2_job_contacts')
        .insert({
          job_id: jobId,
          contact_id: contactId,
          relevance_notes: `${contact.name}${contact.title ? ' (' + contact.title + ')' : ''} at ${card.company}`,
        });

      if (linkError) {
        stats.warnings.push(
          `Job-contact link failed for ${contact.name}: ${linkError.message}`
        );
      } else {
        stats.contacts_linked++;
      }

      // Check if this contact has sent outreach
      const matchingSent = card.sent_outreach.find((o) => {
        if (o.contact_name === 'Primary Contact') return true;
        // Fuzzy match: check if the contact name appears in the outreach contact_name
        const oNameParts = o.contact_name.toLowerCase().split(/\s+/);
        const cNameParts = contact.name.toLowerCase().split(/\s+/);
        return oNameParts.some((p) => cNameParts.includes(p) && p.length > 2);
      });

      if (matchingSent) {
        // Remove from sent list to avoid double-logging
        const idx = card.sent_outreach.indexOf(matchingSent);
        if (idx >= 0) card.sent_outreach.splice(idx, 1);

        const outreachRow = {
          user_id: userId,
          job_id: jobId,
          contact_id: contactId,
          channel: matchingSent.channel as 'email' | 'linkedin',
          message_text: matchingSent.message,
          sent_at: new Date().toISOString(),
          response_received: false,
          outcome: 'no_response' as const,
        };

        const { error: outreachError } = await supabase
          .from('v2_outreach')
          .insert(outreachRow);

        if (outreachError) {
          stats.warnings.push(
            `Outreach insert failed for ${contact.name}: ${outreachError.message}`
          );
        } else {
          stats.outreach_logged++;
        }
      }
    }

    // Log any remaining sent outreach that did not match a contact
    for (const o of card.sent_outreach) {
      if (o.contact_name === 'Primary Contact' || o.contact_name === 'Unknown') {
        const outreachRow = {
          user_id: userId,
          job_id: jobId,
          contact_id: null,
          channel: o.channel as 'email' | 'linkedin',
          message_text: o.message,
          sent_at: new Date().toISOString(),
          response_received: false,
          outcome: 'no_response' as const,
        };

        const { error: outreachError } = await supabase
          .from('v2_outreach')
          .insert(outreachRow);

        if (!outreachError) {
          stats.outreach_logged++;
        }
      }
    }

    // Show details for this card
    const details = [
      `${card.contacts.length} contacts`,
      card.match_score ? `${card.match_score}% match` : null,
      card.salary_min && card.salary_max
        ? `$${(card.salary_min / 1000).toFixed(0)}K-$${(card.salary_max / 1000).toFixed(0)}K`
        : null,
      card.posting_status === 'dead' ? 'DEAD POSTING' : null,
    ]
      .filter(Boolean)
      .join(', ');

    console.log(`    ${card.status.toUpperCase()} | ${details}`);
  }

  // 5. Summary
  console.log('\n[5/5] Import complete\n');
  console.log('--- IMPORT SUMMARY ---');
  console.log(`Jobs imported:    ${stats.jobs_imported}`);
  console.log(`Jobs skipped:     ${stats.jobs_skipped} (duplicates)`);
  console.log(`Contacts created: ${stats.contacts_created}`);
  console.log(`Contacts linked:  ${stats.contacts_linked}`);
  console.log(`Outreach logged:  ${stats.outreach_logged}`);

  if (stats.warnings.length > 0) {
    console.log(`\nWarnings (${stats.warnings.length}):`);
    for (const w of stats.warnings) {
      console.log(`  - ${w}`);
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
