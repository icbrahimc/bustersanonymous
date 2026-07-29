// Generates the league feed as Skip-Bayless-style hot takes using Claude, and
// writes them to src/data/feed.json for the static build to render.
//
// Architecture: this runs in the daily GitHub Action (server-side). The
// ANTHROPIC_API_KEY lives in a GitHub Actions secret and is NEVER shipped to
// the browser — the site only ever reads the pre-generated feed.json.
//
// If no API key is available (e.g. local dev) or the API call fails, we fall
// back to the deterministic storylines in src/lib/insights.js so the site
// always has a feed and the build never breaks.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { buildStorylines, hasPlayed } from '../src/lib/insights.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');

const MODEL = 'claude-sonnet-5';
const TAKE_COUNT = 5;

const league = require('../src/data/league.json');
const standingsData = require('../src/data/standings.json');
const history = require('../src/data/history.json');

const standings = standingsData.standings || [];
const seasonStarted = hasPlayed(standings);
const meta = seasonStarted ? 'Season to date' : 'Preseason';
const lastCompleted = (history.seasons || []).find((s) => s.status === 'complete');
const lastChampion = lastCompleted?.champion || null;

const teamById = new Map(standings.map((t) => [t.rosterId, t]));
const handle = (name = '') => name.replace(/[^a-zA-Z0-9_]/g, '') || 'manager';
const authorFor = (team) => ({
  name: team.teamName,
  handle: handle(team.manager),
  avatar: team.avatar,
});

// ---- persona ----------------------------------------------------------------

const SYSTEM = `You are THE UNDISPUTED BUSTERS TAKE — the resident hot-take artist for the "${league.name}" fantasy football league. You write in the bombastic, provocative style of a brash sports-debate TV host: bold declarations, manufactured beef between teams, unshakable confidence, hyperbole, and the occasional ALL-CAPS word for emphasis.

Hard rules:
- Every take MUST be grounded in the real data provided. Reference actual team names, managers, records, and point totals — never invent stats.
- Entertaining and provocative, but NEVER profane, cruel, or bigoted. This is a public site for a league of friends. Punch at fantasy performance, not people.
- Each take is tied to exactly one real team by its rosterId from the provided roster.
- "kicker": a 2-4 word ALL-CAPS label (e.g. "TITLE DEFENSE", "DRAFT WARNING", "DISRESPECT ALERT").
- "headline": ONE punchy, opinionated sentence — the hot take itself.
- "detail": 1-2 sentences backing it up with the actual numbers or context.
- Produce exactly ${TAKE_COUNT} takes, each about a DIFFERENT team, covering different angles.`;

function userPrompt() {
  const teams = standings.map((t) => ({
    rosterId: t.rosterId,
    teamName: t.teamName,
    manager: t.manager,
    record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
    pointsFor: t.fpts,
    division: t.division ? league.divisions?.[t.division] || `Division ${t.division}` : null,
  }));

  return JSON.stringify(
    {
      league: league.name,
      season: league.season,
      status: league.status,
      seasonStarted,
      divisions: league.divisions,
      reigningChampion: lastChampion
        ? { teamName: lastChampion.teamName, manager: lastChampion.manager, season: lastCompleted.season }
        : null,
      teams,
      guidance: seasonStarted
        ? 'The season is underway — argue about who is for real, who is a fraud, and who is choking, using the records and points-for.'
        : 'It is the PRESEASON (pre-draft). No games played yet, so all records are 0-0. Hype the title defense, stir up draft-night beef, manufacture division rivalries, and issue bold predictions. Do NOT cite win/loss records as if games were played.',
    },
    null,
    2
  );
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rosterId: { type: 'integer' },
          kicker: { type: 'string' },
          headline: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['rosterId', 'kicker', 'headline', 'detail'],
      },
    },
  },
  required: ['posts'],
};

// ---- generation -------------------------------------------------------------

async function generateWithClaude() {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'disabled' }, // short creative task — keep it fast/cheap
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt() }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined the request (refusal)');
  }

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No text content in Claude response');

  const { posts } = JSON.parse(text);
  if (!Array.isArray(posts) || posts.length === 0) throw new Error('No posts generated');

  // Resolve each take's author from the real roster; drop any bad rosterId.
  const resolved = posts
    .map((p) => {
      const team = teamById.get(p.rosterId);
      if (!team) return null;
      return {
        author: authorFor(team),
        meta,
        kicker: p.kicker,
        headline: p.headline,
        detail: p.detail,
      };
    })
    .filter(Boolean);

  if (resolved.length === 0) throw new Error('No takes referenced a valid team');
  return resolved;
}

// Deterministic fallback (no API key, or the call failed): the storylines the
// site used before AI generation. Same shape as the AI posts.
function fallbackPosts() {
  return buildStorylines({
    standings,
    lastChampion,
    status: league.status,
    leagueName: league.name,
  });
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const keyPresent = !!process.env.ANTHROPIC_API_KEY;
  let posts;
  let mode;
  let diagnostic = null; // non-secret: presence flag + error message only
  if (keyPresent) {
    try {
      posts = await generateWithClaude();
      mode = 'ai';
      console.log(`Generated ${posts.length} hot takes with ${MODEL}.`);
    } catch (err) {
      diagnostic = `generation error: ${err.message}`;
      console.warn(`Claude generation failed (${err.message}); using deterministic fallback.`);
      posts = fallbackPosts();
      mode = 'fallback';
    }
  } else {
    diagnostic = 'ANTHROPIC_API_KEY not set in this environment';
    console.log('No ANTHROPIC_API_KEY set; writing deterministic fallback feed.');
    posts = fallbackPosts();
    mode = 'fallback';
  }

  const feed = {
    generatedAt: new Date().toISOString(),
    model: mode === 'ai' ? MODEL : null,
    mode,
    keyPresent,
    diagnostic,
    meta,
    posts,
  };
  await writeFile(join(DATA_DIR, 'feed.json'), JSON.stringify(feed, null, 2) + '\n');
  console.log(`Wrote src/data/feed.json (${mode}, ${posts.length} posts).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
