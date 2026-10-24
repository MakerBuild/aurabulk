/**
 * The Challenger Series, Season 1: BULK's seasonal ranked league.
 * https://docs.bulk.trade/llms.txt → "The Challenger Series"
 *
 * Weeks run Saturday 13:00 to Saturday 13:00 UTC: an hour after the Aura
 * campaign's 12:00 snapshot, when BULK reveals the leagues and the pool and
 * the next week opens. Kept free of Node imports: the live prize pool reads it.
 */

const WEEK_MS = 7 * 86_400_000;

/** The hour (UTC) on Saturday a Challenger Series week opens and closes. */
export const WEEK_START_HOUR_UTC = 13;

/** Week 1 opened on Saturday, October 10, 2026. */
export const SEASON_START_MS = Date.UTC(2026, 9, 10, WEEK_START_HOUR_UTC);

/** The Saturday 13:00 UTC the week holding `nowMs` opened at. Not the Aura
 *  campaign's snapshot week: between 12:00 and 13:00 the closing week is
 *  still this one. */
export function challengerWeekStart(nowMs: number): number {
  const day = new Date(nowMs);
  const sinceSaturday = (day.getUTCDay() + 1) % 7;
  const start =
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - sinceSaturday, WEEK_START_HOUR_UTC);
  return start > nowMs ? start - WEEK_MS : start;
}
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

/** A league's lowest payout sits at least this far above the top payout of
 *  the league below: 1.2 is 20% more. */
export const LEAGUE_GAP = 1.2;
/** The most of a league's pool its floor may take, so some of it always
 *  goes by Trading AURA. */
export const MAX_FLOOR_SHARE = 0.8;

type PaidLeague = keyof ReturnType<typeof leaguePrizesUsd>;
const PAID_BOTTOM_UP: PaidLeague[] = ["Gold", "Platinum", "Diamond", "Challenger"];

/**
 * Each trader's `clamp(c × aura, floor, ceiling)`, with `c` the one rate
 * that makes them add up to the pool. Null when no rate can: the floor costs
 * more than the pool, or the ceiling leaves part of it unpaid.
 */
function fitPayouts(pool: number, auras: number[], floor: number, ceiling: number): number[] | null {
  const n = auras.length;
  if (n === 0) return [];
  const tolerance = pool * 1e-9;
  if (floor * n > pool + tolerance || ceiling * n < pool - tolerance) return null;
  if (!auras.some((a) => a > 0)) return auras.map(() => pool / n);
  const paid = (c: number) => auras.reduce((sum, a) => sum + Math.min(ceiling, Math.max(floor, c * a)), 0);
  let lo = 0;
  let hi = 1;
  while (paid(hi) < pool) hi *= 2;
  for (let i = 0; i < 100; i += 1) {
    const c = (lo + hi) / 2;
    if (paid(c) < pool) lo = c;
    else hi = c;
  }
  return auras.map((a) => Math.min(ceiling, Math.max(floor, hi * a)));
}

/**
 * What each paid trader takes of the week's prize pool, as a share of it:
 * their payout for a $1 pool. Every step below scales with the pool, so the
 * live figure is just this times the pool.
 *
 * Each league keeps its fixed cut (leaguePrizesUsd) and splits it by Trading
 * AURA, going up from Gold. Every trader in a league gets at least a floor,
 * LEAGUE_GAP above the top payout of the league below; only those whose
 * share falls under it are lifted, and the rest pay for it at one rate. Where
 * the floor would take more than MAX_FLOOR_SHARE of the pool, the league
 * below is capped instead so it fits. The method BULK approved in Oct 2026.
 *
 * Should a floor not fit even so, the week falls back to plain pro rata
 * inside each league: BULK flags that case rather than paying it.
 */
export function payoutShares(rows: { wallet: string; rank: string; tradingAura: number }[]): Map<string, number> {
  const leagues = PAID_BOTTOM_UP.map((rank) => {
    const members = rows.filter((row) => row.rank === rank);
    return { rank, wallets: members.map((row) => row.wallet), auras: members.map((row) => row.tradingAura) };
  });
  const count = (rank: PaidLeague) => leagues.find((league) => league.rank === rank)?.wallets.length ?? 0;
  const pools = leaguePrizesUsd(1, { platinum: count("Platinum"), gold: count("Gold") });

  const settle = (): number[][] | null => {
    const out: number[][] = [];
    const floors: number[] = [];
    let below = -1;
    for (let i = 0; i < leagues.length; i += 1) {
      const { rank, auras } = leagues[i];
      const pool = pools[rank];
      floors[i] = below < 0 ? 0 : Math.max(...out[below]) * LEAGUE_GAP;
      const limit = auras.length ? (MAX_FLOOR_SHARE * pool) / auras.length : 0;
      if (below >= 0 && floors[i] > limit) {
        const lower = leagues[below];
        const capped = fitPayouts(pools[lower.rank], lower.auras, floors[below], limit / LEAGUE_GAP);
        if (!capped) return null;
        out[below] = capped;
        floors[i] = limit;
      }
      const paid = fitPayouts(pool, auras, floors[i], Infinity);
      if (!paid) return null;
      out[i] = paid;
      if (auras.length) below = i;
    }
    return out;
  };

  const proRata = () =>
    leagues.map(({ rank, auras }) => {
      const total = auras.reduce((sum, a) => sum + a, 0);
      return auras.map((a) => (total > 0 ? (pools[rank] * a) / total : pools[rank] / auras.length));
    });

  const payouts = settle() ?? proRata();
  const shares = new Map<string, number>();
  leagues.forEach((league, i) => league.wallets.forEach((wallet, j) => shares.set(wallet, payouts[i][j])));
  return shares;
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
