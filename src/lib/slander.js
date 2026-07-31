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
  '1132877923033391104': {
    names: ['Bubble Guts'],
    note: 'origin of "Bubble Guts": once fully pooped himself in public — diarrhea next to a trash can. The name is literal.',
  },
  // BigBoiEmos — BIBLE OR THE BELT
  '1132905719180943360': {
    names: ['The Ultimate Light Skin'],
    angle: 'lean into BIBLICAL slander — judgment, plagues, fire and brimstone',
    note: 'real name Eli. Once drafted a DEFENSIVE player first overall (an all-time draft crime). Constantly asks people whether they want "the Bible or the Belt" (his team name) — so bring the scripture-flavored roasting.',
  },
  // btkempski — The Clown Show
  '1132933728533270528': {
    names: ['Alaskan Bull Worm'],
    emoji: '🏔️🪱',
    note: 'a delusional Packers superfan who genuinely carries himself like a professional athlete he is nowhere close to being.',
  },
  // mjwithgoldhoops — Championshipsovercoochie
  '1116599370310356992': {
    names: ['The Bald Fraud', 'African Bald Fraud'],
    note: 'the "African Bald Fraud." His bald-fraud bit is UNRELATED to tristanthepiston\'s "Mexican Bald Fraud" — different origins, NOT a paired joke; do not tie the two together.',
  },
  // Alxgalvn — Sasinci's World (a ring)
  '474461892971065344': {
    names: ['Megamind', 'Big Head', 'Milk Magnus', 'Lacteus Magnus', 'Milk Man', 'Saso'],
    note: 'weak-minded despite the enormous head/mind (hence "Megamind"/"Big Head") — threatens to quit the league about once a month. As "Milk Man"/"Milk Magnus"/"Lacteus Magnus": loves himself a white woman and literally sings "milk man, milk man, yeah that\'s me" in real life.',
  },
  // parkcity0613 — BootyMunchers Inc.
  '1264710608129884160': { angle: 'a DPRK defector from South Korea' },
  // adambarner111 — Put it in Ra (most single-season wins, 11-3)
  '1134715278987943936': {
    names: ['One Nut Barner'],
    note: 'had roughly a 1.9 GPA in high school at one point — mock the academics regardless of the fact that he graduated from Cal Berkeley.',
  },
  // talentedtenthh
  '1265060864969424896': {
    names: ['Chauncey'],
    angle: 'a play on W.E.B. Du Bois\'s "Talented Tenth" — the irony being how UNtalented his roster and GM\'ing are; he is the untalented tenth',
  },
  // tristanthepiston
  '1265145602090483712': {
    names: ['The Bald Fraud', 'Mexican Bald Fraud'],
    note: 'the "Mexican Bald Fraud." UNRELATED to mjwithgoldhoops\'s "African Bald Fraud" — different origin, NOT the same bit; do not pair them.',
  },
  // Pharaoh23 — Easy way or the Hard Way
  '1265163251033849856': {
    names: ['Auntie Thomas'],
    note: 'named "Auntie Thomas" because at times he has the exact intonation of a Southern Black auntie.',
  },
  // SwooshAnoosh
  '1265186290593189888': { names: ['Prince of Persia'] },
};

// Look up the slander profile for an owner, or null if none is on file.
export function slanderFor(ownerId) {
  return SLANDER[ownerId] || null;
}
