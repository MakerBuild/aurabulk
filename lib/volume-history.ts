import { fetchExchangeStats, fetchKlines, marketBase, type ExchangeCandle } from "@/lib/bulk-exchange";

export const VOLUME_RANGES = ["1D", "W", "M", "Q", "Y", "ALL"] as const;
export type VolumeRange = (typeof VOLUME_RANGES)[number];

export const VOLUME_COINS = ["btc", "eth", "sol", "others"] as const;
export type VolumeCoin = (typeof VOLUME_COINS)[number];

export interface VolumeBucket {
  t: number;
  btc: number;
  eth: number;
  sol: number;
  others: number;
  total: number;
  cumulative: number;
}

export interface VolumeHistoryPayload {
  range: VolumeRange;
  interval: string;
  buckets: VolumeBucket[];
}

const RANGE_MS: Record<Exclude<VolumeRange, "ALL">, number> = {
  "1D": 24 * 3_600_000,
  W: 7 * 86_400_000,
  M: 30 * 86_400_000,
  Q: 90 * 86_400_000,
  Y: 365 * 86_400_000,
};

const RANGE_INTERVAL: Record<VolumeRange, string> = {
  "1D": "1h",
  W: "4h",
  M: "1d",
  Q: "1d",
  Y: "1w",
  ALL: "1d",
};

/** First hour with tradeable mainnet candles. */
const MAINNET_START_MS = Date.UTC(2026, 8, 1);

const NAMED: Record<string, VolumeCoin> = {
  BTC: "btc",
  ETH: "eth",
  SOL: "sol",
};

/** Keyed, not a single slot: the Overview asks for `ALL:1h` and a range in the
 *  same render, and one shared slot made each call evict the other — every
 *  request then refetched klines for every market from mainnet start. */
const historyCache = new Map<string, { at: number; data: VolumeHistoryPayload }>();
const HISTORY_TTL_MS = 60_000;

function candleUsd(candle: ExchangeCandle): number {
  const close = Number(candle.c) || 0;
  const vol = Number(candle.v) || 0;
  if (!(close > 0) || !(vol > 0)) return 0;
  return close * vol;
}

const INTERVAL_MS: Record<string, number> = {
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "1d": 86_400_000,
};

/** Bucket start for a candle. Weekly candles keep their own open time: epoch
 *  weeks start on a Thursday, so flooring would shift every bar by days. */
function bucketTime(t: number, interval: string): number {
  const ms = INTERVAL_MS[interval];
  return ms ? Math.floor(t / ms) * ms : t;
}

function coinForSymbol(symbol: string): VolumeCoin {
  return NAMED[marketBase(symbol)] ?? "others";
}

/**
 * Markets to sum over. Throws rather than returning an empty list: with no
 * markets every sum below is a clean-looking zero, which callers would cache
 * and publish over the last good figure.
 */
async function marketSymbols(revalidate?: number): Promise<string[]> {
  const stats = await fetchExchangeStats(revalidate);
  const symbols = (stats?.markets ?? []).map((m) => m.symbol).filter((s) => s && s !== "MEGA-USD");
  if (!symbols.length) throw new Error("exchange /stats returned no markets");
  return symbols;
}

async function buildBuckets(
  range: VolumeRange,
  interval: string,
  startTime: number | undefined,
  now: number,
): Promise<VolumeHistoryPayload> {
  const symbols = await marketSymbols();
  const series = await Promise.all(
    symbols.map(async (symbol) => ({
      symbol,
      candles: await fetchKlines(symbol, interval, startTime, now),
    })),
  );

  const byTime = new Map<number, VolumeBucket>();
  for (const { symbol, candles } of series) {
    const coin = coinForSymbol(symbol);
    for (const candle of candles) {
      const t = bucketTime(Number(candle.t) || 0, interval);
      if (!t) continue;
      const usd = candleUsd(candle);
      if (!(usd > 0)) continue;
      const row =
        byTime.get(t) ??
        ({ t, btc: 0, eth: 0, sol: 0, others: 0, total: 0, cumulative: 0 } satisfies VolumeBucket);
      row[coin] += usd;
      byTime.set(t, row);
    }
  }

  const buckets = [...byTime.values()].sort((a, b) => a.t - b.t);
  let running = 0;
  for (const row of buckets) {
    row.total = row.btc + row.eth + row.sol + row.others;
    running += row.total;
    row.cumulative = running;
  }

  return { range, interval, buckets };
}

