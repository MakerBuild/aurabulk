/**
 * The Challenger Series, Season 1: BULK's seasonal ranked league.
 * https://docs.bulk.trade/llms.txt → "The Challenger Series"
 *
 * Weeks run Saturday to Saturday on the same 12:00 UTC snapshot as the Aura
 * campaign. Kept free of Node imports: the live prize pool reads it.
 */

const WEEK_MS = 7 * 86_400_000;

/** Week 1 opened on the Saturday snapshot of October 10, 2026. */
export const SEASON_START_MS = Date.UTC(2026, 9, 10, 12);
export const SEASON_WEEKS = 8;

/** Share of BULK's net revenue (trading fees less maker rebates) paid into
 *  each week's prize pool, in USDC. */
export const PRIZE_POOL_SHARE = 0.125;

/** How the weekly pool is split between leagues. Platinum and Gold share
 *  the last 30%; Silver and below win no cash. */
export const CHALLENGER_SHARE = 0.45;
export const DIAMOND_SHARE = 0.25;
export const PLATINUM_GOLD_SHARE = 0.3;

/**
 * Each league's cut of `poolUsd`, given how many traders each holds. Inside
 * Platinum and Gold the 30% goes so that a Platinum trader earns twice a
 * Gold one on average: Gold traders weigh 1, Platinum traders 2.
 */
export function leaguePrizesUsd(
  poolUsd: number,
  counts: { platinum: number; gold: number },
): Record<"Challenger" | "Diamond" | "Platinum" | "Gold", number> {
  const shared = poolUsd * PLATINUM_GOLD_SHARE;
  const weight = 2 * counts.platinum + counts.gold;
  return {
    Challenger: poolUsd * CHALLENGER_SHARE,
    Diamond: poolUsd * DIAMOND_SHARE,
    Platinum: weight > 0 ? (shared * 2 * counts.platinum) / weight : 0,
    Gold: weight > 0 ? (shared * counts.gold) / weight : 0,
  };
}

/** Each Gauntlet's reward, split by result among everyone taking part. */
export const GAUNTLET_AURA = 50_000;

export interface Gauntlet {
  name: string;
  /** What the Gauntlet ranks by, when the site can chart it. Taker volume
   *  is the exchange's volume: every fill has exactly one taker. */
  metric?: "takerVolume";
}

/** This season's Gauntlets by week, as BULK announces them each Saturday.
 *  A week missing here simply shows no Gauntlet. */
export const GAUNTLETS: Record<number, Gauntlet> = {
  2: { name: "Taker Volume", metric: "takerVolume" },
};

/** Season week (1 based) that the snapshot week starting at `weekStartMs`
 *  is, or null outside the regular season. */
export function seasonWeek(weekStartMs: number): number | null {
  const week = Math.round((weekStartMs - SEASON_START_MS) / WEEK_MS) + 1;
  return week >= 1 && week <= SEASON_WEEKS ? week : null;
}

/** The week's prize pool for the net revenue BULK has made in it. */
export function prizePoolUsd(netRevenueUsd: number): number {
  return netRevenueUsd * PRIZE_POOL_SHARE;
}
