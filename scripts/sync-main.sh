#!/usr/bin/env bash
# Pull the latest main from origin so the daily cron's committed data/feed
# don't leave your local branch behind. Safe + quiet: only runs on the main
# branch, auto-stashes local edits, and never fails the caller.
#
# Wired to run automatically on project open via:
#   - Claude Code:  SessionStart hook in .claude/settings.json
#   - VS Code:      folderOpen task in .vscode/tasks.json
# Run it by hand any time with: npm run sync
set -uo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "sync: not a git repo; skipping"; exit 0; }
cd "$root" || exit 0

branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
if [ "$branch" != "main" ]; then
  echo "sync: on branch '${branch:-detached}', not main — skipping auto-pull"
  exit 0
fi

git remote get-url origin >/dev/null 2>&1 || { echo "sync: no 'origin' remote; skipping"; exit 0; }

before=$(git rev-parse HEAD 2>/dev/null)
if git pull --rebase --autostash origin main >/tmp/busters-sync.log 2>&1; then
  after=$(git rev-parse HEAD 2>/dev/null)
  if [ "$before" = "$after" ]; then
    echo "sync: already up to date with origin/main"
  else
    echo "sync: fast-forwarded main $(git rev-parse --short "$before")..$(git rev-parse --short "$after")"
  fi
else
  echo "sync: could not rebase onto origin/main automatically — resolve by hand (see /tmp/busters-sync.log)"
fi
exit 0
