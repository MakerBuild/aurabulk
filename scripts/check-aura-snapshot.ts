/**
 * Decide whether the indexer has published a newer snapshot than the one
 * already in data/leaderboard.json.
 *
 * The weekly refresh is scheduled for Saturday 13:00 UTC but GitHub has been
 * starting it three to four hours late, so the site sat on stale numbers every
 * weekend. The hourly watcher runs this first and only pays for a full refresh
 * when there is something new to fetch — which also catches the mid-week
 * republishes the weekly schedule misses entirely.
 *
 *   npm run check:snapshot
 */
import fs from "fs";
import path from "path";

const BASE_URL = (process.env.BULK_API_BASE ?? "https://indexer.bulk.trade").replace(/\/$/, "");
// Unlike the predeposit leaderboard this endpoint stamps every row with the
// snapshot it came from, which is the whole signal we need.
const ENDPOINT = `${BASE_URL}/v1/aura/leaderboard`;
const SAMPLE_SIZE = 1000;
const LEADERBOARD_FILE = path.join(process.cwd(), "data", "leaderboard.json");

interface TimestampedRow {
  updated_at?: string;
}

/** Newest ISO timestamp in the batch — they sort lexicographically. */
function newestTimestamp(rows: TimestampedRow[]): string {
  let newest = "";
  for (const row of rows) {
    const stamp = row.updated_at;
    if (stamp && stamp > newest) newest = stamp;
  }
  return newest;
}

function report(stale: boolean, detail: string): void {
  console.log(`[snapshot] ${detail} stale=${stale}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `stale=${stale}\n`);
  }
}

async function main() {
  const local = newestTimestamp(
    JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf8")) as TimestampedRow[],
  );

  const res = await fetch(`${ENDPOINT}?page=1&page_size=${SAMPLE_SIZE}`, {
    headers: { "User-Agent": "AURA-Intelligence/1.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`upstream responded ${res.status}`);

  const body = (await res.json()) as { rows?: TimestampedRow[] };
  const upstream = newestTimestamp(body.rows ?? []);

  // A snapshot lands on every wallet at once, so the first page is enough to
  // see it. If either side has no timestamp at all, refresh rather than guess:
  // a wasted three-minute run is cheaper than a week of stale numbers.
  const stale = !local || !upstream || upstream > local;
  report(stale, `local=${local || "(none)"} upstream=${upstream || "(none)"}`);
}

main().catch((err) => {
  // Staying green on a transient upstream blip matters more than the signal:
  // the next hourly run retries, and the daily TVL refresh is still a backstop.
  console.warn(`::warning::snapshot check failed, skipping this hour — ${err}`);
  report(false, "check failed");
});
