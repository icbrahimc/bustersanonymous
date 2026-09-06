// Generates a letter grade + hot take for every team's completed draft and
// writes them to src/data/draft-grades.json for the Draft Grades page.
//
// A draft never changes once it closes, so — like generate-season-stories.mjs
// — this runs ONCE per season and is idempotent: it skips a season that
// already has grades for the current draftId. Pass --force (or set
// FORCE_DRAFT_GRADES) to regenerate anyway.
//
//   node scripts/generate-draft-grades.mjs           # generate if missing
//   node scripts/generate-draft-grades.mjs --force    # regenerate
//
// Server-side only. Reads ANTHROPIC_API_KEY from the environment (a GitHub
// Actions secret in CI) and never ships it to the browser. With no key, or
// before the draft is complete, it leaves any existing file untouched so the
// build never breaks.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { slanderFor } from '../src/lib/slander.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const OUT = join(DATA_DIR, 'draft-grades.json');

const MODEL = 'claude-sonnet-5';
const FORCE =
  process.argv.includes('--force') ||
  ['1', 'true'].includes((process.env.FORCE_DRAFT_GRADES || '').toLowerCase());

const league = require('../src/data/league.json');
const standingsData = require('../src/data/standings.json');
const draftData = require('../src/data/draft.json');

const teamById = new Map((standingsData.standings || []).map((t) => [t.rosterId, t]));

const SYSTEM = `You are THE UNDISPUTED BUSTERS TAKE — the resident hot-take artist for the "${league.name}" fantasy football league — grading every team's draft the moment it closes. Bombastic sports-debate-TV voice: bold declarations, hyperbole, the occasional ALL-CAPS word.

Hard rules:
- Ground every grade in the ACTUAL picks provided — the real players, positions, NFL teams, and the round/pick number each was taken. Never invent a stat, injury, or storyline not implied by the real player.
- Use your own knowledge of these real NFL players — their talent level, role, and typical draft cost — to judge whether each pick was a steal, fair value, or a reach. Reward teams who got difference-makers late and ding teams who reached early or built an unbalanced/risky roster.
- Assign exactly one standard letter grade per team from this set: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F. Spread grades across the field like a real report card — not everyone can be a B+; hand out the A's and the F's where the picks actually justify them.
- Entertaining and provocative, but NEVER profane, cruel, or bigoted — this is a public site for a league of friends. Punch at the draft picks, not the people.
- "kicker": a 2-4 word ALL-CAPS label (e.g. "STEAL OF THE DRAFT", "REACH CENTRAL", "POSITION PANIC").
- "headline": ONE punchy, opinionated sentence delivering the grade's verdict.
- "detail": 1-2 sentences backing it up by naming specific picks (player, round, or both).
- Grade exactly one team per rosterId provided — every team gets a grade.

SLANDER — some teams carry a "slander" object with league in-joke nicknames (names), a running bit (angle), and sometimes an emoji. Deploy it only where the draft actually earns it (a nickname-worthy reach or a nickname-defying steal) — never spam it, and never invent a nickname that isn't provided.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    grades: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rosterId: { type: 'integer' },
          grade: { type: 'string' },
          kicker: { type: 'string' },
          headline: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['rosterId', 'grade', 'kicker', 'headline', 'detail'],
      },
    },
  },
  required: ['grades'],
};

function userPrompt() {
  const teams = (draftData.teams || []).map((t) => {
    const std = teamById.get(t.rosterId);
    return {
      rosterId: t.rosterId,
      teamName: std?.teamName || `Team ${t.rosterId}`,
      manager: std?.manager || 'Unknown',
      slander: std ? slanderFor(std.ownerId) : null,
      picks: (t.picks || []).map((p) => ({
        round: p.round,
        pickNo: p.pickNo,
        player: p.name,
        position: p.position,
        nflTeam: p.team,
      })),
    };
  });

  return JSON.stringify(
    {
      league: league.name,
      season: draftData.season,
      rounds: draftData.rounds,
      numTeams: teams.length,
      guidance:
        'The draft is COMPLETE. Grade every roster below on how well it was drafted — value relative to round, positional balance, and upside — using real knowledge of these players. This is a report card for draft day only; do not discuss the regular season.',
      teams,
    },
    null,
    2
  );
}

async function generateGrades(client) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'disabled' },
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt() }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });

  if (response.stop_reason === 'refusal') throw new Error('Claude declined the request (refusal)');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude response hit max_tokens (truncated)');

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No text content in Claude response');

  const { grades } = JSON.parse(text);
  if (!Array.isArray(grades) || grades.length === 0) throw new Error('No grades generated');

  const clean = (s = '') => s.trim().replace(/([.!?"'”’])\s*(h?eadline|detail|kicker|grade)$/i, '$1');
  const valid = new Set((draftData.teams || []).map((t) => t.rosterId));
  const byRoster = {};
  for (const g of grades) {
    if (!valid.has(g.rosterId)) continue; // drop any hallucinated rosterId
    byRoster[g.rosterId] = {
      grade: clean(g.grade),
      kicker: clean(g.kicker),
      headline: clean(g.headline),
      detail: clean(g.detail),
    };
  }
  if (Object.keys(byRoster).length === 0) throw new Error('No grades referenced a valid team');
  return byRoster;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  let existing = { generatedAt: null, seasons: {} };
  try {
    existing = JSON.parse(await readFile(OUT, 'utf8'));
    existing.seasons = existing.seasons || {};
  } catch {
    /* first run */
  }

  if (draftData.status !== 'complete' || !draftData.draftId) {
    console.log('Draft is not complete yet; leaving draft-grades.json untouched.');
    return;
  }

  const already = existing.seasons[draftData.season];
  if (already && already.draftId === draftData.draftId && !FORCE) {
    console.log(`Draft grades already generated for ${draftData.season} — nothing to do (use --force to regenerate).`);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('No ANTHROPIC_API_KEY set; leaving draft-grades.json untouched.');
    return;
  }

  const client = new Anthropic();
  try {
    const grades = await generateGrades(client);
    existing.seasons[draftData.season] = {
      draftId: draftData.draftId,
      generatedAt: new Date().toISOString(),
      grades,
    };
    existing.generatedAt = new Date().toISOString();
    await writeFile(OUT, JSON.stringify(existing, null, 2) + '\n');
    console.log(`Wrote draft grades for ${draftData.season}: ${Object.keys(grades).length} team(s).`);
  } catch (err) {
    console.warn(`Draft grade generation failed (non-fatal): ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
