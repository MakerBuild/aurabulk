import {
  fetchL2Book,
  fetchTicker,
  fetchTradingMarkets,
  type ExchangeMarketInfo,
} from "@/lib/bulk-exchange";
import type { Level } from "@/lib/order-book-math";

export const MARKET_QUALITY_TTL_MS = 2_000;

export const DEFAULT_MARKET = "BTC-USD";

/**
 * The raw book plus the ticker's mark and oracle. Every derived figure — top
 * of book, depth, the cost of an order — is computed in the browser from
 * `bids` / `asks`, so the Stats page can re-price an order as it is typed
 * without asking the server again.
 */
export interface MarketQualityPayload {
  symbol: string;
  /** Decimals the exchange quotes this market's price in. */
  pricePrecision: number;
  markets: string[];
  bids: Level[];
  asks: Level[];
  markPrice: number | null;
  oraclePrice: number | null;
  /** Hourly funding rate as a fraction. */
  fundingRate: number | null;
  updatedAt: string;
}

const cache = new Map<string, { at: number; data: MarketQualityPayload }>();

let marketsCache: { at: number; data: ExchangeMarketInfo[] } | null = null;

async function tradingMarkets(): Promise<ExchangeMarketInfo[]> {
  if (marketsCache && Date.now() - marketsCache.at < 3_600_000) return marketsCache.data;
  const data = await fetchTradingMarkets().catch(() => []);
  if (data.length) marketsCache = { at: Date.now(), data };
  return data.length ? data : (marketsCache?.data ?? []);
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Null when `symbol` is not a market open for trading. */
export async function buildMarketQualityPayload(
  symbol: string,
): Promise<MarketQualityPayload | null> {
  const markets = await tradingMarkets();
  const info = markets.find((m) => m.symbol === symbol);
  // An unreachable exchangeInfo leaves no list to check against; still serve
  // the default market rather than nothing.
  if (!info && !(markets.length === 0 && symbol === DEFAULT_MARKET)) return null;

  const now = Date.now();
  const hit = cache.get(symbol);
  if (hit && now - hit.at < MARKET_QUALITY_TTL_MS) return hit.data;

  const [bookR, tickerR] = await Promise.allSettled([fetchL2Book(symbol), fetchTicker(symbol)]);
  const book = bookR.status === "fulfilled" ? bookR.value : null;
  const ticker = tickerR.status === "fulfilled" ? tickerR.value : null;
  // Without the book every figure but mark/oracle would read as an empty
  // market; hold the last good reading instead.
  if (!book) {
    if (hit) return hit.data;
    throw new Error(`market quality ${symbol}: book unavailable`);
  }

  const data: MarketQualityPayload = {
    symbol,
    pricePrecision: info?.pricePrecision ?? 2,
    markets: markets.map((m) => m.symbol),
    bids: book.bids.map((l) => [l.px, l.sz]),
    asks: book.asks.map((l) => [l.px, l.sz]),
    markPrice: finiteOrNull(ticker?.markPrice),
    oraclePrice: finiteOrNull(ticker?.oraclePrice),
    fundingRate: ticker?.fundingRate != null ? Number(ticker.fundingRate) : null,
    updatedAt: new Date(now).toISOString(),
  };
  cache.set(symbol, { at: now, data });
  return data;
}
