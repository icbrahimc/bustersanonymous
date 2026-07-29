# Busters Anonymous — League Site

A small, fast, static site for the **Busters Anonymous** fantasy football league.
Built with [Astro](https://astro.build), hosted free on **GitHub Pages**, and
refreshed **once a day** from the public [Sleeper](https://sleeper.com) API by a
scheduled GitHub Action.

Four pages: **Home**, **Rules**, **Weekly Insights**, **History**.

---

## How it works

```
                 ┌─────────────────────────── GitHub Actions (daily cron) ──────────────┐
 Sleeper API  ─▶ │  heartbeat + fetch → src/data/*.json                                  │
 Claude API   ─▶ │  generate hot takes → src/data/feed.json   (server-side, key in secret)│
                 │  git commit  →  npm run build → static HTML → deploy to GitHub Pages   │
                 └──────────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
                              https://<user>.github.io/busters-league/
```

- **No server, no database.** Everything is pre-rendered to static HTML.
- **The browser never calls an API.** Sleeper data and the AI feed are both
  generated server-side in the Action and baked into the committed JSON.
- The **daily feed** is written by Claude (`claude-sonnet-5`) in a brash
  hot-take-debate persona ("THE UNDISPUTED BUSTERS TAKE"), grounded in the real
  league data. The `ANTHROPIC_API_KEY` lives only in a GitHub Actions secret.
  If it's missing or the call fails, the build falls back to deterministic
  storylines so the site never breaks.
- The daily job also writes a `data/heartbeat.log` line ("hello world" +
  timestamp) so you can confirm the schedule fired.

## Project layout

```
scripts/
  cron.mjs            # daily entry point: heartbeat + fetch + generate feed
  fetch-sleeper.mjs   # pulls league/rosters/users, walks past seasons → src/data/*.json
  generate-feed.mjs   # Claude writes Skip-style hot takes → src/data/feed.json
src/
  data/*.json         # generated league data (committed, read at build time)
  data/feed.json      # latest daily hot-take edition
  data/feeds/         # dated archive: <YYYY-MM-DD>.json per day + index.json
  pages/feed/[date].astro  # one retrievable page per archived edition
  content/rules.md    # the rulebook — edit this to change the Rules page
  layouts/Base.astro  # shared shell (nav + footer)
  components/         # Nav, StandingsTable
  lib/               # url + storyline helpers
  pages/             # index (Home), rules, insights, history
.github/workflows/deploy.yml   # cron + build + deploy
```

## Local development

```bash
npm install
npm run fetch-data   # refresh src/data/*.json from Sleeper (optional)
npm run dev          # http://localhost:4321/busters-league/
```

Build a production copy locally:

```bash
npm run build && npm run preview
```

## One-time GitHub Pages setup

1. Push this repo to GitHub (default branch **main**).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → New repository secret:**
   add `ANTHROPIC_API_KEY` (from console.anthropic.com). Without it, the feed
   falls back to plain deterministic storylines — the site still works.
4. That's it. The workflow runs on every push to `main`, every day at
   **07:15 UTC**, and on demand from the **Actions** tab (“Run workflow”).

The site publishes to `https://<your-user>.github.io/<repo>/`. The workflow
figures out the correct base path automatically — including the root path if you
name the repo `<your-user>.github.io` or attach a custom domain.

## Common edits

| Task | Where |
|------|-------|
| Change the rulebook | `src/content/rules.md` |
| Tune the hot-take voice / persona | `SYSTEM` prompt in `scripts/generate-feed.mjs` |
| Change how many takes per day | `TAKE_COUNT` in `scripts/generate-feed.mjs` |
| Point at a different league | `LEAGUE_ID` env var, or the default in `scripts/fetch-sleeper.mjs` |
| Change what the daily heartbeat writes | `heartbeat()` in `scripts/cron.mjs` |
| Adjust colors / styling | `src/styles/global.css` |
| Change the cron time | the `schedule:` line in `.github/workflows/deploy.yml` |

## Roadmap

- Per-week matchup data → real week-by-week Weekly Insights (currently
  season-to-date; the page structure is already in place).
- Interactive **voting** (e.g. play of the week). GitHub Pages can’t store votes,
  so this will add a small backend (serverless function or hosted service) and an
  Astro island — everything else stays static.
