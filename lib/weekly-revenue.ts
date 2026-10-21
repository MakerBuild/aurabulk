import { fetchFeeTotals } from "@/lib/bulk-exchange";
import { netRevenueAt, readFeeHistoryFile } from "@/lib/fee-history";
import { getNextSnapshotTimestamp } from "@/lib/projected-snapshot-tvl";
import { buildCampaignWeekHourly, sumCandleVolumes } from "@/lib/volume-history";

const WEEK_MS = 7 * 86_400_000;
/** A reading this recent says little about the pace: it may span a lull. */
const MIN_PACE_SPAN_MS = 20 * 60_000;

export interface WeeklyRevenuePayload {
  /** The Saturday 12:00 UTC snapshot this week runs from, ms. */
  weekStart: number;
  /** When the exchange read the totals below, ms. */
  at: number;
  /** BULK's net revenue since `weekStart`: taker fees less maker rebates. */
  netRevenueUsd: number;
  /** How fast it has been growing lately, for the count between fetches. */
  usdPerMs: number;
  /**
   * `recorded`: the exchange's running total less our own reading at the
   * snapshot. `estimated`: there is no such reading (the week began before
   * recording did), so this week's volume at the lifetime net fee rate.
   */
  source: "recorded" | "estimated";
  /** The week's traded volume hour by hour (each fill has one taker, so this
   *  is taker volume too). The charts split the net revenue along it. */
  hours: { t: number; volumeUsd: number }[];
}

export async function buildWeeklyRevenue(): Promise<WeeklyRevenuePayload> {
  const totals = await fetchFeeTotals();
  if (!totals) throw new Error("exchange /feeState unavailable");

  const weekStart = getNextSnapshotTimestamp(totals.at) - WEEK_MS;
  const points = readFeeHistoryFile().points;
  const baseline = netRevenueAt(points, weekStart);

  const hourly = (await buildCampaignWeekHourly()).filter((b) => b.t >= weekStart);
  const hours = hourly.map((b) => ({ t: b.t, volumeUsd: b.total }));

  let netRevenueUsd: number;
  let source: WeeklyRevenuePayload["source"];
  if (baseline != null) {
    netRevenueUsd = Math.max(0, totals.netRevenueUsd - baseline);
    source = "recorded";
  } else {
    const lifetime = await sumCandleVolumes();
    const weekVolumeUsd = hours.reduce((sum, h) => sum + h.volumeUsd, 0);
    const lifetimeRate =
      lifetime.volumeTotalUsd > 0 ? totals.netRevenueUsd / lifetime.volumeTotalUsd : 0;
    netRevenueUsd = weekVolumeUsd * lifetimeRate;
    source = "estimated";
  }

  // Pace from our latest reading this week when there is one far enough
  // back, else the week's average so far.
  const recent = points.findLast(
    (p) => p.at >= weekStart && totals.at - p.at >= MIN_PACE_SPAN_MS,
  );
  const usdPerMs = recent
    ? Math.max(0, totals.netRevenueUsd - recent.netRevenueUsd) / (totals.at - recent.at)
    : netRevenueUsd / Math.max(1, totals.at - weekStart);

  return { weekStart, at: totals.at, netRevenueUsd, usdPerMs, source, hours };
}
