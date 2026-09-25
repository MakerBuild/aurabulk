import { upstreamJson } from "@/lib/upstream";
import { readTotals } from "@/lib/totals";
import type { Totals } from "@/types";

/** The `totals` block of a leaderboard page — also read by scripts/fetch-totals. */
export interface LiveTotalsResponse {
  total?: number;
  totals?: {
    total_wallets?: number;
    total_deposited_amount?: number;
    total_withdrawn_amount?: number;
    total_current_amount?: number;
  };
}

let cache: { at: number; data: Totals } | null = null;
const CACHE_MS = 300_000;

/** Live TVL/deposited/withdrawn from upstream; falls back to data/totals.json. */
export async function getLiveTotals(): Promise<Totals | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const local = readTotals();

  try {
    const res = await upstreamJson<LiveTotalsResponse>(
      "/v1/aura/predeposit/leaderboard?page=1&page_size=1",
      { revalidate: 300 },
    );
    const t = res?.totals ?? {};
    const tvl = Number(t.total_current_amount) || 0;
    const totalDeposited = Number(t.total_deposited_amount) || 0;
    const totalWithdrawn = Number(t.total_withdrawn_amount) || 0;
    const totalWallets = Number(t.total_wallets) || 0;
    const leaderboardWallets = Number(res?.total) || undefined;

    if (tvl <= 0 && totalDeposited <= 0) return local;

    const data: Totals = {
      tvl,
      totalDeposited,
      totalWithdrawn,
      totalWallets,
      leaderboardWallets,
      updatedAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return local;
  }
}

