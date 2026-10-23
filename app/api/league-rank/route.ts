import { NextRequest, NextResponse } from "next/server";
import { payoutShareByWallet, readTradingLeaguesFile } from "@/lib/trading-leagues";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Read from disk per request: the weekly job rewrites the file in place. */
export const dynamic = "force-dynamic";

/**
 * One wallet's place in BULK's settled leagues, for the Challenger Series
 * leaderboard search. A wallet the leagues do not list is Unranked.
 */
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!SOLANA_ADDRESS_RE.test(wallet)) {
    return NextResponse.json({ error: "Not a wallet address" }, { status: 400 });
  }
  // Exact match: base58 addresses are case-sensitive.
  const file = readTradingLeaguesFile();
  const row = file.rows.find((r) => r.wallet === wallet);
  return NextResponse.json(
    row
      ? {
          wallet,
          position: row.position,
          tradingAura: row.tradingAura,
          rank: row.rank,
          share: payoutShareByWallet(file).get(wallet) ?? null,
        }
      : { wallet, position: null, tradingAura: 0, rank: "Unranked", share: null },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