export async function buildVolumeHistory(range: VolumeRange): Promise<VolumeHistoryPayload> {
  const now = Date.now();
  const cached = historyCache.get(range);
  if (cached && now - cached.at < HISTORY_TTL_MS) {
    return cached.data;
  }

  const startTime = range === "ALL" ? undefined : now - RANGE_MS[range];
  const data = await buildBuckets(range, RANGE_INTERVAL[range], startTime, now);
  historyCache.set(range, { at: now, data });
  return data;
}

const VOLUME_TTL_MS = 60_000;
let volumeCache: {
  at: number;
  volume24hUsd: number;
  volumeTotalUsd: number;
} | null = null;

function sumCandlesUsd(candles: ExchangeCandle[], from?: number): number {
  let usd = 0;
  for (const candle of candles) {
    const t = Number(candle.t) || 0;
    if (from != null && t < from) continue;
    usd += candleUsd(candle);
  }
  return usd;
}

/**
 * Volume from klines only — `/stats`, `/ticker`, and ticker WS volume
 * fields are known-bad; candles are the exchange's conventional source.
 *
 * 24h = 1m candles. Total = hourly candles since trading mainnet opened,
 * spliced to the minute series at an hour boundary so all-time is never
 * below the live 24h print and never double-counts the splice hour.
 *
 * Do not sum candle `n` for trades: it stays thousands per minute even
 * when `v` is 0 (orders/ticks). Unique fills come from BulkStats
 * `/api/analytics/stats` `trades.count`.
 */
export async function sumCandleVolumes(revalidate = 60): Promise<{
  volume24hUsd: number;
  volumeTotalUsd: number;
}> {
  const now = Date.now();
  if (volumeCache && now - volumeCache.at < VOLUME_TTL_MS) {
    return volumeCache;
  }

  const start24h = now - RANGE_MS["1D"];
  // The hourly candle covering `start24h` opened before it, so counting that
  // whole candle as "older" and the 1m candles from `start24h` on as "24h"
  // bills the overlap twice. Splice on the hour instead and take the leading
  // partial hour from the minute series.
  const spliceMs = Math.floor(start24h / 3_600_000) * 3_600_000;
  const symbols = await marketSymbols(revalidate);
  const [minuteSeries, hourSeries] = await Promise.all([
    Promise.all(symbols.map((symbol) => fetchKlines(symbol, "1m", spliceMs, now, revalidate))),
    Promise.all(symbols.map((symbol) => fetchKlines(symbol, "1h", MAINNET_START_MS, now, revalidate))),
  ]);

  const volume24hUsd = minuteSeries.reduce((sum, candles) => sum + sumCandlesUsd(candles, start24h), 0);
  // Minutes between the splice hour and the rolling window start — covered by
  // neither the hourly sum below nor the 24h sum above.
  const spliceGapUsd = minuteSeries.reduce((sum, candles) => {
    let usd = 0;
    for (const candle of candles) {
      const t = Number(candle.t) || 0;
      if (t >= spliceMs && t < start24h) usd += candleUsd(candle);
    }
    return sum + usd;
  }, 0);
  const olderUsd = hourSeries.reduce((sum, candles) => {
    let usd = 0;
    for (const candle of candles) {
      if ((Number(candle.t) || 0) < spliceMs) usd += candleUsd(candle);
    }
    return sum + usd;
  }, 0);

  const data = { at: now, volume24hUsd, volumeTotalUsd: olderUsd + spliceGapUsd + volume24hUsd };
  volumeCache = data;
  return data;
}

/** Hourly buckets from trading mainnet start — for the Total KPI spark. */
export async function buildAllTimeHourly(): Promise<VolumeHistoryPayload> {
  const now = Date.now();
  const cached = historyCache.get("ALL:1h");
  if (cached && now - cached.at < HISTORY_TTL_MS) {
    return cached.data;
  }

  const data = await buildBuckets("ALL", "1h", MAINNET_START_MS, now);
  historyCache.set("ALL:1h", { at: now, data });
  return data;
}
