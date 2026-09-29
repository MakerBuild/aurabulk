import {
  fetchL2Book,
  fetchTicker,
  fetchTradingMarkets,
  type ExchangeMarketInfo,
} from "@/lib/bulk-exchange";
import type { Level } from "@/lib/order-book-math";

export const MARKET_QUALITY_TTL_MS = 2_000;
/** How long the CDN holds the every-market answer. It only keeps the other
 *  tickers warm for a switch; the one on screen is polled on its own. */
export const ALL_MARKETS_TTL_MS = 10_000;
/** Markets fetched at once for the every-market answer. The exchange turns
 *  away bursts (16 requests at once mostly come back 429) though it takes
 *  8 a second spread out, so two markets, four requests, at a time. */
const ALL_MARKETS_CONCURRENCY = 2;

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
  /** Smallest price step, in quote units; null when exchangeInfo is down. */
  tickSize: number | null;
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
    tickSize: info?.tickSize != null && Number.isFinite(Number(info.tickSize)) ? Number(info.tickSize) : null,
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

export interface AllMarketsPayload {
  markets: string[];
  /** One payload per market that answered; a market whose book failed this
   *  time is left out, and the page keeps its last reading. */
  payloads: MarketQualityPayload[];
}

/**
 * Every trading market, so the Stats page holds them all and a ticker switch
 * shows data already there. The exchange has no batch endpoint, so each
 * market's book and ticker are fetched, a couple of markets at a time.
 */
export async function buildAllMarketsPayload(): Promise<AllMarketsPayload> {
  const markets = await tradingMarkets();
  const symbols = markets.length ? markets.map((m) => m.symbol) : [DEFAULT_MARKET];
  const payloads: MarketQualityPayload[] = [];
  const queue = [...symbols];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const p = await buildMarketQualityPayload(s).catch(() => null);
      if (p) payloads.push(p);
    }
  };
  await Promise.all(Array.from({ length: ALL_MARKETS_CONCURRENCY }, worker));
  // Back in the markets' own order, whatever order they finished in.
  payloads.sort((a, b) => symbols.indexOf(a.symbol) - symbols.indexOf(b.symbol));
  if (!payloads.length) throw new Error("market quality: no market answered");
  return { markets: symbols, payloads };
}
