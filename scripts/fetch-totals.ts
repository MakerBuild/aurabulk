/**
 * Lightweight refresh — pulls aggregate financials (TVL, deposited, withdrawn)
 * from the upstream leaderboard `totals` block, patches per-wallet deposit /
 * withdraw / current amounts in data/leaderboard.json, and appends a TVL snapshot.
 *
 * Aura, categories, and referrals come from `npm run fetch`.
 *
 *   npm run fetch:totals
 */
import path from "path";
import { writeFileAtomic } from "../lib/atomic-write";
import { readLeaderboardFromDisk } from "../lib/fetcher";
import {
  fetchAllLeaderboardFinancialRows,
  mergeFinancialRowsIntoEntries,
  recomputeDepositRanks,
  type LeaderboardFinancialPage,
} from "../lib/leaderboard-financial-sync";
import type { LiveTotalsResponse } from "../lib/live-totals";
import { appendSnapshot } from "../lib/snapshots";
import { getUpstreamBase, upstreamFetch } from "../lib/upstream";
import type { Totals } from "../types/index";

const DATA_DIR = path.join(process.cwd(), "data");
const TOTALS_FILE = path.join(DATA_DIR, "totals.json");
const LEADERBOARD_FILE = path.join(DATA_DIR, "leaderboard.json");

const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30_000;
const FETCH_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 2000;
const PAGE_DELAY_MS = 300;

async function fetchJson<T>(query: string, label: string): Promise<T> {
  const res = await upstreamFetch(`/v1/aura/predeposit/leaderboard?${query}`, {
    noStore: true,
    maxRetries: MAX_RETRIES,
    maxBackoffMs: MAX_BACKOFF_MS,
    timeoutMs: FETCH_TIMEOUT_MS,
    onRetry: (attempt, wait, reason) =>
      console.warn(`[totals] ${label} ${reason} — retry ${attempt}/${MAX_RETRIES} in ${wait}ms`),
  });
  if (!res.ok) throw new Error(`${label} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

function fetchLeaderboardPage(
  page: number,
  pageSize: number,
  noTotal: boolean
): Promise<LeaderboardFinancialPage> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (noTotal) params.set("no_total", "true");
  return fetchJson<LeaderboardFinancialPage>(params.toString(), `page ${page}`);
}

async function patchLeaderboardFinancials(): Promise<number> {
  const entries = readLeaderboardFromDisk();
  if (!entries.length) {
    console.log("No local leaderboard to patch — skipping per-wallet financial sync.");
    return 0;
  }

  console.log(`Syncing deposit/withdraw data for ${entries.length.toLocaleString()} wallets...`);
  const rows = await fetchAllLeaderboardFinancialRows(fetchLeaderboardPage, {
    pageSize: PAGE_SIZE,
    pageDelayMs: PAGE_DELAY_MS,
  });

  const merged = mergeFinancialRowsIntoEntries(entries, rows);
  recomputeDepositRanks(merged);
  writeFileAtomic(LEADERBOARD_FILE, JSON.stringify(merged, null, 2));
  console.log(`Patched leaderboard.json (${rows.length.toLocaleString()} upstream rows).`);
  return merged.length;
}

async function main() {
  console.log(`Fetching aggregate totals from ${getUpstreamBase()}...`);
  const res = await fetchJson<LiveTotalsResponse>("page=1&page_size=1", "totals");
  const t = res.totals ?? {};

  const tvl = Number(t.total_current_amount) || 0;
  const totalDeposited = Number(t.total_deposited_amount) || 0;
  const totalWithdrawn = Number(t.total_withdrawn_amount) || 0;
  const totalWallets = Number(t.total_wallets) || 0;

  if (tvl <= 0 && totalDeposited <= 0) {
    throw new Error("Upstream returned empty totals — refusing to overwrite.");
  }

  const totals: Totals = {
    tvl,
    totalDeposited,
    totalWithdrawn,
    totalWallets,
    updatedAt: new Date().toISOString(),
  };

  writeFileAtomic(TOTALS_FILE, JSON.stringify(totals, null, 2));

  // Append a TVL snapshot. Aura/wallet count come from the stored leaderboard
  // so the chart's secondary series stay consistent between Aura refreshes.
  const leaderboard = readLeaderboardFromDisk();
  const snapshots = appendSnapshot({
    tvl,
    totalAura: leaderboard.reduce((sum, entry) => sum + (Number(entry.aura) || 0), 0),
    wallets: leaderboard.length || res.total || totalWallets,
    totalDeposited,
    totalWithdrawn,
  });

  await patchLeaderboardFinancials();

  console.log(`Saved totals → totals.json`);
  console.log(`   TVL:             $${tvl.toLocaleString()}`);
  console.log(`   Total Deposited: $${totalDeposited.toLocaleString()}`);
  console.log(`   Total Withdrawn: $${totalWithdrawn.toLocaleString()}`);
  console.log(`Appended snapshot (${snapshots.length} kept).`);
}

main().catch((err) => {
  console.error("Totals fetch failed:", err);
  process.exit(1);
});
