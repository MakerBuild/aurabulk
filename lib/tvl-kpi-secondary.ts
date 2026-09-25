import type { Snapshot } from "@/types";
import {
  getNextSnapshotTimestamp,
  getPreviousSnapshotTimestamp,
} from "@/lib/projected-snapshot-tvl";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
// Snapshots are daily but land a few hours late, so each lookback accepts a
// window around its target — never one so wide that a snapshot taken minutes
// ago passes for a day-old one.
const LOOKBACK_24H_TOLERANCE_MS = 12 * MS_PER_HOUR;
const MIN_24H_AGE_MS = 18 * MS_PER_HOUR;
const LOOKBACK_7D_TOLERANCE_MS = 36 * MS_PER_HOUR;
const MIN_7D_AGE_MS = 6 * MS_PER_DAY;
/** Shortest span a daily-deposit average is taken over; less is mostly noise. */
const MIN_AVG_WINDOW_MS = 6 * MS_PER_HOUR;

export interface TvlKpiSecondaryMetrics {
  netFlow24h: number | null;
  growth7dPct: number | null;
  deposits24h: number | null;
  avgDailyDeposits: number | null;
  withdrawals24h: number | null;
  withdrawalRatePct: number | null;
}

function sortedSnapshots(snapshots: Snapshot[]): Snapshot[] {
  return [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/** Closest snapshot to `targetMs` within `maxDeltaMs` that is at least
 *  `minAgeMs` older than `nowMs`. */
function nearestSnapshot(
  snapshots: Snapshot[],
  targetMs: number,
  maxDeltaMs: number,
  nowMs: number,
  minAgeMs: number
): Snapshot | null {
  let best: Snapshot | null = null;
  let bestDelta = Infinity;

  for (const point of snapshots) {
    const ts = new Date(point.timestamp).getTime();
    if (!(nowMs - ts >= minAgeMs)) continue;
    const delta = Math.abs(ts - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = point;
    }
  }

  return best && bestDelta <= maxDeltaMs ? best : null;
}

/** First snapshot at or on/after `targetMs` (no skew — used for weekly snapshot anchors). */
function snapshotAtOrAfter(snapshots: Snapshot[], targetMs: number): Snapshot | null {
  for (const point of sortedSnapshots(snapshots)) {
    if (new Date(point.timestamp).getTime() >= targetMs) {
      return point;
    }
  }
  return null;
}

/**
 * When older snapshots lack cumulative deposit/withdraw fields, estimate from TVL
 * using the current withdrawal rate (TVL ≈ deposited − withdrawn).
 */
function resolveCumulativeAmounts(
  snapshot: Snapshot,
  liveDeposited: number,
  liveWithdrawn: number
): { deposited: number; withdrawn: number } {
  if (snapshot.totalDeposited != null && snapshot.totalWithdrawn != null) {
    return {
      deposited: snapshot.totalDeposited,
      withdrawn: snapshot.totalWithdrawn,
    };
  }

  if (liveDeposited <= 0 || snapshot.tvl <= 0) {
    return { deposited: 0, withdrawn: 0 };
  }

  const withdrawalRate = Math.min(Math.max(liveWithdrawn / liveDeposited, 0), 0.99);
  const deposited = snapshot.tvl / (1 - withdrawalRate);
  return { deposited, withdrawn: deposited * withdrawalRate };
}

export function computeTvlKpiSecondaryMetrics(
  snapshots: Snapshot[],
  currentTvl: number,
  totalDeposited: number,
  totalWithdrawn: number,
  nowMs: number = Date.now()
): TvlKpiSecondaryMetrics {
  const target24hMs = nowMs - MS_PER_DAY;
  const target7dMs = nowMs - 7 * MS_PER_DAY;

  const snapshot24h = nearestSnapshot(
    snapshots,
    target24hMs,
    LOOKBACK_24H_TOLERANCE_MS,
    nowMs,
    MIN_24H_AGE_MS
  );
  const snapshot7d = nearestSnapshot(
    snapshots,
    target7dMs,
    LOOKBACK_7D_TOLERANCE_MS,
    nowMs,
    MIN_7D_AGE_MS
  );

  const tvl24h = snapshot24h?.tvl ?? null;
  const netFlow24h = tvl24h != null ? currentTvl - tvl24h : null;

  const tvl7d = snapshot7d?.tvl ?? null;
  const growth7dPct =
    tvl7d != null && tvl7d > 0 ? ((currentTvl - tvl7d) / tvl7d) * 100 : null;

  const amounts24h = snapshot24h
    ? resolveCumulativeAmounts(snapshot24h, totalDeposited, totalWithdrawn)
    : null;
  const deposits24h =
    amounts24h != null ? Math.max(0, totalDeposited - amounts24h.deposited) : null;
  const withdrawals24h =
    amounts24h != null ? Math.max(0, totalWithdrawn - amounts24h.withdrawn) : null;

  const previousSnapshotMs = getPreviousSnapshotTimestamp(getNextSnapshotTimestamp(nowMs));
  const depositedAtPrevious = snapshotAtOrAfter(snapshots, previousSnapshotMs);
  // Measured from the snapshot the deposits are counted from, not from the
  // weekly boundary it follows by some hours.
  const elapsedDays = depositedAtPrevious
    ? (nowMs - new Date(depositedAtPrevious.timestamp).getTime()) / MS_PER_DAY
    : 0;
  const previousAmounts = depositedAtPrevious
    ? resolveCumulativeAmounts(depositedAtPrevious, totalDeposited, totalWithdrawn)
    : null;
  const avgDailyDeposits =
    previousAmounts != null && elapsedDays * MS_PER_DAY >= MIN_AVG_WINDOW_MS
      ? Math.max(0, (totalDeposited - previousAmounts.deposited) / elapsedDays)
      : null;

  const withdrawalRatePct =
    totalDeposited > 0 ? (totalWithdrawn / totalDeposited) * 100 : null;

  return {
    netFlow24h,
    growth7dPct,
    deposits24h,
    avgDailyDeposits,
    withdrawals24h,
    withdrawalRatePct,
  };
}
