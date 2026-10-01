#!/usr/bin/env bash
# Pull main and, when anything outside data/ changed, build a new release and
# switch to it. Cron runs this every two minutes; `update.sh --force` rebuilds
# even when nothing changed.
#
# Layout under /opt/aurabulk:
#   repo/              git checkout: builds run here, data jobs write data/ here
#   releases/<sha>/    standalone builds; data/ in each is a link to repo/data
#   current            link to the release the service runs
set -euo pipefail

ROOT=/opt/aurabulk
REPO=$ROOT/repo
RELEASES=$ROOT/releases
FORCE=${1:-}

cd "$REPO"

# Jobs commit data here too; never let a pull and a commit race.
exec 9>"$ROOT/git.lock"
flock 9
git fetch -q origin main
git pull -q --rebase --autostash origin main
flock -u 9

HEAD_SHA=$(git rev-parse --short=12 HEAD)
DEPLOYED_SHA=$(basename "$(readlink -f "$ROOT/current" 2>/dev/null || echo none)")

if [[ "$FORCE" != "--force" && -d "$RELEASES/$DEPLOYED_SHA" ]]; then
  # Data-only commits need no build: the app reads data/ from disk.
  if git diff --quiet "$DEPLOYED_SHA" HEAD -- . ':(exclude)data'; then
    exit 0
  fi
fi

# A commit that failed to build is not retried every tick; the next push or
# `--force` tries again.
if [[ "$FORCE" != "--force" && "$(cat "$ROOT/failed-build" 2>/dev/null)" == "$HEAD_SHA" ]]; then
  exit 0
fi

# One build at a time, and skip rather than queue: the next tick catches up.
exec 8>"$ROOT/build.lock"
flock -n 8 || exit 0

echo "[$(date -u +%FT%TZ)] building $HEAD_SHA (was $DEPLOYED_SHA)"
echo "$HEAD_SHA" > "$ROOT/failed-build"
if [[ ! -d node_modules ]] || ! git diff --quiet "$DEPLOYED_SHA" HEAD -- package-lock.json 2>/dev/null; then
  # Wait for running data jobs (they hold this shared) before reinstalling.
  exec 7>"$ROOT/deps.lock"
  flock 7
  npm ci --no-audit --no-fund
  flock -u 7
fi
NEXT_OUTPUT=standalone npm run build
rm -f "$ROOT/failed-build"

RELEASE=$RELEASES/$HEAD_SHA
rm -rf "$RELEASE"
mkdir -p "$RELEASES"
cp -a .next/standalone "$RELEASE"
cp -a .next/static "$RELEASE/.next/static"
cp -a public "$RELEASE/public"
# The build may trace a copy of data/ into the release; the live one wins.
rm -rf "$RELEASE/data"
ln -s "$REPO/data" "$RELEASE/data"

ln -sfn "$RELEASE" "$ROOT/current.new"
mv -T "$ROOT/current.new" "$ROOT/current"
sudo systemctl restart aurabulk

# Keep the three newest releases for a quick manual rollback.
ls -1dt "$RELEASES"/*/ | tail -n +4 | xargs -r rm -rf
echo "[$(date -u +%FT%TZ)] live on $HEAD_SHA"
