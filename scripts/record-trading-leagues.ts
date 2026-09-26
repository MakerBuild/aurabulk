/**
 * Record every wallet's official trading rank (Challenger Series).
 *
 * The indexer only reports a rank per wallet, on /v1/aura/wallet/{addr} — no
 * leaderboard carries it. Qualified wallets are the ones ranked by Aura from
 * trading, so only a wallet with some can hold a rank: this asks the indexer
 * about each of those (plus anyone our volume sample shows trading real size,
 * in case their Aura has not landed yet) and keeps the qualified ones.
 * Everyone else is Unranked by definition.
 *
 *   npm run record:leagues
 */
import { readLeaderboardFromDisk } from "../lib/fetcher";
import { toRankName, tradingAuraOf } from "../lib/ranks";
import { writeTradingLeaguesFile, type TradingLeagueRow } from "../lib/trading-leagues";
import { upstreamJson } from "../lib/upstream";
import { readVolumeLeaderboardFile } from "../lib/volume-leaderboard";

const CONCURRENCY = 12;
const MIN_SAMPLED_VOLUME = 10_000;

interface UpstreamTradingLeague {
  qualified?: boolean;
  canonical_root_volume?: number;
  qualification_threshold?: number;
  trading_aura?: number;
  league?: { name?: string } | null;
  rank?: number | null;
  population?: number | null;
}

async function fetchLeague(wallet: string): Promise<UpstreamTradingLeague | null> {
  try {
    const profile = await upstreamJson<{ trading_league?: UpstreamTradingLeague }>(
      `/v1/aura/wallet/${wallet}`,
      { noStore: true, timeoutMs: 30_000, maxBackoffMs: 30_000 },
    );
    return profile?.trading_league ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const entries = readLeaderboardFromDisk();
  if (!entries.length) throw new Error("empty leaderboard");

  const candidates = new Set(
    entries.filter((e) => tradingAuraOf(e.categories) > 0).map((e) => e.wallet),
  );
  for (const row of readVolumeLeaderboardFile().rows) {
    if (row.volumeUsd >= MIN_SAMPLED_VOLUME) candidates.add(row.wallet);
  }

  const wallets = [...candidates];
  console.log(`[leagues] asking the indexer about ${wallets.length} wallets`);

  const rows: TradingLeagueRow[] = [];
  let population = 0;
  let threshold = 0;
  let failed = 0;

  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const batch = wallets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchLeague));
    results.forEach((league, j) => {
      if (!league) {
        failed += 1;
        return;
      }
      threshold = Number(league.qualification_threshold) || threshold;
      if (!league.qualified) return;
      population = Math.max(population, Number(league.population) || 0);
      rows.push({
        wallet: batch[j],
        rank: toRankName(league.league?.name),
        position: league.rank ?? null,
        tradingAura: Number(league.trading_aura) || 0,
        volume: Number(league.canonical_root_volume) || 0,
      });
    });
    if ((i / CONCURRENCY) % 25 === 0) {
      console.log(`[leagues] ${Math.min(i + CONCURRENCY, wallets.length)}/${wallets.length}`);
    }
  }

  // A run where the indexer was mostly down would record almost nobody as
  // ranked and quietly demote the rest to Unranked — keep the last file.
  if (failed > wallets.length * 0.05) {
    throw new Error(`refusing to write: ${failed}/${wallets.length} lookups failed`);
  }

  rows.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  writeTradingLeaguesFile({
    updatedAt: new Date().toISOString(),
    population: population || rows.length,
    qualificationThreshold: threshold,
    rows,
  });

  const byRank = new Map<string, number>();
  for (const row of rows) byRank.set(row.rank, (byRank.get(row.rank) ?? 0) + 1);
  console.log(
    `[leagues] ${rows.length} qualified of ${population} · failed=${failed} · ` +
      [...byRank.entries()].map(([rank, n]) => `${rank}=${n}`).join(" "),
  );
}

main().catch((error) => {
  console.error("[leagues] failed:", error);
  process.exit(1);
});
