#!/usr/bin/env bash
# The data jobs that used to be GitHub Actions. Each runs a script that writes
# into repo/data (the running app reads it from disk, no rebuild needed), then
# commits the files and pushes them, so git keeps a backup of every recording.
#
#   jobs.sh levels   hourly  open interest + active traders, OI history
#   jobs.sh volume   hourly  14d wallet trading volume
#   jobs.sh tvl      daily   leaderboard financials, TVL totals, metrics
#   jobs.sh aura     weekly  full Aura leaderboard, trading ranks, metrics
#   jobs.sh watch    check whether upstream's Aura snapshot moved; run `aura` if so
set -euo pipefail

ROOT=/opt/aurabulk
REPO=$ROOT/repo
export BULK_API_BASE=https://indexer.bulk.trade

cd "$REPO"
log() { echo "[$(date -u +%FT%TZ)] $*"; }

# Commit the given files if they changed and push. A failed push is not an
# error: the commit stays local and goes out with the next one.
commit_and_push() {
  local message=$1
  shift
  exec 9>"$ROOT/git.lock"
  flock 9
  git add -- "$@"
  if git diff --cached --quiet; then
    log "no data changes"
    flock -u 9
    return
  fi
  git commit -q -m "$message"
  local attempt
  for attempt in 1 2 3 4 5; do
    if git pull -q --rebase --autostash origin main && git push -q origin HEAD:main; then
      log "pushed: $message"
      flock -u 9
      return
    fi
    sleep $((RANDOM % 8 + 3))
  done
  log "push failed after 5 attempts; kept locally"
  flock -u 9
}

# Run the job body under its own lock so a slow run is never doubled up.
# tvl and aura share one: both rewrite leaderboard.json.
with_lock() {
  local name=$1 wait=$2 fd
  shift 2
  exec {fd}>"$ROOT/job-$name.lock"
  if ! flock -w "$wait" "$fd"; then
    log "$name is still running, skipped"
    exit 0
  fi
  "$@"
}

# Shared hold on node_modules for the whole job; update.sh takes it exclusively
# before `npm ci` so a reinstall never pulls tsx out from under a running job.
exec 6>"$ROOT/deps.lock"
flock -s 6

levels() {
  npm run -s record:levels
  commit_and_push "chore: record hourly open interest and active traders" \
    data/exchange-levels.json data/oi-history.json
}

volume() {
  npm run -s record:volume
  commit_and_push "chore: record wallet trading volume" data/volume-leaderboard.json
}

tvl() {
  npm run -s fetch -- --no-snapshot
  npm run -s fetch:totals
  npm run -s build:metrics
  commit_and_push "chore: refresh TVL totals and wallet financials" \
    data/totals.json data/snapshots.json data/leaderboard.json data/dashboard-metrics.json
}

aura() {
  npm run -s fetch -- --enrich --no-snapshot
  # Trading ranks move when the snapshot does; record them before the metrics
  # that group by them.
  npm run -s record:leagues
  npm run -s build:metrics
  commit_and_push "chore: refresh weekly aura leaderboard" \
    data/leaderboard.json data/dashboard-metrics.json data/trading-leagues.json
}

watch() {
  local out
  out=$(mktemp)
  GITHUB_OUTPUT=$out npm run -s check:snapshot
  if grep -q '^stale=true' "$out"; then
    rm -f "$out"
    log "upstream snapshot moved, refreshing"
    with_lock leaderboard 0 aura
  else
    rm -f "$out"
  fi
}

case "${1:-}" in
  levels) with_lock levels 0 levels ;;
  volume) with_lock volume 0 volume ;;
  tvl) with_lock leaderboard 3600 tvl ;;
  aura) with_lock leaderboard 3600 aura ;;
  watch) with_lock watch 0 watch ;;
  *)
    echo "usage: jobs.sh levels|volume|tvl|aura|watch" >&2
    exit 2
    ;;
esac
