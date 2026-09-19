import { computeHoldTimeDays, computePercentile } from "@/lib/percentiles";
import { getWalletExchangeStats } from "@/lib/volume-leaderboard";
import { computeWalletAuraBreakdown } from "@/lib/wallet-aura-breakdown";
import type { LeaderboardEntry, WalletData } from "@/types";

export function buildWalletData(entry: LeaderboardEntry, allAura: number[]): WalletData {
  return {
    ...entry,
    percentile: computePercentile(entry.aura, allAura),
    hold_time_days: computeHoldTimeDays(entry),
    aura_breakdown: computeWalletAuraBreakdown(entry.categories, entry.aura),
    exchange: getWalletExchangeStats(entry.wallet),
  };
}
