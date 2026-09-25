import { getNextSnapshotTimestamp } from "@/lib/projected-snapshot-tvl";

/**
 * Everything the header's campaign strip needs: which week the campaign is on
 * and when the next weekly snapshot lands.
 *
 * This replaces the deposit-prediction context the strip used to read from.
 * That context carried fourteen fields — pool sizes, cohort USD-hours, TVL per
 * week, calibration — and derived them from the whole leaderboard, all so two
 * numbers could reach the header. Both are pure calendar arithmetic and need
 * no campaign data at all.
 */
/** Week 1 ran from the 1 Jun 2026 launch to this first Saturday snapshot;
 *  every week after it is a flat 7 days. The launch date itself is not needed
 *  to place a week — anything before this boundary is week 1. */
const CAMPAIGN_WEEK1_SNAPSHOT_MS = Date.parse("2026-06-06T12:00:00.000Z");

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface CampaignClock {
  /** 1-based campaign week. */
  week: number;
  /** Next weekly snapshot, Saturday 12:00 UTC. */
  nextSnapshotTimestamp: number;
}

export function getCurrentCampaignWeek(nowMs: number = Date.now()): number {
  if (nowMs < CAMPAIGN_WEEK1_SNAPSHOT_MS) return 1;
  return 2 + Math.floor((nowMs - CAMPAIGN_WEEK1_SNAPSHOT_MS) / MS_PER_WEEK);
}

export function buildCampaignClock(nowMs: number = Date.now()): CampaignClock {
  return {
    week: getCurrentCampaignWeek(nowMs),
    nextSnapshotTimestamp: getNextSnapshotTimestamp(nowMs),
  };
}
