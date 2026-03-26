/**
 * /api/generate.js — Vercel Serverless Function (CommonJS)
 * Secure proxy between browser and Anthropic API.
 * API key never exposed to client.
 */

const ALLOWED_ORIGIN   = process.env.ALLOWED_ORIGIN || 'https://quick-implementation.vercel.app';
const MAX_IDEA_LEN     = 1500;
const MAX_USER_LEN     = 200;
const MAX_PLAN_LEN     = 8000;
const MAX_TOKENS       = 1500;
const ANTHROPIC_URL    = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL  = 'claude-sonnet-4-5';
const ANTHROPIC_VER    = '2023-06-01';

const VALID_PRIORITIES = new Set(['Speed', 'Scalability', 'Balanced']);
const VALID_EXP        = new Set(['Beginner', 'Intermediate']);
const VALID_DEPTHS     = new Set(['Simple', 'Detailed']);
const VALID_STEPS      = new Set(['plan', 'critic']);

const PM_SYSTEM = `You are an AI Product Manager and Junior Software Architect.
Transform the raw idea into a clear, structured, executable software plan.
Follow this EXACT structure — never skip sections.

1. PROJECT SUMMARY
- What is being built / Who it is for / What problem it solves

2. MVP FEATURES (ONLY 3-5)
- Essential features only, no nice-to-haves, each clearly defined

3. USER FLOW (STEP-BY-STEP)
- How a user interacts from start to finish

4. TECHNICAL PLAN (BEGINNER-FRIENDLY)
- Simple stack recommendation (Next.js, API routes, minimal backend)
- Reason for each choice, no unnecessary complexity

5. SYSTEM DESIGN (SIMPLE)
- Frontend responsibilities / Backend responsibilities / AI integration points

6. STEP-BY-STEP BUILD PLAN
- Clear actionable steps, assume a beginner builder

7. RISKS & LIMITATIONS
- What could go wrong / Where user may struggle / What is intentionally simplified

8. IMMEDIATE NEXT ACTION
- One specific action to take in the next 30 minutes

9. AI BUILDER HANDOFF PROMPT
A clean copy-paste prompt for an AI coding assistant:
project description, features, tech stack, requirements (beginner-friendly, step-by-step, no skipped steps)

RULES: Be concise but specific. No vague advice. No overengineering. Simplest working solution.`;

const CRITIC_SYSTEM = `You are a strict technical reviewer.
Review the plan and identify issues, then rewrite it to be simpler, clearer, and more actionable.
Do NOT add new features — only improve clarity and execution.

Respond in EXACTLY this format:

ISSUES FOUND
[numbered list of specific issues]

REVISED PLAN
[improved rewritten plan using the same 9-section structure]`;

function sanitize(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/\s{5,}/g, '\n').slice(0, maxLen);
}

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',      ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods',     'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',     'Content-Type');
  res.setHeader('Access-Control-Max-Age',           '86400');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
}

module.exports = async function handler(req, res) {
  setCORSHeaders(res);
  res.setHeader('Content-Type', 'application/json');

  // Preflight
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });

  // Method guard
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  // Body size guard
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 20000) return res.status(413).json({ error: 'Request too large.' });

  // API key guard
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured: API key missing.' });

  try {
    // Parse body safely
    let body = {};
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else if (typeof req.body === 'string' && req.body.trim()) {
      try { body = JSON.parse(req.body); }
      catch { return res.status(400).json({ error: 'Invalid JSON body.' }); }
    }

    const { step, idea, targetUser, priority, expLevel, depth, planText } = body;

    // Validate step
    if (!VALID_STEPS.has(step)) return res.status(400).json({ error: `Invalid step: "${step}".` });

    let system, userMsg;

    if (step === 'plan') {
      const cleanIdea = sanitize(idea, MAX_IDEA_LEN);
      const cleanUser = sanitize(targetUser, MAX_USER_LEN);
      if (!cleanIdea) return res.status(400).json({ error: 'Idea is required.' });
      if (!cleanUser) return res.status(400).json({ error: 'Target User is required.' });

      const safePriority = VALID_PRIORITIES.has(priority) ? priority : 'Balanced';
      const safeExp      = VALID_EXP.has(expLevel)        ? expLevel : 'Beginner';
      const safeDepth    = VALID_DEPTHS.has(depth)         ? depth    : 'Detailed';

      system  = PM_SYSTEM;
      userMsg = [
        `IDEA:\n${cleanIdea}`,
        `TARGET USER:\n${cleanUser}`,
        `PRIORITY:\n${safePriority}`,
        `EXPERIENCE LEVEL:\n${safeExp}`,
        `OUTPUT DEPTH:\n${safeDepth}`
      ].join('\n\n');

    } else {
      const cleanPlan = sanitize(planText, MAX_PLAN_LEN);
      if (!cleanPlan) return res.status(400).json({ error: 'Plan text is required for critique.' });
      system  = CRITIC_SYSTEM;
      userMsg = `Review this plan:\n\n${cleanPlan}`;
    }

    // Call Anthropic
    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VER
      },
      body: JSON.stringify({
        model:      ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    const anthropicData = await anthropicRes.json().catch(() => null);

    if (!anthropicRes.ok) {
      const msg = anthropicData?.error?.message || `Anthropic error ${anthropicRes.status}`;
      return res.status(anthropicRes.status).json({ error: msg });
    }

    const text = anthropicData?.content?.map(b => b.text || '').join('') || '';
    if (!text) return res.status(500).json({ error: 'Anthropic returned empty response.' });

    return res.status(200).json({ text });

  } catch (err) {
    console.error('[generate.js]', err?.message || err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
