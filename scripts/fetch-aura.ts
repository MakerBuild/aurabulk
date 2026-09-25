/**
 * Offline fetch — pulls the full Aura leaderboard from the official BULK
 * indexer API and writes it to local snapshot files.
 *
 * Fast path (default): parallel pages, no per-wallet referral enrichment (~1–2 min).
 * Full referral enrichment: npm run fetch -- --enrich (~15 min).
 *
 *   npm run fetch
 *   npm run fetch -- --enrich --page-size=2000
 *
 * Source: https://indexer.bulk.trade/v1/aura/predeposit/leaderboard
 */
import fs from "fs";
import path from "path";
import { writeFileAtomic } from "../lib/atomic-write";
import { readLeaderboardFromDisk } from "../lib/fetcher";
import {
  fetchAllLeaderboardPages,
  finalizeLeaderboardEntries,
  mergeReferralFieldsFromDisk,
  normalizeUpstreamRow,
  type LeaderboardUpstreamPage,
} from "../lib/leaderboard-upstream";
import { appendSnapshot } from "../lib/snapshots";
import { getUpstreamBase, upstreamFetch, upstreamJson } from "../lib/upstream";
import type { LeaderboardEntry } from "../types/index";

const BASE_URL = getUpstreamBase();

const DATA_DIR = path.join(process.cwd(), "data");
const LEADERBOARD_FILE = path.join(DATA_DIR, "leaderboard.json");

const MAX_RETRIES = 6;
const MAX_BACKOFF_MS = 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const ENRICH_CONCURRENCY = 12;

interface WalletProfile {
  referrals_sent?: number;
  referrals_qualified?: number;
  referrals_rewarded?: number;
  referees_total_deposited?: number;
}

interface Options {
  pageSize: number;
  maxPages: number;
  enrichReferrals: boolean;
  writeSnapshot: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let pageSize = 2000;
  let maxPages = Infinity;
  let enrichReferrals = false;
  let writeSnapshot = true;

  for (const arg of args) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "page-size") pageSize = Math.min(2000, Math.max(1, Number(value) || 2000));
    if (key === "max-pages") maxPages = Math.max(1, Number(value) || Infinity);
    if (key === "enrich") enrichReferrals = true;
    if (key === "no-snapshot") writeSnapshot = false;
  }

  return { pageSize, maxPages, enrichReferrals, writeSnapshot };
}

async function fetchPage(page: number, pageSize: number, noTotal: boolean): Promise<LeaderboardUpstreamPage> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (noTotal) params.set("no_total", "true");

  const res = await upstreamFetch(`/v1/aura/predeposit/leaderboard?${params.toString()}`, {
    noStore: true,
    maxRetries: MAX_RETRIES,
    maxBackoffMs: MAX_BACKOFF_MS,
    timeoutMs: FETCH_TIMEOUT_MS,
    onRetry: (attempt, wait, reason) =>
      console.warn(`[fetch] ${reason} on page ${page} — retry ${attempt}/${MAX_RETRIES} in ${wait}ms`),
  });
  if (!res.ok) {
    throw new Error(`Leaderboard fetch failed on page ${page}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as LeaderboardUpstreamPage;
}

async function fetchWalletProfile(wallet: string): Promise<WalletProfile | null> {
  try {
    return await upstreamJson<WalletProfile>(`/v1/aura/wallet/${wallet}`, {
      noStore: true,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
    });
  } catch {
    return null;
  }
}

async function enrichReferrerProfiles(entries: LeaderboardEntry[]): Promise<void> {
  const targets = entries.filter((entry) => (entry.referral_number ?? 0) > 0);

  if (targets.length === 0) return;

  console.log(`Enriching referral profiles for ${targets.length} wallets (parallel)...`);

  let done = 0;
  for (let offset = 0; offset < targets.length; offset += ENRICH_CONCURRENCY) {
    const batch = targets.slice(offset, offset + ENRICH_CONCURRENCY);
    await Promise.all(
      batch.map(async (entry) => {
        const profile = await fetchWalletProfile(entry.wallet);
        if (profile) {
          entry.referrals_sent = Number(profile.referrals_sent) || 0;
          entry.referrals_qualified = Number(profile.referrals_qualified) || 0;
          entry.referrals_rewarded = Number(profile.referrals_rewarded) || 0;
          entry.referees_total_deposited = Number(profile.referees_total_deposited) || 0;
        }
        done += 1;
      }),
    );
    if (done % 100 === 0 || done === targets.length) {
      console.log(`  enriched ${done}/${targets.length} referrers`);
    }
  }
}

async function main() {
  const { pageSize, maxPages, enrichReferrals, writeSnapshot } = parseArgs();
  console.log(
    `Fetching Aura leaderboard from ${BASE_URL} (page_size=${pageSize}, parallel=6` +
      `${enrichReferrals ? ", enrich=on" : ""})...`,
  );

  const rows = await fetchAllLeaderboardPages(fetchPage, {
    pageSize,
    maxPages,
    concurrency: 6,
    onProgress: (page, totalPages, rowCount) => {
      if (page % 5 === 0 || page === totalPages) {
        console.log(`  fetched page ${page}/${totalPages} (${rowCount.toLocaleString()} rows)`);
      }
    },
  });

  const entries = rows
    .map(normalizeUpstreamRow)
    .filter((entry): entry is LeaderboardEntry => entry !== null);

  finalizeLeaderboardEntries(entries);

  // Throws on a malformed file rather than silently dropping every wallet's
  // referral fields.
  const merged = mergeReferralFieldsFromDisk(entries, readLeaderboardFromDisk());

  if (enrichReferrals) {
    await enrichReferrerProfiles(merged);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(LEADERBOARD_FILE)) {
    fs.copyFileSync(LEADERBOARD_FILE, path.join(DATA_DIR, "leaderboard.backup.json"));
    console.log("Backed up previous leaderboard → leaderboard.backup.json");
  }

  writeFileAtomic(LEADERBOARD_FILE, JSON.stringify(merged, null, 2));
  if (writeSnapshot) {
    appendSnapshot({
      tvl: merged.reduce((sum, entry) => sum + entry.current_amount, 0),
      totalAura: merged.reduce((sum, entry) => sum + entry.aura, 0),
      wallets: merged.length,
    });
  } else {
    console.log("Skipping snapshot append (--no-snapshot).");
  }

  const tvl = merged.reduce((sum, entry) => sum + entry.current_amount, 0);
  const totalAura = merged.reduce((sum, entry) => sum + entry.aura, 0);
  console.log(`Saved ${merged.length.toLocaleString()} wallets to leaderboard.json`);
  console.log(`   TVL:        $${tvl.toLocaleString()}`);
  console.log(`   Total Aura: ${totalAura.toLocaleString()}`);
  if (writeSnapshot) console.log("Appended snapshot.");
}

main().catch((err) => {
  console.error("Fetch failed:", err);
  process.exit(1);
});
