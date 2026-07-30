// Inside-joke "slander" nicknames for each manager, keyed by the STABLE Sleeper
// ownerId (roster ids can shuffle season to season; owner ids don't).
//
// Hand-authored, not fetched — these are league in-jokes the AI could never
// derive from stats, which is exactly why they make the hot takes land.
//
// IMPORTANT — slander is EARNED, not spammed. The feed persona deploys these
// WEIGHTED BY PERFORMANCE (past + present, via the `pedigree` object):
//   - bottom-feeder / playing badly  -> full slander, bury them
//   - contender falling short of hype -> slander as pressure ("all that, still just <name>")
//   - actually balling right now      -> dial it back or flip to grudging respect / irony
// A manager who is genuinely winning should not get roasted with their nickname
// as if they were losing.
//
// Shape per owner:
//   names  - one or more nicknames the persona may use
//   angle  - optional running bit/theme (not a fixed name)
//   emoji  - optional emoji to attach when the slander is used
//   note   - optional extra context for the persona

export const SLANDER = {
  // Tyrique14 — #FreeMaxx Champions (a ring)
  '784624291579854848': { names: ['Thicks'], note: 'formerly known as "Sticks"' },
  // briangalvan1 — Peacemakers (all-time single-season points record)
  '1132877923033391104': { names: ['Bubble Guts'] },
  // BigBoiEmos — BIBLE OR THE BELT
  '1132905719180943360': { names: ['The Ultimate Light Skin'] },
  // btkempski — The Clown Show
  '1132933728533270528': { names: ['Alaskan Bull Worm'], emoji: '🏔️🪱' },
  // mjwithgoldhoops — Championshipsovercoochie
  '1116599370310356992': {
    names: ['The Bald Fraud', 'African Bald Fraud'],
    note: 'the "African Bald Fraud" — counterpart to tristanthepiston, the "Mexican Bald Fraud"',
  },
  // Alxgalvn — Sasinci's World (a ring)
  '474461892971065344': { names: ['Megamind', 'Big Head', 'Milk Magnus', 'Milk Man'] },
  // parkcity0613 — BootyMunchers Inc.
  '1264710608129884160': { angle: 'a DPRK defector from South Korea' },
  // adambarner111 — Put it in Ra (most single-season wins, 11-3)
  '1134715278987943936': { names: ['One Nut Barner'] },
  // talentedtenthh
  '1265060864969424896': { names: ['Chauncey'] },
  // tristanthepiston
  '1265145602090483712': {
    names: ['The Bald Fraud', 'Mexican Bald Fraud'],
    note: 'the "Mexican Bald Fraud" — counterpart to mjwithgoldhoops, the "African Bald Fraud"',
  },
  // Pharaoh23 — Easy way or the Hard Way
  '1265163251033849856': { names: ['Auntie Thomas'] },
  // SwooshAnoosh
  '1265186290593189888': { names: ['Prince of Persia'] },
};

// Look up the slander profile for an owner, or null if none is on file.
export function slanderFor(ownerId) {
  return SLANDER[ownerId] || null;
}
