import { fetchExchangeMetrics, fetchExchangeStats } from "@/lib/bulk-exchange";
import type { LevelPoint } from "@/lib/exchange-level-history";
import { getExchangeLevelHistory, recordExchangeLevels } from "@/lib/exchange-level-store";
import { sumCandleVolumes } from "@/lib/volume-history";

export const LIVE_EXCHANGE_TTL_MS = 15_000;

export interface LiveExchangePayload {
  volume24hUsd: number;
  volumeTotalUsd: number;
  /**
   * Signed submissions the executor has accepted from `/metrics` — orders,
   * cancels and modifies, not fills. The official API exposes no fill count:
   * kline `n` counts order updates, 6.5M on BTC-USD alone in a day, and the
   * other `/metrics` counters are network packets.
   *
   * It counts from the node's last restart, not all time: at the 109/s this
   * was measured running, the counter's 3.85M is about ten hours of traffic.
   * So it can fall, which is why nothing displays it directly — it is here to
   * derive TPS from, and the consumers of that handle the reset.
   */
  submissionsTotal: number;
  openInterestUsd: number;
  activeTraders: number;
  totalAccounts: number;
  /** Submissions per second. Always null on the wire — the client fills it in
   *  from consecutive `submissionsTotal` readings, which is the only place
   *  two reliably distinct readings exist. */
  tps: number | null;
  oiHistory: LevelPoint[];
  tradersHistory: LevelPoint[];
  updatedAt: string;
}

const EMPTY: LiveExchangePayload = {
  volume24hUsd: 0,
  volumeTotalUsd: 0,
  submissionsTotal: 0,
  openInterestUsd: 0,
  activeTraders: 0,
  totalAccounts: 0,
  tps: null,
  oiHistory: [],
  tradersHistory: [],
  updatedAt: new Date(0).toISOString(),
};

let payloadCache: { at: number; data: LiveExchangePayload } | null = null;

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
    // allSettled, not all: these are three independent upstreams and every
    // reader below already tolerates a missing one. Under Promise.all a single
    // network-level rejection rejected the lot and dropped the payload to
    // zeros — which is what blanked every KPI in production while /stats and
    // klines were answering fine on their own.
    const [statsR, metricsR, candleR] = await Promise.allSettled([
      fetchExchangeStats(revalidate),
      // no-store only on the live API path; a static render must not use it.
      fetchExchangeMetrics(revalidate == null, revalidate),
      sumCandleVolumes(revalidate),
    ]);

    function settled<T>(result: PromiseSettledResult<T>, label: string): T | null {
      if (result.status === "fulfilled") return result.value;
      console.warn(`[live-exchange] ${label} unavailable:`, result.reason);
      return null;
    }

    const stats = settled(statsR, "stats");
    const metrics = settled(metricsR, "metrics");
    const candleVolume = settled(candleR, "klines");

    // Nothing answered — hold the last good payload instead of publishing
    // zeros over it.
    if (!stats && !metrics && !candleVolume) {
      return payloadCache?.data ?? EMPTY;
    }
    const unique = Number(metrics?.unique_submissions) || 0;

    const data: LiveExchangePayload = {
      // Volume from klines only. `/stats`, `/ticker`, and ticker WS fields
      // currently under-report 24h volume / change.
      volume24hUsd: candleVolume?.volume24hUsd ?? payloadCache?.data.volume24hUsd ?? 0,
      volumeTotalUsd:
        candleVolume?.volumeTotalUsd ||
        candleVolume?.volume24hUsd ||
        payloadCache?.data.volumeTotalUsd ||
        0,
      submissionsTotal: unique || payloadCache?.data.submissionsTotal || 0,
      // A source that is down holds its previous reading rather than
      // reporting a real zero. `/stats` reports open interest one side, priced
      // at mark — the way the exchange's own market list shows it.
      openInterestUsd:
        Number(stats?.openInterest?.totalUsd) ||
        (payloadCache?.data.openInterestUsd ?? 0),
      // `cached_accounts` is accounts holding a position or an open order —
      // confirmed by BULK, and it behaves that way: the series rises and falls
      // intraday rather than accumulating, and 43% of our top 300 wallets by
      // volume hold one right now against 17% of all accounts on the exchange.
      // So it is genuinely active traders, not a node cache statistic.
      activeTraders:
        Number(metrics?.executor_cardinality?.primary?.cached_accounts) ||
        (payloadCache?.data.activeTraders ?? 0),
      totalAccounts:
        Number(metrics?.executor_cardinality?.primary?.world_accounts) ||
        (payloadCache?.data.totalAccounts ?? 0),
      // Always null from here: see the field's note. Measuring it server-side
      // paired whatever two readings an instance happened to hold, and a
      // cached /metrics response made those a day apart — which reported
      // 11,547/s against an actual 109/s.
      tps: null,
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
