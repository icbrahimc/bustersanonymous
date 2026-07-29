// Fetches the league's data from the public Sleeper API and writes a set of
// small JSON files into src/data/ that the Astro pages read at build time.
//
// No API key is required — Sleeper's read API is public.
// Run with:  npm run fetch-data
//
// The current league id can be overridden with the LEAGUE_ID env var so the
// same script keeps working when next season rolls over.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');

const CURRENT_LEAGUE_ID = process.env.LEAGUE_ID || '1387559727071772672';
const API = 'https://api.sleeper.app/v1';

// Fetch with retry + backoff so a transient Sleeper hiccup (429 / 5xx / network
// blip) doesn't fail the whole run.
async function api(path, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Sleeper ${path} -> ${res.status} ${res.statusText}`);
      }
      if (!res.ok) throw new Error(`Sleeper ${path} -> ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        const wait = 500 * 2 ** (i - 1);
        console.warn(`  retry ${i}/${attempts - 1} for ${path} in ${wait}ms (${err.message})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// Sleeper stores avatars two ways: a full URL in user.metadata.avatar, or a
// bare id in user.avatar that needs the CDN prefix. Prefer the explicit URL.
function avatarUrl(user) {
  const meta = user?.metadata?.avatar;
  if (meta && meta.startsWith('http')) return meta;
  if (user?.avatar) return `https://sleepercdn.com/avatars/thumbs/${user.avatar}`;
  return null;
}

// Build a per-team row from a roster + its owning user.
function teamRow(roster, usersById) {
  const user = usersById.get(roster.owner_id);
  const s = roster.settings || {};
  const fpts = Number(s.fpts || 0) + Number(s.fpts_decimal || 0) / 100;
  const fptsAgainst = Number(s.fpts_against || 0) + Number(s.fpts_against_decimal || 0) / 100;
  return {
    rosterId: roster.roster_id,
    ownerId: roster.owner_id,
    teamName: user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`,
    manager: user?.display_name || 'Unknown',
    avatar: avatarUrl(user),
    division: s.division ?? null,
    wins: s.wins || 0,
    losses: s.losses || 0,
    ties: s.ties || 0,
    fpts: Math.round(fpts * 100) / 100,
    fptsAgainst: Math.round(fptsAgainst * 100) / 100,
  };
}

// Standings: most wins first, then points-for as the tiebreaker.
function sortStandings(rows) {
  return [...rows].sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
}

// Pull one full season's worth of data.
async function loadSeason(leagueId) {
  const [league, rosters, users] = await Promise.all([
    api(`/league/${leagueId}`),
    api(`/league/${leagueId}/rosters`),
    api(`/league/${leagueId}/users`),
  ]);
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const teams = rosters.map((r) => teamRow(r, usersById));
  const standings = sortStandings(teams);

  // The championship game in the winners bracket is the one placing 1st (p === 1).
  let champion = null;
  if (league.status === 'complete') {
    try {
      const bracket = await api(`/league/${leagueId}/winners_bracket`);
      const final = bracket.find((g) => g.p === 1 && g.w != null);
      if (final) champion = teams.find((t) => t.rosterId === final.w) || null;
    } catch {
      // Bracket may not exist for very old / unusual leagues — leave champion null.
    }
  }

  return {
    leagueId,
    season: league.season,
    name: league.name,
    status: league.status,
    previousLeagueId: league.previous_league_id || null,
    divisions: {
      1: league.metadata?.division_1 || null,
      2: league.metadata?.division_2 || null,
    },
    playoffWeekStart: league.settings?.playoff_week_start ?? null,
    numTeams: league.settings?.num_teams ?? teams.length,
    standings,
    champion,
  };
}

// Walk previous_league_id backwards to collect every season, newest first.
async function loadAllSeasons(startId) {
  const seasons = [];
  let id = startId;
  const guard = new Set(); // avoid any accidental cycle
  while (id && !guard.has(id)) {
    guard.add(id);
    const season = await loadSeason(id);
    seasons.push(season);
    id = season.previousLeagueId;
  }
  return seasons; // newest -> oldest
}

// Aggregate all-time records across every completed/active season.
function allTimeRecords(seasons) {
  let mostPF = null; // single-season points-for
  let mostWins = null; // single-season wins
  const titles = new Map(); // manager -> championship count

  for (const s of seasons) {
    for (const t of s.standings) {
      if (!mostPF || t.fpts > mostPF.fpts) mostPF = { ...t, season: s.season };
      if (!mostWins || t.wins > mostWins.wins) mostWins = { ...t, season: s.season };
    }
    if (s.champion) {
      titles.set(s.champion.manager, (titles.get(s.champion.manager) || 0) + 1);
    }
  }

  const mostTitles = [...titles.entries()]
    .map(([manager, count]) => ({ manager, count }))
    .sort((a, b) => b.count - a.count);

  return { mostPF, mostWins, mostTitles };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const seasons = await loadAllSeasons(CURRENT_LEAGUE_ID);
  if (seasons.length === 0) throw new Error('No seasons found — check LEAGUE_ID');

  const current = seasons[0];
  const generatedAt = new Date().toISOString();

  const write = (name, obj) =>
    writeFile(join(DATA_DIR, name), JSON.stringify(obj, null, 2) + '\n');

  await Promise.all([
    write('league.json', {
      generatedAt,
      leagueId: current.leagueId,
      season: current.season,
      name: current.name,
      status: current.status,
      divisions: current.divisions,
      numTeams: current.numTeams,
      playoffWeekStart: current.playoffWeekStart,
    }),
    write('standings.json', { generatedAt, season: current.season, standings: current.standings }),
    write('history.json', {
      generatedAt,
      seasons: seasons.map((s) => ({
        season: s.season,
        status: s.status,
        champion: s.champion,
        standings: s.standings,
      })),
    }),
    write('all-time.json', { generatedAt, records: allTimeRecords(seasons) }),
  ]);

  console.log(
    `Wrote data for ${seasons.length} season(s): ${seasons.map((s) => s.season).join(', ')} ` +
      `(current: ${current.name} ${current.season}, status ${current.status})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
