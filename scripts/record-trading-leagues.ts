/**
 * Record every wallet's official trading rank (Challenger Series).
 *
 * The indexer's Aura leaderboard takes `trading_only=true`, which ranks the
 * wallets with trading volume by Aura from trading and attaches each one's
 * league; one or two pages cover everyone. `league_source=frozen` asks for
 * the leagues as BULK settled them at the last snapshot, which is what the
 * BULK app shows and pays on: the default, `live`, is a running preview that
 * still counts the market makers the rules leave out. Wallets it does not
 * list, or lists without a league, are Unranked.
 *
 * Ranks run on Trading Aura since launch, not one week's: a trader who skips
 * a week keeps the league their earlier weeks earned (confirmed by BULK).
 *
 * BULK can rework the frozen list between snapshots: on 2026-10-31 it had
 * dropped a disqualified #1 and counted sub-wallets into their root's Aura.
 * So this runs hourly, not only when the snapshot moves.
 *
 *   npm run record:leagues
 */
import { toRankName } from "../lib/ranks";
import { readTradingLeaguesFile, writeTradingLeaguesFile, type TradingLeagueRow } from "../lib/trading-leagues";
import { upstreamJson } from "../lib/upstream";

const PAGE_SIZE = 2000;

interface TradingLeaderboardPage {
  has_next?: boolean;
  qualification_threshold?: number;
  league_population?: number;
  rows?: {
    rank?: number;
    wallet: string;
    trading_aura?: number;
    league?: { name?: string } | null;
  }[];
}

async function main() {
  const rows: TradingLeagueRow[] = [];
  let population = 0;
  let threshold = 0;

  for (let page = 1; ; page += 1) {
    const data = await upstreamJson<TradingLeaderboardPage>(
      `/v1/aura/leaderboard?trading_only=true&league_source=frozen&page=${page}&page_size=${PAGE_SIZE}`,
      { noStore: true, timeoutMs: 30_000 },
    );
    if (!data?.rows) throw new Error(`trading leaderboard page ${page} came back empty`);

    population = Number(data.league_population) || population;
    threshold = Number(data.qualification_threshold) || threshold;
    for (const row of data.rows) {
      if (!row.league?.name) continue;
      rows.push({
        wallet: row.wallet,
        rank: toRankName(row.league.name),
        position: row.rank ?? null,
        tradingAura: Number(row.trading_aura) || 0,
      });
    }
    if (!data.has_next) break;
  }

  // An empty ranking would quietly demote everyone to Unranked — keep the
  // last file rather than write that.
  if (rows.length === 0) throw new Error("refusing to write: no ranked wallets");

  // This runs hourly to catch BULK's corrections between snapshots. An
  // unchanged list keeps its file, and with it the time it was settled.
  const last = readTradingLeaguesFile();
  if (
    last.population === population &&
    last.qualificationThreshold === threshold &&
    JSON.stringify(last.rows) === JSON.stringify(rows)
  ) {
    console.log(`[leagues] unchanged since ${last.updatedAt}`);
    return;
  }

  writeTradingLeaguesFile({
    updatedAt: new Date().toISOString(),
    population,
    qualificationThreshold: threshold,
    rows,
  });

  const byRank = new Map<string, number>();
  for (const row of rows) byRank.set(row.rank, (byRank.get(row.rank) ?? 0) + 1);
  console.log(
    `[leagues] ${rows.length} ranked of ${population} qualified · ` +
      [...byRank.entries()].map(([rank, n]) => `${rank}=${n}`).join(" "),
  );
}

main().catch((error) => {
  console.error("[leagues] failed:", error);
  process.exit(1);
});
