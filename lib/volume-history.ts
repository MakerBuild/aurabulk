import { fetchExchangeStats, fetchKlines, marketBase, type ExchangeCandle } from "@/lib/bulk-exchange";
import { getNextSnapshotTimestamp } from "@/lib/projected-snapshot-tvl";

export const VOLUME_RANGES = ["1D", "W", "M", "Y", "ALL"] as const;
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
  /** Open interest at the bucket, null where no snapshot landed. Added by
   *  /api/volume-history for range charts; the hourly all-time spark has none. */
  oi?: number | null;
  /** A W slot whose day hasn't started yet: drawn as an empty bar so the
   *  week keeps all seven, with no cumulative or OI to plot. */
  future?: true;
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
  Y: 365 * 86_400_000,
};

const RANGE_INTERVAL: Record<VolumeRange, string> = {
  "1D": "1h",
  W: "1d",
  M: "1d",
  Y: "1M",
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
const cacheSlots = new Map<string, { at: number; data?: unknown; pending?: Promise<unknown> }>();
const HISTORY_TTL_MS = 60_000;

/**
 * The last good value right away, rebuilt in the background once it is older
 * than the TTL. Only the first call after a restart waits for a build, and
 * concurrent callers share it. A rebuild fans out one klines call per market,
 * and every expiry used to make a visitor wait for it: with the Overview's
 * parallel requests that was 100+ calls at once, 20s+ and the odd 503.
 */
function staleWhileRevalidate<T>(key: string, build: () => Promise<T>): Promise<T> {
  let slot = cacheSlots.get(key);
  if (!slot) {
    slot = { at: 0 };
    cacheSlots.set(key, slot);
  }
  const s = slot;
  if (s.data !== undefined && Date.now() - s.at < HISTORY_TTL_MS) {
    return Promise.resolve(s.data as T);
  }
  if (!s.pending) {
    s.pending = build()
      .then((data) => {
        s.data = data;
        s.at = Date.now();
        return data;
      })
      .finally(() => {
        s.pending = undefined;
      });
  }
  if (s.data !== undefined) {
    // A failed background rebuild keeps the last good value; the next call
    // after it tries again.
    s.pending.catch(() => {});
    return Promise.resolve(s.data as T);
  }
  return s.pending as Promise<T>;
}

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
  /** Overrides the interval's own bucketing, for buckets the candles don't
   *  line up with (W's days start at the Saturday snapshot, not midnight). */
  bucketOf: (t: number) => number = (t) => bucketTime(t, interval),
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
      const t = bucketOf(Number(candle.t) || 0);
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

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

/**
 * W is the current campaign week: from the last Saturday 12:00 UTC snapshot
 * to the next, one bar per 24h from it, so seven bars whatever the day. Days
 * still ahead come back as empty `future` slots. Hourly candles, because
 * daily ones open at midnight and would split every snapshot day in two.
 */
async function buildCampaignWeek(now: number): Promise<VolumeHistoryPayload> {
  const weekStart = getNextSnapshotTimestamp(now) - WEEK_DAYS * DAY_MS;
  const dayOf = (t: number) => weekStart + Math.floor((t - weekStart) / DAY_MS) * DAY_MS;
  const { buckets } = await buildBuckets("W", "1h", weekStart, now, dayOf);

  const byTime = new Map(buckets.filter((b) => b.t >= weekStart).map((b) => [b.t, b]));
  const week: VolumeBucket[] = [];
  let running = 0;
  for (let i = 0; i < WEEK_DAYS; i++) {
    const t = weekStart + i * DAY_MS;
    const row = byTime.get(t) ?? { t, btc: 0, eth: 0, sol: 0, others: 0, total: 0, cumulative: 0 };
    running += row.total;
    week.push({ ...row, cumulative: running, ...(t > now ? { future: true as const } : {}) });
  }
  return { range: "W", interval: RANGE_INTERVAL.W, buckets: week };
}

const YEAR_MONTHS = 12;

/** Y is one bar per UTC calendar month, this one and the eleven before it.
 *  Daily candles summed by month: months aren't a fixed length to floor to. */
async function buildMonths(now: number): Promise<VolumeHistoryPayload> {
  const today = new Date(now);
  const from = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (YEAR_MONTHS - 1), 1);
  const monthOf = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  };
  const payload = await buildBuckets("Y", "1d", from, now, monthOf);
  return { ...payload, interval: RANGE_INTERVAL.Y };
}

