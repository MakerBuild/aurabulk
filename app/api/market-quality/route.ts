import { NextResponse, type NextRequest } from "next/server";
import {
  ALL_MARKETS_TTL_MS,
  buildAllMarketsPayload,
  buildMarketQualityPayload,
  DEFAULT_MARKET,
  MARKET_QUALITY_TTL_MS,
} from "@/lib/market-quality";

/** Dynamic: the book is fetched no-store. CDN caching comes from the header. */
export const dynamic = "force-dynamic";

const CACHE_CONTROL = `public, s-maxage=${Math.round(MARKET_QUALITY_TTL_MS / 1000)}, stale-while-revalidate=4`;
const ALL_CACHE_CONTROL = `public, s-maxage=${Math.round(ALL_MARKETS_TTL_MS / 1000)}, stale-while-revalidate=20`;

/** One market by symbol, polled fast for the ticker on screen; `?symbol=all`
 *  answers for every market, polled slowly to keep the others warm. */
export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || DEFAULT_MARKET).toUpperCase();
  try {
    if (symbol === "ALL") {
      return NextResponse.json(await buildAllMarketsPayload(), { headers: { "Cache-Control": ALL_CACHE_CONTROL } });
    }
    const payload = await buildMarketQualityPayload(symbol);
    if (!payload) {
      return NextResponse.json({ error: `Unknown market ${symbol}` }, { status: 404 });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch {
    return NextResponse.json({ error: "Market data unavailable" }, { status: 503 });
  }
}
