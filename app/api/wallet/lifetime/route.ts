import { NextRequest, NextResponse } from "next/server";
import { fetchFillTotals } from "@/lib/bulk-exchange";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const dynamic = "force-dynamic";

/**
 * A wallet's volume and fees over every fill the exchange still holds. Its
 * own route, asked for after the lookup has drawn: a busy wallet's history
 * runs to several pages, and the lookup used to wait seconds on it.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!SOLANA_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid wallet address format" }, { status: 400 });
  }
  const totals = await fetchFillTotals(address);
  if (!totals) return NextResponse.json({ error: "Exchange unavailable" }, { status: 503 });
  return NextResponse.json(totals, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
