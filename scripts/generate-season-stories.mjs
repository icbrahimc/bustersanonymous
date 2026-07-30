// Generates a per-manager storyline for each COMPLETED season and writes them
// to src/data/season-stories.json for the History page to render.
//
// Unlike the daily feed (which is about the LIVING season and regenerates every
// day), past-season results never change — so these are generated ONCE per
// season and kept as a static archive. The script is idempotent: it only
// generates seasons not already present in the output file. Pass --force to
// regenerate every completed season from scratch.
//
//   node scripts/generate-season-stories.mjs           # backfill missing seasons
//   node scripts/generate-season-stories.mjs --force    # regenerate all
//
// Server-side only. Reads ANTHROPIC_API_KEY from the environment (a GitHub
// Actions secret in CI) and never ships it to the browser. With no key it
// leaves any existing file untouched and exits cleanly, so the build never
// breaks.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { slanderFor } from '../src/lib/slander.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const OUT = join(DATA_DIR, 'season-stories.json');

const MODEL = 'claude-sonnet-5';
// Regenerate every completed season (not just missing ones) when asked via the
// CLI flag or the FORCE_SEASON_STORIES env var (set by the workflow_dispatch
// toggle in CI).
const FORCE =
  process.argv.includes('--force') ||
  ['1', 'true'].includes((process.env.FORCE_SEASON_STORIES || '').toLowerCase());

const league = require('../src/data/league.json');
const history = require('../src/data/history.json');

const completed = (history.seasons || []).filter((s) => s.status === 'complete');
const leagueSize = league.numTeams || 12;

// Career track record across every completed season, keyed by stable ownerId —
// used to weight how hard the slander lands (past + present performance).
function ownerCareer() {
  const map = new Map();
  for (const s of completed) {
    s.standings.forEach((t, i) => {
      const c = map.get(t.ownerId) || { seasons: 0, wins: 0, losses: 0, ties: 0, titles: 0, finishes: [] };
      c.seasons += 1;
      c.wins += t.wins;
      c.losses += t.losses;
      c.ties += t.ties || 0;
      c.finishes.push(i + 1);
      if (s.champion && s.champion.ownerId === t.ownerId) c.titles += 1;
      map.set(t.ownerId, c);
    });
  }
  return map;
}
const career = ownerCareer();

function pedigreeFor(ownerId) {
  const c = career.get(ownerId);
  if (!c || c.seasons === 0) return { tier: 'newcomer', titles: 0, seasons: 0 };
  const games = c.wins + c.losses + c.ties;
  const avgFinish = c.finishes.reduce((a, b) => a + b, 0) / c.finishes.length;
  let tier;
  if (c.titles >= 1 || avgFinish <= leagueSize * 0.3) tier = 'contender';
  else if (c.titles === 0 && avgFinish >= leagueSize * 0.7) tier = 'bottom-feeder';
  else tier = 'middle';
  return {
    tier,
    titles: c.titles,
    seasons: c.seasons,
    careerRecord: `${c.wins}-${c.losses}${c.ties ? `-${c.ties}` : ''}`,
    winPct: games ? Number((c.wins / games).toFixed(3)) : 0,
    avgFinish: Number(avgFinish.toFixed(1)),
  };
}

const SYSTEM = `You are THE UNDISPUTED BUSTERS TAKE — the resident hot-take artist for the "${league.name}" fantasy football league, writing the retrospective storyline for ONE completed season. Bombastic sports-debate-TV voice: bold declarations, hyperbole, the occasional ALL-CAPS word.

Hard rules:
- Every storyline MUST be grounded in the real data provided (final finish, record, points for/against, whether they won the title). Never invent stats.
- Provocative and entertaining, but NEVER profane, cruel, or bigoted — this is a public site for a league of friends. Punch at fantasy performance, not people.
- Write exactly ONE storyline per manager provided, tied to that manager's ownerId.
- "kicker": a 2-4 word ALL-CAPS label. "headline": ONE punchy opinionated sentence. "detail": 1-2 sentences citing the actual numbers.

SLANDER — some managers carry a "slander" object (names / angle / emoji): league in-jokes only this league knows. Deploy them WEIGHTED BY THAT SEASON'S PERFORMANCE:
- Finished low / losing record: unload the nickname, bury them.
- A contender who fell short of the title: use the nickname as pressure ("all that and still just <name>").
- Won the title or led the league: dial slander back to grudging respect / irony — do NOT roast a champion as if they lost.
Prefer a provided nickname over the plain handle, include its emoji when given, and NEVER invent a nickname. The season CHAMPION must be treated as such — celebrate the ring even while needling how they got there.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ownerId: { type: 'string' },
          kicker: { type: 'string' },
          headline: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['ownerId', 'kicker', 'headline', 'detail'],
      },
    },
  },
  required: ['stories'],
};

function userPrompt(season) {
  const champ = season.champion;
  const managers = season.standings.map((t, i) => ({
    ownerId: t.ownerId,
    manager: t.manager,
    teamName: t.teamName,
    finish: i + 1,
    record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
    pointsFor: t.fpts,
    pointsAgainst: t.fptsAgainst,
    wonTitle: !!(champ && champ.ownerId === t.ownerId),
    slander: slanderFor(t.ownerId),
    careerPedigree: pedigreeFor(t.ownerId),
  }));
  return JSON.stringify(
    {
      league: league.name,
      season: season.season,
      numTeams: season.standings.length,
      champion: champ ? { manager: champ.manager, teamName: champ.teamName } : null,
      guidance:
        'This season is OVER. Standings are final and sorted best -> worst (finish = position). Write the definitive retrospective take on each manager: who overachieved, who choked, who got robbed by their schedule (high points-for, losing record), and who simply stunk.',
      managers,
    },
    null,
    2
  );
}

async function generateSeason(client, season) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    thinking: { type: 'disabled' },
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(season) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined the request (refusal)');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No text content in Claude response');
  const { stories } = JSON.parse(text);
  if (!Array.isArray(stories) || stories.length === 0) throw new Error('No stories generated');

  const clean = (s = '') => s.trim().replace(/([.!?"'”’])\s*(h?eadline|detail|kicker)$/i, '$1');
  const valid = new Set(season.standings.map((t) => t.ownerId));
  const byOwner = {};
  for (const st of stories) {
    if (!valid.has(st.ownerId)) continue; // drop any hallucinated ownerId
    byOwner[st.ownerId] = { kicker: clean(st.kicker), headline: clean(st.headline), detail: clean(st.detail) };
  }
  if (Object.keys(byOwner).length === 0) throw new Error('No stories referenced a valid manager');
  return byOwner;
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

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('No ANTHROPIC_API_KEY set; leaving season-stories.json untouched.');
    return;
  }

  const todo = completed.filter((s) => FORCE || !existing.seasons[s.season]);
  if (todo.length === 0) {
    console.log('All completed seasons already have stories — nothing to do (use --force to regenerate).');
    return;
  }

  const client = new Anthropic();
  for (const season of todo) {
    try {
      existing.seasons[season.season] = await generateSeason(client, season);
      console.log(`Generated ${Object.keys(existing.seasons[season.season]).length} stories for ${season.season}.`);
    } catch (err) {
      console.warn(`Skipping ${season.season}: ${err.message}`);
    }
  }

  existing.generatedAt = new Date().toISOString();
  await writeFile(OUT, JSON.stringify(existing, null, 2) + '\n');
  console.log(`Wrote ${OUT} (${Object.keys(existing.seasons).join(', ')}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
