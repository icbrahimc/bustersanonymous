// Derive human-readable "storylines" from the raw standings so the Home and
// Weekly Insights pages have something to say without hand-editing copy each
// week. Once real per-week matchup data is fetched these can get richer.

export function hasPlayed(standings = []) {
  return standings.some((t) => t.wins + t.losses + t.ties > 0);
}

export function buildStorylines({ standings = [], lastChampion = null, status = '' }) {
  // Preseason / no games played yet: talk about the champion and what's next.
  if (!hasPlayed(standings)) {
    const items = [];
    if (lastChampion) {
      items.push({
        kicker: 'Title Defense',
        headline: `${lastChampion.teamName} enters as reigning champ`,
        detail: `${lastChampion.manager} took home the ring last season. Everyone else is drafting to dethrone them.`,
      });
    }
    items.push({
      kicker: 'Offseason',
      headline:
        status === 'pre_draft'
          ? 'The draft is on the clock'
          : 'Season hasn’t kicked off yet',
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
      kicker: 'Top of the Table',
      headline: `${leader.teamName} sit atop the league`,
      detail: `${leader.wins}–${leader.losses}${leader.ties ? `–${leader.ties}` : ''} with ${leader.fpts.toFixed(1)} points for. ${leader.manager} is setting the pace.`,
    },
    {
      kicker: 'Scoreboard',
      headline: `${topScorer.teamName} lead the league in scoring`,
      detail: `${topScorer.fpts.toFixed(1)} total points — the most firepower in the league so far.`,
    },
  ];

  if (cellar && cellar.rosterId !== leader.rosterId) {
    items.push({
      kicker: 'Basement Watch',
      headline: `${cellar.teamName} looking for a spark`,
      detail: `Sitting last at ${cellar.wins}–${cellar.losses}${cellar.ties ? `–${cellar.ties}` : ''}. Plenty of season left to climb.`,
    });
  }

  return items;
}
