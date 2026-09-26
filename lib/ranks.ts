/**
 * BULK's official trading ranks (the "Challenger Series"), lowest first.
 *
 * The indexer ranks wallets by the Aura they earned from mainnet trading —
 * the `mainnet_weekN_trading` and `mainnet_weekN_maker` categories — among
 * wallets whose lifetime volume clears a qualification threshold, and places
 * each in a rank by percentile. Everyone else is Unranked.
 *
 * Kept free of Node imports: client components read the names too.
 */
export const RANK_NAMES = [
  "Unranked",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Challenger",
] as const;

export type RankName = (typeof RANK_NAMES)[number];

/** Upstream's league name as one of ours, or Unranked for anything else. */
export function toRankName(name: string | null | undefined): RankName {
  return RANK_NAMES.find((rank) => rank === name) ?? "Unranked";
}

const TRADING_AURA_RE = /^mainnet_week\d+_(?:trading|maker)$/;

/** Aura from mainnet trading — what the trading ranks are ordered by. */
export function tradingAuraOf(categories: Record<string, number> | undefined): number {
  let sum = 0;
  for (const [key, value] of Object.entries(categories ?? {})) {
    if (TRADING_AURA_RE.test(key)) sum += Number(value) || 0;
  }
  return sum;
}
