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
 Sleeper API  ─▶ │  npm run cron  →  heartbeat + write src/data/*.json  →  commit        │
                 │  npm run build →  static HTML in dist/  →  deploy to GitHub Pages      │
                 └──────────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
                              https://<user>.github.io/busters-league/
```

- **No server, no database.** Everything is pre-rendered to static HTML.
- **No API key** — Sleeper's read API is public.
- The daily job writes a `data/heartbeat.log` line ("hello world" + timestamp)
  so you can confirm the schedule fired, then pulls fresh league data and
  rebuilds the site.

## Project layout

```
scripts/
  cron.mjs            # daily entry point: heartbeat + fetch
  fetch-sleeper.mjs   # pulls league/rosters/users, walks past seasons → src/data/*.json
src/
  data/*.json         # generated league data (committed, read at build time)
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
3. That's it. The workflow runs on every push to `main`, every day at
   **07:15 UTC**, and on demand from the **Actions** tab (“Run workflow”).

The site publishes to `https://<your-user>.github.io/<repo>/`. The workflow
figures out the correct base path automatically — including the root path if you
name the repo `<your-user>.github.io` or attach a custom domain.

## Common edits

| Task | Where |
|------|-------|
| Change the rulebook | `src/content/rules.md` |
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
