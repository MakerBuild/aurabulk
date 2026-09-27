import { NextResponse, type NextRequest } from "next/server";
import { fetchAccountSnapshot } from "@/lib/bulk-exchange";

export const dynamic = "force-dynamic";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A wallet's trailing 14-day volume, which is what sets its fee tier. */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!SOLANA_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }
  const snapshot = await fetchAccountSnapshot(address);
  if (!snapshot) {
    return NextResponse.json({ error: "No BULK account for this wallet" }, { status: 404 });
  }
  return NextResponse.json(
    { volumeUsd: snapshot.volumeUsd, windowDays: snapshot.windowDays },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
