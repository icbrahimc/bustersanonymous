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

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { buildStorylines, hasPlayed } from '../src/lib/insights.js';
import { slanderFor } from '../src/lib/slander.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');

const MODEL = 'claude-sonnet-5';
const TAKE_COUNT = 5;
// How many past editions to feed back in as story memory. Enough to carry a
// running feud across a week without bloating the prompt.
const LOOKBACK_DAYS = 5;

const FEEDS_DIR = join(DATA_DIR, 'feeds');

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

// Aggregate each manager's track record across COMPLETED seasons, keyed by the
// stable Sleeper owner id. Standings in history.json are already sorted best →
// worst, so a team's finish is its index + 1.
function ownerCareer() {
  const map = new Map();
  for (const s of history.seasons || []) {
    if (s.status !== 'complete') continue;
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
const leagueSize = league.numTeams || standings.length || 12;

// Turn a manager's career into a pedigree/expectation profile the persona can
// weaponize: contenders get held to a higher standard, bottom-feeders get roasted.
function pedigreeFor(ownerId) {
  const c = career.get(ownerId);
  if (!c || c.seasons === 0) {
    return { tier: 'newcomer', titles: 0, seasons: 0, note: 'no track record in this league yet' };
  }
  const games = c.wins + c.losses + c.ties;
  const winPct = games ? c.wins / games : 0;
  const avgFinish = c.finishes.reduce((a, b) => a + b, 0) / c.finishes.length;
  const bestFinish = Math.min(...c.finishes);
  const worstFinish = Math.max(...c.finishes);
  // Cowboys tier: a ring or consistently near the top → sky-high expectations.
  // Browns tier: no rings and living in the basement → franchise futility.
  let tier;
  if (c.titles >= 1 || avgFinish <= leagueSize * 0.3) tier = 'contender';
  else if (c.titles === 0 && avgFinish >= leagueSize * 0.7) tier = 'bottom-feeder';
  else tier = 'middle';
  return {
    tier,
    titles: c.titles,
    seasons: c.seasons,
    careerRecord: `${c.wins}-${c.losses}${c.ties ? `-${c.ties}` : ''}`,
    winPct: Number(winPct.toFixed(3)),
    avgFinish: Number(avgFinish.toFixed(1)),
    bestFinish,
    worstFinish,
  };
}
const authorFor = (team) => ({
  name: team.teamName,
  handle: handle(team.manager),
  avatar: team.avatar,
});

// Read the last few archived editions so the persona can CONTINUE storylines
// across the season — running feuds, callbacks, escalating beef — instead of
// firing off a disconnected fresh batch each day. The committed feeds/*.json
// files ARE the memory; no database needed. Excludes `today` so a same-day
// re-run never feeds the current edition back into itself.
async function recentEditions(today) {
  let files;
  try {
    files = await readdir(FEEDS_DIR);
  } catch {
    return []; // no archive yet (first ever run)
  }
  const dates = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .filter((d) => d < today)
    .sort((a, b) => (a < b ? 1 : -1)) // newest first
    .slice(0, LOOKBACK_DAYS);

  const editions = [];
  for (const d of dates) {
    try {
      const edition = JSON.parse(await readFile(join(FEEDS_DIR, `${d}.json`), 'utf8'));
      editions.push({
        date: d,
        takes: (edition.posts || []).map((p) => ({
          manager: p.author?.handle,
          kicker: p.kicker,
          headline: p.headline,
        })),
      });
    } catch {
      /* skip an unreadable edition file */
    }
  }
  return editions;
}

// ---- persona ----------------------------------------------------------------

const SYSTEM = `You are THE UNDISPUTED BUSTERS TAKE — the resident hot-take artist for the "${league.name}" fantasy football league. You write in the bombastic, provocative style of a brash sports-debate TV host: bold declarations, manufactured beef between teams, unshakable confidence, hyperbole, and the occasional ALL-CAPS word for emphasis.

Hard rules:
- Every take MUST be grounded in the real data provided. Reference actual team names, managers, records, point totals, and TRACK RECORD — never invent stats.
- Entertaining and provocative, but NEVER profane, cruel, or bigoted. This is a public site for a league of friends. Punch at fantasy performance and expectations, not people.
- Each take is tied to exactly one real team by its rosterId from the provided roster.
- "kicker": a 2-4 word ALL-CAPS label (e.g. "TITLE DEFENSE", "DRAFT WARNING", "DISRESPECT ALERT").
- "headline": ONE punchy, opinionated sentence — the hot take itself.
- "detail": 1-2 sentences backing it up with the actual numbers or history.
- Produce exactly ${TAKE_COUNT} takes, each about a DIFFERENT team, covering different angles.

TONE — weight every take by PEDIGREE and EXPECTATIONS, like a real sports-debate show. Each team carries a "pedigree" object (tier, titles, career record, average finish):
- tier "contender" (a ring, or consistently near the top): treat them like the DALLAS COWBOYS — enormous reputation, sky-high expectations, and a target on their back. Hold them to their own hype and roast any sign they'll fall short of it. Invoke their past glory as PRESSURE ("all that pedigree and…", "rings mean nothing if…"). Doubt is the default; make them prove it.
- tier "bottom-feeder" (no titles, a history of finishing near the bottom): DOG them like the CLEVELAND BROWNS — lean into the franchise futility, the losing culture, the "here we go again" energy. Pile on the track record of disappointment.
- tier "middle": faint praise or "prove-it" skepticism — respectable but forgettable, nobody's scared of them.
- tier "newcomer" (no league history): unproven — question whether they belong or hype them as a wildcard.
Reference the actual pedigree numbers (titles, average finish, career record) so the shade lands. Spread the ${TAKE_COUNT} takes across tiers — at least one Cowboys-style shot at a contender and one Browns-style burial of a bottom-feeder.

SLANDER — some teams carry a "slander" object with league in-joke nicknames (names), a running bit (angle), and sometimes an emoji. These are inside jokes only this league knows, so they make the shot land HARD. But slander is EARNED, not spammed — deploy it WEIGHTED BY PERFORMANCE (past + present), exactly like pedigree:
- Losing / bottom-feeder / underachieving: unload the nickname with no mercy — the slander is the whole point of the take (e.g. a "Bald Fraud" living down to the name).
- Contender falling short of their hype: use the nickname as PRESSURE ("all that pedigree and still just <nickname>").
- Actually winning / performing well right now: dial the slander WAY back or flip it to grudging respect / irony — do NOT roast a manager with their nickname as if they were losing when they're not.
When you do use a slander name, prefer it over the plain manager handle, and include its emoji if one is given. Only use nicknames that are actually provided for that team — never invent one. Not every take needs slander; use it where the performance justifies it.

CONTINUITY — you are writing an ONGOING column across a season, NOT disconnected daily blasts. A "recentEditions" list may be provided: the last few days of your own takes (date, manager, kicker, headline), newest first. Treat it as the story so far and BUILD ON IT:
- Do NOT repeat a previous headline or angle — ADVANCE it. If yesterday's numbers/records are unchanged, find a fresh angle on the same team rather than restating the old take.
- Turn past takes into running storylines: a manager you warned is now proving you right (or making you eat your words), a feud you started that's escalating, a bold prediction inching toward coming true — or blowing up in your face.
- When a through-line lands, reference it out loud so readers feel the serialized drama ("Told you three days ago…", "The Bald Fraud saga rolls on…", "Remember when I said…").
- It's fine to stay on a team across multiple days while their arc develops, but keep spreading takes across the league over the week — don't tunnel on one manager every single day.
- When "recentEditions" is empty or absent, this is the SEASON OPENER — set the storylines and rivalries up so future editions have something to escalate.`;

function userPrompt(recentEds = []) {
  const teams = standings.map((t) => ({
    rosterId: t.rosterId,
    teamName: t.teamName,
    manager: t.manager,
    record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
    pointsFor: t.fpts,
    division: t.division ? league.divisions?.[t.division] || `Division ${t.division}` : null,
    pedigree: pedigreeFor(t.ownerId), // career track record → expectation level
    slander: slanderFor(t.ownerId), // league in-joke nickname(s), if any → deploy weighted by performance
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
      // The story so far — your own takes from the last few days, newest first.
      // Advance these storylines; do not repeat them. Empty on the season opener.
      recentEditions: recentEds,
      guidance: seasonStarted
        ? 'The season is underway — argue about who is for real, who is a fraud, and who is choking, using the records and points-for. Continue the storylines in recentEditions instead of starting from scratch.'
        : 'It is the PRESEASON (pre-draft). No games played yet, so all records are 0-0. Hype the title defense, stir up draft-night beef, manufacture division rivalries, and issue bold predictions. Do NOT cite win/loss records as if games were played. Build on any beef already started in recentEditions.',
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

async function generateWithClaude(recentEds = []) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

  const response = await client.messages.create({
    model: MODEL,
    // Headroom for ${TAKE_COUNT} takes plus the richer pedigree/slander
    // guidance — too tight and the JSON gets truncated mid-take (which the
    // structured-output decoder then force-closes into a broken stub post).
    max_tokens: 4000,
    thinking: { type: 'disabled' }, // short creative task — keep it fast/cheap
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(recentEds) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined the request (refusal)');
  }
  // Truncated output = a half-written, schema-force-closed feed. Reject it so we
  // fall back to the full deterministic feed rather than ship a stub.
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude response hit max_tokens (truncated)');
  }

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No text content in Claude response');

  const { posts } = JSON.parse(text);
  if (!Array.isArray(posts) || posts.length === 0) throw new Error('No posts generated');

  // Occasionally a structured-output run glues a schema field name onto the end
  // of a value (e.g. "...draft night.eadline"). Strip that trailing artifact
  // only when it's fused directly onto sentence-ending punctuation, so real
  // prose is never clipped.
  const clean = (s = '') =>
    s.trim().replace(/([.!?"'”’])\s*(h?eadline|detail|kicker)$/i, '$1');

  // Resolve each take's author from the real roster; drop any bad rosterId.
  const resolved = posts
    .map((p) => {
      const team = teamById.get(p.rosterId);
      if (!team) return null;
      return {
        author: authorFor(team),
        meta,
        kicker: clean(p.kicker),
        headline: clean(p.headline),
        detail: clean(p.detail),
      };
    })
    .filter(Boolean);

  if (resolved.length === 0) throw new Error('No takes referenced a valid team');
  // Expect a full slate of takes. A short result means the generation was
  // truncated or malformed — fall back to the deterministic feed rather than
  // ship a sparse one-post feed.
  if (resolved.length < TAKE_COUNT) {
    throw new Error(`Only ${resolved.length}/${TAKE_COUNT} valid takes generated`);
  }
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

  const generatedAt = new Date().toISOString();
  const date = generatedAt.slice(0, 10); // YYYY-MM-DD (UTC), one edition per day

  // Load the last few editions as story memory so the persona continues
  // storylines instead of starting cold. Excludes today's edition.
  const recent = await recentEditions(date);
  if (recent.length) {
    console.log(`Loaded ${recent.length} past edition(s) as storyline context.`);
  }

  const keyPresent = !!process.env.ANTHROPIC_API_KEY;
  let posts;
  let mode;
  let diagnostic = null; // non-secret: presence flag + error message only
  if (keyPresent) {
    try {
      posts = await generateWithClaude(recent);
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
    date,
    season: league.season,
    generatedAt,
    model: mode === 'ai' ? MODEL : null,
    mode,
    keyPresent,
    diagnostic,
    meta,
    posts,
  };

  // 1) Latest edition — what the Home / Weekly Insights pages render.
  await writeFile(join(DATA_DIR, 'feed.json'), JSON.stringify(feed, null, 2) + '\n');

  // 2) Dated archive snapshot — one file per day, kept forever so past editions
  //    stay retrievable once the season is underway.
  await mkdir(FEEDS_DIR, { recursive: true });
  await writeFile(join(FEEDS_DIR, `${date}.json`), JSON.stringify(feed, null, 2) + '\n');

  // 3) Archive index (newest first) so the site can list past editions cheaply.
  let index = [];
  try {
    index = JSON.parse(await readFile(join(FEEDS_DIR, 'index.json'), 'utf8'));
  } catch {
    /* first run — no index yet */
  }
  index = index.filter((e) => e.date !== date); // re-running the same day replaces it
  index.push({ date, season: league.season, status: league.status, mode, generatedAt, postCount: posts.length });
  index.sort((a, b) => (a.date < b.date ? 1 : -1));
  await writeFile(join(FEEDS_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');

  console.log(`Wrote feed.json + feeds/${date}.json (${mode}, ${posts.length} posts). Archive: ${index.length} edition(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