export function buildVolumeHistory(range: VolumeRange): Promise<VolumeHistoryPayload> {
  return staleWhileRevalidate(range, () => {
    const now = Date.now();
    if (range === "W") return buildCampaignWeek(now);
    if (range === "Y") return buildMonths(now);
    const startTime = range === "ALL" ? undefined : now - RANGE_MS[range];
    return buildBuckets(range, RANGE_INTERVAL[range], startTime, now);
  });
}

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
export interface CandleVolumes {
  volume24hUsd: number;
  volumeTotalUsd: number;
  /** The same rolling 24h, per market symbol. */
  marketVolume24hUsd: Record<string, number>;
}

export function sumCandleVolumes(revalidate = 60): Promise<CandleVolumes> {
  return staleWhileRevalidate("totals", () => buildCandleVolumes(revalidate));
}

async function buildCandleVolumes(revalidate: number): Promise<CandleVolumes> {
  const now = Date.now();
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

  const marketVolume24hUsd: Record<string, number> = {};
  symbols.forEach((symbol, i) => {
    marketVolume24hUsd[symbol] = sumCandlesUsd(minuteSeries[i], start24h);
  });
  const volume24hUsd = Object.values(marketVolume24hUsd).reduce((sum, usd) => sum + usd, 0);
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

  return {
    volume24hUsd,
    volumeTotalUsd: olderUsd + spliceGapUsd + volume24hUsd,
    marketVolume24hUsd,
  };
}

/** Hourly buckets from trading mainnet start — for the Total KPI spark. */
export function buildAllTimeHourly(): Promise<VolumeHistoryPayload> {
  return staleWhileRevalidate("ALL:1h", () => buildBuckets("ALL", "1h", MAINNET_START_MS, Date.now()));
}

const WARM_EVERY_MS = 5 * 60_000;
let warmTimer: ReturnType<typeof setInterval> | undefined;

/** Waits for `key`'s build to finish, including a background rebuild that
 *  `get` only kicked off (it hands back the stale value straight away). */
async function settle(key: string, get: () => Promise<unknown>): Promise<void> {
  await get().catch(() => {});
  await cacheSlots.get(key)?.pending?.catch(() => {});
}

/**
 * Builds every range when the server starts and refreshes them every few
 * minutes after. The caches above only ever make the first caller after a
 * restart wait, but that was every range nobody had opened yet: M, Y and ALL
 * took 1–3s on their first click after each deploy. The refresh also bounds
 * how stale a rarely opened range can get before someone asks for it.
 *
 * One range at a time: each is a klines call per market, and all of them at
 * once drew 429s from the exchange, which failed the very builds this warms.
 */
export function keepVolumeHistoryWarm(): void {
  if (warmTimer) return;
  let running = false;
  const warm = async () => {
    if (running) return;
    running = true;
    try {
      // Most-opened first: the chart's default range, then the KPI spark.
      await settle("1D", () => buildVolumeHistory("1D"));
      await settle("ALL:1h", buildAllTimeHourly);
      for (const range of VOLUME_RANGES) {
        if (range !== "1D") await settle(range, () => buildVolumeHistory(range));
      }
    } finally {
      running = false;
    }
  };
  void warm();
  warmTimer = setInterval(() => void warm(), WARM_EVERY_MS);
  warmTimer.unref?.();
}
