import type { Metadata } from "next";
import { preload } from "react-dom";
import { PageHeading } from "@/components/layout/PageHeading";
import { ChallengerOverview, type LeagueSummary } from "@/components/challenger/ChallengerOverview";
import type { StandingRow, StandingsData } from "@/components/challenger/Standings";
import { getNextSnapshotTimestamp } from "@/lib/projected-snapshot-tvl";
import { RANK_NAMES, type RankName } from "@/lib/ranks";
import { payoutShareByWallet, readTradingLeaguesFile, type TradingLeagueRow } from "@/lib/trading-leagues";

export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "The Challenger Series | AURA Intelligence",
  description:
    "BULK's official trading leagues: every qualified trader from Bronze up to Challenger, as BULK ranks them.",
};

const WEEK_MS = 7 * 86_400_000;

/** Runners the race card draws either side of a league line: the last
 *  eleven in (#15 to #25 at the Challenger line) and the first ten out. */
const RACE_ABOVE = 11;
const RACE_BELOW = 10;
/** How far down each league the leaderboard goes. */
const BOARD_ROWS = 25;

interface Tier {
  rank: RankName;
  rows: TradingLeagueRow[];
  /** Trading AURA of the tier's last trader: what it took to get in. */
  minAura: number;
}

/** BULK's own leagues as recorded, Challenger first, each in BULK's order.
 *  Unranked is everyone missing from the file. */
function buildTiers(rows: TradingLeagueRow[]): Tier[] {
  const tiers: Tier[] = [];
  for (const rank of [...RANK_NAMES].reverse()) {
    if (rank === "Unranked") continue;
    const tierRows = rows
      .filter((row) => row.rank === rank)
      .sort((a, b) => b.tradingAura - a.tradingAura);
    tiers.push({
      rank,
      rows: tierRows,
      minAura: tierRows.length ? tierRows[tierRows.length - 1].tradingAura : 0,
    });
  }
  return tiers;
}

export default function ChallengerSeriesPage() {
  const file = readTradingLeaguesFile();
  const tiers = buildTiers(file.rows);
  const shares = payoutShareByWallet(file);
  const toStanding = (row: TradingLeagueRow, i: number): StandingRow => ({
    wallet: row.wallet,
    position: row.position ?? i + 1,
    tradingAura: row.tradingAura,
    rank: row.rank,
    share: shares.get(row.wallet) ?? null,
  });
  // The race at each line between two leagues, keyed by the league above it:
  // its last few in, then the first few of the league below, in BULK's order.
  const races: StandingsData["races"] = {};
  tiers.slice(0, -1).forEach((tier, i) => {
    const below = tiers[i + 1];
    races[tier.rank as keyof StandingsData["races"]] = [
      ...tier.rows.slice(-RACE_ABOVE),
      ...below.rows.slice(0, RACE_BELOW),
    ].map(toStanding);
  });
  const standings: StandingsData = {
    races,
    // Each league's own head, for the leaderboard the league cards switch.
    boards: Object.fromEntries(
      tiers.map((tier) => [tier.rank, tier.rows.slice(0, BOARD_ROWS).map(toStanding)]),
    ) as StandingsData["boards"],
    // BULK settles its leagues at the Saturday snapshot before the recording.
    asOf: getNextSnapshotTimestamp(Date.parse(file.updatedAt) || Date.now()) - WEEK_MS,
  };
  const leagues: LeagueSummary[] = tiers.map((tier) => {
    const ranked = tier.rows.map((row) => row.position).filter((p): p is number => p != null);
    return {
      rank: tier.rank as LeagueSummary["rank"],
      traders: tier.rows.length,
      minAura: tier.minAura,
      firstPosition: ranked.length ? Math.min(...ranked) : null,
      lastPosition: ranked.length ? Math.max(...ranked) : null,
    };
  });

  // The week's revenue and open interest start loading with the HTML rather
  // than after the scripts hydrate; the cards' own fetch picks this one up.
  preload("/api/weekly-revenue", { as: "fetch", crossOrigin: "anonymous" });

  return (
    <div className="shell flex flex-col gap-4 pb-11 pt-5">
      <PageHeading eyebrow="Challenger" title="The Challenger Series" />

      <ChallengerOverview leagues={leagues} standings={standings} />
    </div>
  );
}
