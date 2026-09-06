// Fetches this season's draft picks from the public Sleeper API and writes
// src/data/draft.json — the raw pick-by-pick board that both the Draft Grades
// page and generate-draft-grades.mjs read.
//
// No API key required. Run with: npm run fetch-draft

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');

const CURRENT_LEAGUE_ID = process.env.LEAGUE_ID || '1387559727071772672';
const API = 'https://api.sleeper.app/v1';

// Same retry/backoff shape as fetch-sleeper.mjs, so a transient Sleeper
// hiccup doesn't fail the whole run.
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

// Sleeper's pick metadata already carries the player's name/position/team, so
// there's no need to pull the (huge) full player database just to label picks.
function playerName(meta = {}) {
  const name = [meta.first_name, meta.last_name].filter(Boolean).join(' ');
  return name || 'Unknown Player';
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();

  const drafts = await api(`/league/${CURRENT_LEAGUE_ID}/drafts`);
  const draft = (drafts || [])[0] || null;

  if (!draft) {
    await writeFile(
      join(DATA_DIR, 'draft.json'),
      JSON.stringify({ generatedAt, season: null, draftId: null, status: null, rounds: null, teams: [] }, null, 2) + '\n'
    );
    console.log('No draft found for this league yet.');
    return;
  }

  // Picks only exist once drafting has actually started.
  const picks = draft.status === 'pre_draft' ? [] : await api(`/draft/${draft.draft_id}/picks`);

  const byRoster = new Map();
  for (const p of picks) {
    const rid = p.roster_id;
    if (!byRoster.has(rid)) byRoster.set(rid, []);
    byRoster.get(rid).push({
      round: p.round,
      pickNo: p.pick_no,
      draftSlot: p.draft_slot,
      playerId: p.player_id,
      name: playerName(p.metadata),
      position: p.metadata?.position || null,
      team: p.metadata?.team || null,
    });
  }
  for (const list of byRoster.values()) list.sort((a, b) => a.pickNo - b.pickNo);

  const teams = [...byRoster.entries()]
    .map(([rosterId, teamPicks]) => ({ rosterId, picks: teamPicks }))
    .sort((a, b) => a.rosterId - b.rosterId);

  const out = {
    generatedAt,
    season: draft.season,
    draftId: draft.draft_id,
    status: draft.status, // 'pre_draft' | 'drafting' | 'paused' | 'complete'
    rounds: draft.settings?.rounds ?? null,
    teams,
  };
  await writeFile(join(DATA_DIR, 'draft.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote draft.json: draft ${draft.draft_id} (${draft.status}), ${picks.length} picks across ${teams.length} teams.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
