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

type JdTheme = 'leadership' | 'ai_ml' | 'scale' | 'transformation' | 'revenue' | 'startup' | 'technical' | 'product';

function detectThemes(jd: string): JdTheme[] {
  const themes: JdTheme[] = [];
  const t = jd.toLowerCase();
  if (/\b(lead|director|vp|head of|manage.*team|team.*lead|build.*team|org)\b/.test(t)) themes.push('leadership');
  if (/\b(ai|machine learning|\bml\b|llm|generative ai|artificial intelligence)\b/.test(t)) themes.push('ai_ml');
  if (/\b(scale|scaling|million users?|high.traffic|platform|infrastructure|architecture)\b/.test(t)) themes.push('scale');
  if (/\b(transform|moderniz|digital transform|legacy|migration|re-architect)\b/.test(t)) themes.push('transformation');
  if (/\b(revenue|p&l|commercial|business impact|profit|growth|retain)\b/.test(t)) themes.push('revenue');
  if (/\b(startup|fast.paced|high.growth|early.stage|series [ab]|seed)\b/.test(t)) themes.push('startup');
  if (/\b(engineer|architect|backend|frontend|cloud|kubernetes|devops)\b/.test(t)) themes.push('technical');
  if (/\b(product|roadmap|strategy|cross.functional|stakeholder)\b/.test(t)) themes.push('product');
  return themes;
}

/**
 * Pull high-value sentences from resume: ones with numbers, impact verbs, metrics.
 */
function extractHighlights(resumeText: string): string[] {
  if (!resumeText) return [];
  const sentences = resumeText
    .replace(/\r?\n/g, '. ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.length < 300);

  return sentences
    .map(s => {
      let score = 0;
      if (/\d/.test(s)) score += 2;
      if (/\$\d+|\d+[km]\b|\d+%|\d+x\b/i.test(s)) score += 4;
      if (/\b(led|built|launched|scaled|managed|drove|delivered|grew|increased|reduced|generated|retained)\b/i.test(s)) score += 2;
      if (/\b(revenue|users?|engineers?|team|growth|retention|platform|org|officers?)\b/i.test(s)) score += 1;
      return { s, score };
    })
    .filter(x => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(x => x.s);
}

function themeScore(highlight: string, themes: JdTheme[]): number {
  const h = highlight.toLowerCase();
  let score = 0;
  for (const theme of themes) {
    switch (theme) {
      case 'leadership': if (/led|manag|team|org|report|direct|engineers?/.test(h)) score += 3; break;
      case 'ai_ml': if (/ai|ml|machine|model|data|intelligent/.test(h)) score += 3; break;
      case 'scale': if (/scale|million|users?|platform|traffic|growth/.test(h)) score += 3; break;
      case 'transformation': if (/transform|modern|legacy|migrat|rebuild|rebuilt/.test(h)) score += 3; break;
      case 'revenue': if (/revenue|\$|million|billion|retained|commercial/.test(h)) score += 3; break;
      case 'startup': if (/startup|launch|zero|built|founded|greenfield/.test(h)) score += 3; break;
    }
  }
  return score;
}

function opening(profile: UserProfileForCL, job: JobDataForCL, themes: JdTheme[]): string {
  const { title, company } = job;

  if (themes.includes('ai_ml') && themes.includes('leadership')) {
    return `The convergence of AI strategy and engineering leadership is where I've spent the better part of my career — building the organizations, platforms, and products that sit at that intersection. The ${title} role at ${company} reads like the kind of opportunity where that experience creates the most leverage, and I'd love to bring it to your team.`;
  }
  if (themes.includes('leadership') && themes.includes('scale')) {
    return `Scaling engineering organizations and the platforms they build — handling the people problems alongside the technical ones — is the work I find most energizing. The ${title} opportunity at ${company} looks like exactly that challenge, and I'm writing to express strong interest.`;
  }
  if (themes.includes('transformation')) {
    return `Digital transformation at scale requires both technical vision and the organizational leadership to execute it — and it's the combination I've spent my career developing. I'm excited to explore how that background applies to the ${title} role at ${company}.`;
  }
  if (themes.includes('startup')) {
    return `There's a particular kind of clarity you get when you're building from scratch — every architectural decision matters, every hire shapes the culture. That environment is where I do my best work, and the ${title} role at ${company} sounds like exactly that moment. I'd love to be part of it.`;
  }
  if (themes.includes('revenue') || themes.includes('product')) {
    return `The most effective technology leaders I know obsess over business outcomes, not just technical elegance — they treat engineering as a growth lever. That philosophy has guided my career, and it's what draws me to the ${title} role at ${company}.`;
  }
  if (themes.includes('ai_ml')) {
    return `AI is moving from experiment to infrastructure, and the leaders who can build those systems while keeping organizations aligned are rare. I've been at that intersection for years and believe my background maps directly to the ${title} opportunity at ${company}.`;
  }

  return `I'm writing to express strong interest in the ${title} position at ${company}. My background in engineering leadership and large-scale technology transformation aligns closely with what you're describing, and I'd welcome the chance to discuss it further.`;
}

function bodyParagraph(highlights: string[], themes: JdTheme[], index: number): string | null {
  if (highlights.length <= index) return null;
  const ranked = highlights
    .map(h => ({ h, score: themeScore(h, themes) }))
    .sort((a, b) => b.score - a.score);
  const pick = ranked[index]?.h;
  if (!pick || pick.length < 25) return null;

  const firstChar = pick.charAt(0).toLowerCase();
  const rest = pick.slice(1);

  if (index === 0) {
    const context = themes.includes('leadership') ? 'organizational design and team execution'
      : themes.includes('scale') ? 'platform architecture and scale'
      : themes.includes('ai_ml') ? 'AI integration and data strategy'
      : themes.includes('revenue') ? 'driving measurable business impact'
      : 'delivering results at scale';
    return `Most recently, ${firstChar}${rest}. This kind of experience informs how I approach ${context} — not as a side effect of the work, but as the primary goal.`;
  }

  const connector = themes.includes('startup') ? 'high-velocity execution in ambiguous environments'
    : themes.includes('transformation') ? 'transformation and change management'
    : 'cross-functional leadership';
  return `I've also found that ${firstChar}${rest} — and this ${connector} is often what separates teams that scale from those that stall.`;
}

function closing(company: string): string {
  return `I'd welcome the opportunity to talk through how my background maps to what you're building at ${company}. Happy to connect at your convenience — even a 20-minute call would be valuable.`;
}

/**
 * Generate a complete cover letter text string, ready for storage and display.
 * Returns a multi-paragraph string with salutation and signature.
 */
export function generateCoverLetterText(
  profile: UserProfileForCL,
  job: JobDataForCL,
): string {
  const jd = job.job_description || '';
  const themes = detectThemes(jd);
  const highlights = extractHighlights(profile.resume_text || '');

  const parts: string[] = [
    `Dear Hiring Team at ${job.company},`,
    '',
    opening(profile, job, themes),
  ];

  const p1 = bodyParagraph(highlights, themes, 0);
  if (p1) { parts.push(''); parts.push(p1); }

  const p2 = bodyParagraph(highlights, themes, 1);
  if (p2) { parts.push(''); parts.push(p2); }

  parts.push('');
  parts.push(closing(job.company));
  parts.push('');
  parts.push('Sincerely,');
  parts.push(profile.full_name || 'Candidate');

  if (profile.profile_data?.contact_email) parts.push(profile.profile_data.contact_email);
  if (profile.profile_data?.contact_phone) parts.push(profile.profile_data.contact_phone);

  return parts.join('\n');
}
