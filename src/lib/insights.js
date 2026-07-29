// Derive human-readable "storylines" from the raw standings so the Home and
// Weekly Insights pages have something to say without hand-editing copy each
// week. Each storyline carries an `author` so it can render as a feed post
// (team avatar + @handle), X-style.

export function hasPlayed(standings = []) {
  return standings.some((t) => t.wins + t.losses + t.ties > 0);
}

// Turn a Sleeper display name into an @handle-ish string.
function handle(name = '') {
  return name.replace(/[^a-zA-Z0-9_]/g, '') || 'manager';
}

function authorFrom(team) {
  return team
    ? { name: team.teamName, handle: handle(team.manager), avatar: team.avatar }
    : null;
}

export function buildStorylines({ standings = [], lastChampion = null, status = '', leagueName = 'The League' }) {
  const leagueAuthor = { name: leagueName, handle: 'commish', avatar: null };
  const meta = hasPlayed(standings) ? 'Season to date' : 'Preseason';

  // Preseason / no games played yet: talk about the champion and what's next.
  if (!hasPlayed(standings)) {
    const items = [];
    if (lastChampion) {
      items.push({
        author: authorFrom(lastChampion),
        meta,
        kicker: 'Title Defense',
        headline: `${lastChampion.teamName} enters as reigning champ`,
        detail: `${lastChampion.manager} took home the ring last season. Everyone else is drafting to dethrone them. 💍`,
      });
    }
    items.push({
      author: leagueAuthor,
      meta,
      kicker: 'Offseason',
      headline:
        status === 'pre_draft' ? 'The draft is on the clock' : 'Season hasn’t kicked off yet',
      detail:
        'Live standings and weekly storylines fill in automatically once the games start — the site refreshes from Sleeper every day.',
    });
    return items;
  }

  const byWins = [...standings];
  const byPoints = [...standings].sort((a, b) => b.fpts - a.fpts);
  const leader = byWins[0];
  const topScorer = byPoints[0];
  const cellar = byWins[byWins.length - 1];

  const items = [
    {
      author: authorFrom(leader),
      meta,
      kicker: 'Top of the Table',
      headline: `${leader.teamName} sit atop the league`,
      detail: `${leader.wins}–${leader.losses}${leader.ties ? `–${leader.ties}` : ''} with ${leader.fpts.toFixed(1)} points for. Setting the pace. 🔥`,
    },
    {
      author: authorFrom(topScorer),
      meta,
      kicker: 'Scoreboard',
      headline: `${topScorer.teamName} lead the league in scoring`,
      detail: `${topScorer.fpts.toFixed(1)} total points — the most firepower in the league so far.`,
    },
  ];

  if (cellar && cellar.rosterId !== leader.rosterId) {
    items.push({
      author: authorFrom(cellar),
      meta,
      kicker: 'Basement Watch',
      headline: `${cellar.teamName} looking for a spark`,
      detail: `Sitting last at ${cellar.wins}–${cellar.losses}${cellar.ties ? `–${cellar.ties}` : ''}. Plenty of season left to climb. 👀`,
    });
  }

  return items;
}
