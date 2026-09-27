import { NextResponse, type NextRequest } from "next/server";
import {
  buildMarketQualityPayload,
  DEFAULT_MARKET,
  MARKET_QUALITY_TTL_MS,
} from "@/lib/market-quality";

/** Dynamic: the book is fetched no-store. CDN caching comes from the header. */
export const dynamic = "force-dynamic";

const CACHE_CONTROL = `public, s-maxage=${Math.round(MARKET_QUALITY_TTL_MS / 1000)}, stale-while-revalidate=4`;

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || DEFAULT_MARKET).toUpperCase();
  try {
    const payload = await buildMarketQualityPayload(symbol);
    if (!payload) {
      return NextResponse.json({ error: `Unknown market ${symbol}` }, { status: 404 });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch {
    return NextResponse.json({ error: "Market data unavailable" }, { status: 503 });
  }
}
