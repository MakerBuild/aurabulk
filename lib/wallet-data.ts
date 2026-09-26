import { computeHoldTimeDays, computePercentile } from "@/lib/percentiles";
import type { RankName } from "@/lib/ranks";
import { readTradingLeaguesFile } from "@/lib/trading-leagues";
import { getWalletExchangeStats } from "@/lib/volume-leaderboard";
import { computeWalletAuraBreakdown } from "@/lib/wallet-aura-breakdown";
import type { LeaderboardEntry, WalletData } from "@/types";

/** The rank recorded for this wallet on the last league sweep. */
function recordedRank(wallet: string): RankName {
  return readTradingLeaguesFile().rows.find((row) => row.wallet === wallet)?.rank ?? "Unranked";
}

export function buildWalletData(entry: LeaderboardEntry, allAura: number[]): WalletData {
  return {
    ...entry,
    percentile: computePercentile(entry.aura, allAura),
    hold_time_days: computeHoldTimeDays(entry),
    aura_breakdown: computeWalletAuraBreakdown(entry.categories, entry.aura),
    exchange: getWalletExchangeStats(entry.wallet),
    rank: recordedRank(entry.wallet),
  };
}
