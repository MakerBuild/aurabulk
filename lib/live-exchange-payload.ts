import { fetchExchangeMetrics, fetchExchangeStats } from "@/lib/bulk-exchange";
import { fetchBulkstatsTradeStats } from "@/lib/bulkstats";
import type { LevelPoint } from "@/lib/exchange-level-history";
import { getExchangeLevelHistory, recordExchangeLevels } from "@/lib/exchange-level-store";
import { sumCandleVolumes } from "@/lib/volume-history";

export const LIVE_EXCHANGE_TTL_MS = 15_000;
/**
 * `/stats` reports open interest the way the exchange's own market list does —
 * one side, priced at mark. We used to double it on the theory that the
 * official figure needed longs and shorts added together, which put $12.36M on
 * the card against $6.18M upstream and $6.14M summed off BULK's own per-market
 * column. Take it as given.
 */
const OI_SIDES = 1;

export interface LiveExchangePayload {
  volume24hUsd: number;
  volumeTotalUsd: number;
  /** All-time unique fills. BulkStats exposes no 24h fill count, so there is
   *  deliberately no `trades24h` — the old field held this same total. */
  tradesTotal: number;
  openInterestUsd: number;
  activeTraders: number;
  totalAccounts: number;
  tps: number | null;
  oiHistory: LevelPoint[];
  tradersHistory: LevelPoint[];
  updatedAt: string;
}

const EMPTY: LiveExchangePayload = {
  volume24hUsd: 0,
  volumeTotalUsd: 0,
  tradesTotal: 0,
  openInterestUsd: 0,
  activeTraders: 0,
  totalAccounts: 0,
  tps: null,
  oiHistory: [],
  tradersHistory: [],
  updatedAt: new Date(0).toISOString(),
};

let payloadCache: { at: number; data: LiveExchangePayload } | null = null;
let lastTxSample: { at: number; unique: number } | null = null;

function tpsFromSample(unique: number, at: number): number | null {
  const prev = lastTxSample;
  lastTxSample = { at, unique };
  if (!prev || unique < prev.unique) return null;
  const dt = (at - prev.at) / 1000;
  if (dt < 0.4) return null;
  return (unique - prev.unique) / dt;
}

/**
 * `revalidate` is the fetch-cache window for the upstream calls. It matters
 * beyond freshness: a route's revalidate is the minimum of every cache used
 * while rendering it, so the 15s default here pinned every statically
 * generated page to a 15s window through the root layout. The layout passes
 * a long one — its payload is baked into HTML that is already cached for an
 * hour, and the client provider polls /api/live-exchange on mount anyway.
 */
export async function buildLiveExchangePayload(
  revalidate?: number,
): Promise<LiveExchangePayload> {
  const now = Date.now();
  if (payloadCache && now - payloadCache.at < LIVE_EXCHANGE_TTL_MS) {
    return payloadCache.data;
  }

  try {
    // allSettled, not all: these are four independent upstreams and every
    // reader below already tolerates a missing one. Under Promise.all a single
    // network-level rejection rejected the lot and dropped the payload to
    // zeros — which is what blanked every KPI in production while /stats and
    // klines were answering fine on their own.
    const [statsR, metricsR, candleR, fillsR] = await Promise.allSettled([
      fetchExchangeStats(revalidate),
      // no-store only on the live API path; a static render must not use it.
      fetchExchangeMetrics(revalidate == null, revalidate),
      sumCandleVolumes(revalidate),
      fetchBulkstatsTradeStats(revalidate),
    ]);

    function settled<T>(result: PromiseSettledResult<T>, label: string): T | null {
      if (result.status === "fulfilled") return result.value;
      console.warn(`[live-exchange] ${label} unavailable:`, result.reason);
      return null;
    }

    const stats = settled(statsR, "stats");
    const metrics = settled(metricsR, "metrics");
    const candleVolume = settled(candleR, "klines");
    const fillStats = settled(fillsR, "bulkstats");

    // Nothing answered — hold the last good payload instead of publishing
    // zeros over it.
    if (!stats && !metrics && !candleVolume && !fillStats) {
      return payloadCache?.data ?? EMPTY;
    }
    const unique = Number(metrics?.unique_submissions) || 0;
    const sampled = unique > 0 ? tpsFromSample(unique, Date.now()) : null;
    const tps = sampled ?? payloadCache?.data.tps ?? null;
    const uniqueFills = fillStats?.trades || payloadCache?.data.tradesTotal || 0;
    const data: LiveExchangePayload = {
      // Volume from klines only. `/stats`, `/ticker`, and ticker WS fields
      // currently under-report 24h volume / change.
      volume24hUsd: candleVolume?.volume24hUsd ?? payloadCache?.data.volume24hUsd ?? 0,
      volumeTotalUsd:
        candleVolume?.volumeTotalUsd ||
        candleVolume?.volume24hUsd ||
        payloadCache?.data.volumeTotalUsd ||
        0,
      // Unique fills from BulkStats (same Total Trades as their General card).
      // Candle `n` and `unique_submissions` are not fill counts.
      tradesTotal: uniqueFills,
      // A source that is down holds its previous reading rather than
      // reporting a real zero.
      openInterestUsd:
        (Number(stats?.openInterest?.totalUsd) || 0) * OI_SIDES ||
        (payloadCache?.data.openInterestUsd ?? 0),
      activeTraders:
        Number(metrics?.executor_cardinality?.primary?.cached_accounts) ||
        (payloadCache?.data.activeTraders ?? 0),
      totalAccounts:
        Number(metrics?.executor_cardinality?.primary?.world_accounts) ||
        (payloadCache?.data.totalAccounts ?? 0),
      tps,
      oiHistory: [],
      tradersHistory: [],
      updatedAt: new Date(now).toISOString(),
    };
    recordExchangeLevels(data.openInterestUsd, data.activeTraders);
    const history = getExchangeLevelHistory();
    data.oiHistory = history.oi;
    data.tradersHistory = history.traders;
    payloadCache = { at: now, data };
    return data;
  } catch {
    return payloadCache?.data ?? EMPTY;
  }
}
