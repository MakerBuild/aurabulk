import { unstable_cache } from "next/cache";
import { getLeaderboard } from "@/lib/fetcher";
import { readDashboardMetricsFile } from "@/lib/dashboard-metrics-store";
import { getLeaderboardForApp } from "@/lib/live-leaderboard";
import { percentileValue } from "@/lib/percentiles";
import {
  getLeaderboardTop,
  type LeaderboardSortDir,
  type LeaderboardTab,
} from "@/lib/leaderboard-table";
import { DEPOSITOR_AURA_RANGES, categoryLabel } from "@/lib/utils";
import { buildWalletData } from "@/lib/wallet-data";
import type { DashboardMetrics, LeaderboardEntry, WalletData } from "@/types";

const DEPOSIT_SIZE_BUCKETS = [
  { label: "<$100", min: 0, max: 100 },
  { label: "$100-1K", min: 100, max: 1_000 },
  { label: "$1K-10K", min: 1_000, max: 10_000 },
  { label: "$10K-100K", min: 10_000, max: 100_000 },
  { label: "$100K-500K", min: 100_000, max: 500_000 },
  { label: "$500K-1M", min: 500_000, max: 1_000_000 },
  { label: "$1M+", min: 1_000_000, max: Infinity },
];

export async function computeDashboardMetricsUncached(): Promise<DashboardMetrics> {
  const entries = await getLeaderboardForApp({ waitMs: 0 });
  const totalAura = entries.reduce((sum, e) => sum + e.aura, 0);

  const depositSizeDistribution = DEPOSIT_SIZE_BUCKETS.map((bucket) => {
    // Filtered once and then counted and summed, rather than filtered twice:
    // this runs over every leaderboard entry for each of seven buckets.
    const inBucket = entries.filter(
      (e) =>
        e.deposited_amount > 0 &&
        e.deposited_amount >= bucket.min &&
        e.deposited_amount < bucket.max
    );
    // Sorted once and reused for both ends, rather than sorted per percentile.
    const bucketAuraAsc = inBucket.map((e) => e.aura).sort((a, b) => a - b);
    return {
      bucket: bucket.label,
      count: inBucket.length,
      // Net of withdrawals, and floored per wallet: a wallet that took out
      // more than it put in still holds nothing, not a negative balance that
      // would quietly cancel out someone else's deposit.
      held: inBucket.reduce(
        (sum, e) => sum + Math.max(0, e.deposited_amount - e.withdrawn_amount),
        0
      ),
      aura: inBucket.reduce((sum, e) => sum + (Number(e.aura) || 0), 0),
      // Typical Aura in the cohort, not raw min/max — a few empty or
      // outlier wallets otherwise pin every band to "0–…".
      auraMin: percentileValue(bucketAuraAsc, 10),
      auraMax: percentileValue(bucketAuraAsc, 90),
    };
  });

  // Cut by the Aura a wallet holds, across every wallet that holds any — the
  // tiers on the Overview are an Aura distribution and say so, so they have to
  // be counted that way rather than by deposit size.
  const auraDistribution = DEPOSITOR_AURA_RANGES.map((range) => {
    const inBand = entries.filter((e) => {
      const aura = Number(e.aura) || 0;
      return aura > 0 && aura >= range.min && aura < range.max;
    });
    return {
      bucket: range.label,
      count: inBand.length,
      // Same netting as the deposit buckets: a trader who never deposited
      // holds nothing, and contributes only to count and Aura.
      held: inBand.reduce(
        (sum, e) => sum + Math.max(0, e.deposited_amount - e.withdrawn_amount),
        0
      ),
      aura: inBand.reduce((sum, e) => sum + (Number(e.aura) || 0), 0),
      // The band's own edges — exact by construction now, not a percentile
      // estimate of where the cohort happens to sit.
      auraMin: range.min,
      auraMax: Number.isFinite(range.max) ? range.max : 0,
    };
  });

  const categoryTotals: Record<string, number> = {};
  for (const entry of entries) {
    for (const [key, val] of Object.entries(entry.categories ?? {})) {
      categoryTotals[key] = (categoryTotals[key] ?? 0) + val;
    }
  }

  const categoryBreakdown = Object.entries(categoryTotals)
    .map(([key, points]) => ({
      key,
      category: categoryLabel(key),
      points,
      share: totalAura > 0 ? (points / totalAura) * 100 : 0,
    }))
    .sort((a, b) => b.points - a.points);

  return { depositSizeDistribution, auraDistribution, categoryBreakdown };
}

/**
 * Serves the figures the cron precomputed. Falls back to computing them in
 * process only when the file is missing or unreadable — a fresh clone before
 * the first cron run, say — so a missing artefact degrades to the old
 * behaviour rather than to a blank dashboard.
 */
async function loadDashboardMetrics(): Promise<DashboardMetrics> {
  const precomputed = readDashboardMetricsFile();
  if (precomputed) return precomputed.metrics;
  console.warn("[metrics] no precomputed file; computing in process");
  return computeDashboardMetricsUncached();
}

export const computeDashboardMetrics = unstable_cache(
  loadDashboardMetrics,
  ["dashboard-metrics-v5"],
  // Hourly. This is the expensive one — ~450ms of CPU to parse the 34MB
  // leaderboard and run twenty passes plus eight sorts over 56k entries.
  // Its inputs are a weekly aura refresh and a daily totals refresh, so a
  // 60s window rebuilt it thousands of times per change. It also floors the
  // revalidate of every page that calls it, since a route's window is the
  // minimum of every cache used while rendering it.
  { revalidate: 3600 },
);

export function getWalletData(address: string): WalletData | null {
  const entries = getLeaderboard();
  // Exact match: base58 addresses are case-sensitive.
  const entry = entries.find((e) => e.wallet === address);
  if (!entry) return null;

  const allAura = entries.map((e) => e.aura);
  return buildWalletData(entry, allAura);
}

export function getSortedLeaderboard(
  tab: LeaderboardTab,
  sortKey?: string,
  sortDir?: LeaderboardSortDir,
  limit?: number
): LeaderboardEntry[] {
  return getLeaderboardTop(getLeaderboard(), tab, sortKey, sortDir, limit);
}
