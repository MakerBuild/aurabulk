import { USER_AGENT, fetchWithRetry } from "@/lib/http";

/**
 * Mainnet exchange HTTP (not the Aura indexer).
 * https://mainnet-api1.bulk.trade/api/v1
 */
const EXCHANGE_API_BASE =
  process.env.BULK_EXCHANGE_API_BASE?.replace(/\/$/, "") ||
  "https://mainnet-api1.bulk.trade/api/v1";

const EXCHANGE_TIMEOUT_MS = 10_000;

interface ExchangeMarketStat {
  symbol: string;
  volume: number;
  quoteVolume: number;
  openInterest: number;
  lastPrice: number;
  markPrice: number;
}

interface ExchangeStats {
  timestamp: number;
  period: string;
  volume: { totalUsd: number };
  openInterest: { totalUsd: number };
  markets: ExchangeMarketStat[];
}

interface ExchangeMetrics {
  received_count?: number;
  unique_submissions?: number;
  http_received_count?: number;
  timestamp_unix_ms?: number;
  executor_cardinality?: {
    primary?: {
      cached_accounts?: number;
      world_accounts?: number;
    };
  };
}

export interface ExchangeCandle {
  t: number;
  T: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
}

async function exchangeFetch(
  path: string,
  options: { revalidate?: number; noStore?: boolean } = {},
): Promise<Response> {
  const { revalidate = 15, noStore = false } = options;
  const url = `${EXCHANGE_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    ...(noStore ? { cache: "no-store" as const } : { next: { revalidate } }),
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
  });
}

/** Markets + OI only. Do not use `volume` / `quoteVolume` — those fields
 * (and `/ticker` 24h volume / change) are currently wrong. Volume comes
 * from `fetchKlines`. */
export async function fetchExchangeStats(revalidate = 15): Promise<ExchangeStats | null> {
  const res = await exchangeFetch("/stats?period=1d", { revalidate });
  if (!res.ok) return null;
  return (await res.json()) as ExchangeStats;
}

export async function fetchExchangeMetrics(
  noStore = false,
  revalidate = 5,
): Promise<ExchangeMetrics | null> {
  const res = await exchangeFetch("/metrics", noStore ? { noStore: true } : { revalidate });
  if (!res.ok) return null;
  return (await res.json()) as ExchangeMetrics;
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  startTime?: number,
  endTime?: number,
  revalidate = 60,
): Promise<ExchangeCandle[]> {
  const params = new URLSearchParams({ symbol, interval });
  if (startTime != null) params.set("startTime", String(startTime));
  if (endTime != null) params.set("endTime", String(endTime));
  const res = await exchangeFetch(`/klines?${params.toString()}`, { revalidate });
  // A market with no candles is a real empty series; anything else is a
  // failure and must not be summed as zero volume.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`klines ${symbol} ${interval} failed: ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error(`klines ${symbol} ${interval}: unexpected payload`);
  return data as ExchangeCandle[];
}

export function marketBase(symbol: string): string {
  return symbol.replace(/-USD$/i, "").toUpperCase();
}

interface AccountSnapshot {
  volumeUsd: number;
  windowDays: number;
  balanceUsd: number;
  pnlUsd: number;
  /** Lifetime trading fees, as a positive number — upstream reports them
   *  negative, being a debit against margin. */
  feesUsd: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function unwrapAccount(payload: unknown): Record<string, unknown> | null {
  const first = Array.isArray(payload) ? payload[0] : payload;
  const root = asRecord(first);
  if (!root) return null;
  return asRecord(root.fullAccount) ?? root;
}

function readAccountSnapshot(payload: unknown): AccountSnapshot | null {
  const account = unwrapAccount(payload);
  if (!account) return null;
  const margin = asRecord(account.margin) ?? {};
  const feeTiers = Array.isArray(account.feeTiers) ? account.feeTiers : [];
  const global =
    feeTiers
      .map((row) => asRecord(row))
      .find((row) => row && (row.symbol === "global" || row.symbol == null)) ??
    asRecord(feeTiers[0]);
  const volumeUsd = Number(global?.rollingVolume);
  const balanceUsd = Number(margin.totalMargin ?? margin.totalBalance);
  const realized = Number(margin.realizedPnl) || 0;
  const unrealized = Number(margin.unrealizedPnl) || 0;
  const fees = Number(margin.fees) || 0;
  if (![volumeUsd, balanceUsd].some((n) => Number.isFinite(n))) return null;
  return {
    volumeUsd: Number.isFinite(volumeUsd) && volumeUsd > 0 ? volumeUsd : 0,
    windowDays: Number(global?.windowDays) || 14,
    balanceUsd: Number.isFinite(balanceUsd) ? balanceUsd : 0,
    pnlUsd: realized + unrealized,
    feesUsd: Math.abs(fees),
  };
}

const ACCOUNT_MAX_RETRIES = 4;
const ACCOUNT_MAX_WAIT_MS = 8_000;

/**
 * The exchange rate-limits this endpoint hard: a walk of 400 wallets at eight
 * in flight came back 271 × 429. Returning null on those looked like "wallet
 * has no exchange account" to every caller, which is how wallets with millions
 * in volume sat at zero for weeks. Wait 429s and server errors out instead;
 * only a real answer — including a 404, which genuinely means no account —
 * ends the attempt.
 */
async function postAccount(wallet: string): Promise<unknown> {
  try {
    const res = await fetchWithRetry(
      `${EXCHANGE_API_BASE}/account`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ type: "fullAccount", user: wallet }),
        cache: "no-store",
      },
      {
        maxRetries: ACCOUNT_MAX_RETRIES,
        timeoutMs: EXCHANGE_TIMEOUT_MS,
        baseBackoffMs: 500,
        maxBackoffMs: ACCOUNT_MAX_WAIT_MS,
      },
    );
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Margin, PnL, and 14d volume from an unsigned fullAccount snapshot. */
export async function fetchAccountSnapshot(wallet: string): Promise<AccountSnapshot | null> {
  return readAccountSnapshot(await postAccount(wallet));
}
