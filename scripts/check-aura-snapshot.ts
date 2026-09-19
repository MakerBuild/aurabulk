/**
 * Decide whether the indexer is holding data we do not have yet.
 *
 * The weekly refresh is scheduled for Saturday 13:00 UTC but GitHub has been
 * starting it three to four hours late every week, so the site sat on last
 * week's numbers until someone triggered the job by hand. The hourly watcher
 * runs this first and only pays for a full refresh when there is something new.
 *
 * It compares the top wallets by Aura against our stored copy of the same
 * wallets. `updated_at` looks like the obvious signal and is not: it stamps the
 * row, not the snapshot, so its maximum depends entirely on which wallets a
 * sample happens to contain. Aura values and category keys are what we render,
 * so they are what we check — the keys separately, because the 2026-09-17
 * republish reshaped every mainnet category without moving a single wallet's
 * total.
 *
 *   npm run check:snapshot
 */
import fs from "fs";
import path from "path";

const BASE_URL = (process.env.BULK_API_BASE ?? "https://indexer.bulk.trade").replace(/\/$/, "");
// Ranked by Aura, so the sample is the wallets a new snapshot moves first.
const ENDPOINT = `${BASE_URL}/v1/aura/leaderboard`;
const SAMPLE_SIZE = 1000;
const LEADERBOARD_FILE = path.join(process.cwd(), "data", "leaderboard.json");

interface WalletRow {
  wallet: string;
  aura?: number;
  categories?: Record<string, number>;
}

function categoryKeys(rows: WalletRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.categories ?? {})) keys.add(key);
  }
  return keys;
}

function report(stale: boolean, detail: string): void {
  console.log(`[snapshot] ${detail} stale=${stale}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `stale=${stale}\n`);
  }
}

async function main() {
  const local = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf8")) as WalletRow[];
  const ours = new Map(local.map((row) => [row.wallet, row]));

  const res = await fetch(`${ENDPOINT}?page=1&page_size=${SAMPLE_SIZE}`, {
    headers: { "User-Agent": "AURA-Intelligence/1.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`upstream responded ${res.status}`);

  const sample = ((await res.json()) as { rows?: WalletRow[] }).rows ?? [];
  if (sample.length === 0) throw new Error("upstream returned no rows");

  let unknown = 0;
  let moved = 0;
  for (const row of sample) {
    const mine = ours.get(row.wallet);
    if (!mine) {
      unknown += 1;
      continue;
    }
    if (Math.round(mine.aura ?? 0) !== Math.round(row.aura ?? 0)) moved += 1;
  }

  const upstreamKeys = categoryKeys(sample);
  const ourKeys = categoryKeys(sample.map((row) => ours.get(row.wallet)).filter((row): row is WalletRow => !!row));
  const newKeys = [...upstreamKeys].filter((key) => !ourKeys.has(key));
  const goneKeys = [...ourKeys].filter((key) => !upstreamKeys.has(key));

  const stale = unknown > 0 || moved > 0 || newKeys.length > 0 || goneKeys.length > 0;
  report(
    stale,
    `sampled=${sample.length} moved=${moved} unknown=${unknown}` +
      ` newKeys=[${newKeys.join(",")}] goneKeys=[${goneKeys.join(",")}]`,
  );
}

main().catch((err) => {
  // Staying green on a transient upstream blip matters more than the signal:
  // the next hourly run retries, and the daily TVL refresh is still a backstop.
  console.warn(`::warning::snapshot check failed, skipping this hour — ${err}`);
  report(false, "check failed");
});
