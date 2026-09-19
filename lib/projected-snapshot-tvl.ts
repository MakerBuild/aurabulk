import type { Snapshot } from "@/types";

const MS_PER_DAY = 86_400_000;
// Weekly Aura drops moved from 13:00 to 12:00 UTC on 2026-09-20.
const SNAPSHOT_HOUR_UTC = 12;
const MAX_TREND_DAYS = 7;
const OUTLIER_MEDIAN_MULTIPLIER = 3;

export interface ProjectedSnapshotTvlResult {
  available: true;
  currentTvl: number;
  projectedTvl: number;
  weightedDailyFlow: number;
  dailyFlowsUsed: number;
  remainingDays: number;
  remainingMs: number;
  nextSnapshotTimestamp: number;
  expectedGrowth: number;
  expectedGrowthPercent: number;
}

export type ProjectedSnapshotTvl = { available: false } | ProjectedSnapshotTvlResult;

/** Next Saturday 12:00 UTC strictly after `now`, or on `now` if exactly at snapshot time. */
export function getNextSnapshotTimestamp(nowMs: number = Date.now()): number {
  const now = new Date(nowMs);
  const saturday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SNAPSHOT_HOUR_UTC, 0, 0, 0)
  );
  const dayOffset = (6 - saturday.getUTCDay() + 7) % 7;
  saturday.setUTCDate(saturday.getUTCDate() + dayOffset);

  if (nowMs >= saturday.getTime()) {
    saturday.setUTCDate(saturday.getUTCDate() + 7);
  }

  return saturday.getTime();
}

export function getPreviousSnapshotTimestamp(nextSnapshotMs: number): number {
  return nextSnapshotMs - 7 * MS_PER_DAY;
}

function utcDateKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${day}`;
}

/** Last snapshot TVL per UTC calendar day, with live TVL for the reference day. */
function buildDailyClosingTvl(
  snapshots: Snapshot[],
  currentTvl: number,
  nowMs: number
): Map<string, number> {
  const byDay = new Map<string, { tvl: number; ts: number }>();

  for (const snap of snapshots) {
    const ts = new Date(snap.timestamp).getTime();
    const key = utcDateKey(ts);
    const existing = byDay.get(key);
    if (!existing || ts >= existing.ts) {
      byDay.set(key, { tvl: snap.tvl, ts });
    }
  }

  const todayKey = utcDateKey(nowMs);
  const todayExisting = byDay.get(todayKey);
  byDay.set(todayKey, {
    tvl: currentTvl,
    ts: Math.max(todayExisting?.ts ?? 0, nowMs),
  });

  return new Map([...byDay.entries()].map(([key, value]) => [key, value.tvl]));
}

function computeDailyNetFlows(closingByDay: Map<string, number>): number[] {
  const sortedDays = [...closingByDay.keys()].sort();
  const flows: number[] = [];

  for (let i = 1; i < sortedDays.length; i += 1) {
    const prev = closingByDay.get(sortedDays[i - 1])!;
    const curr = closingByDay.get(sortedDays[i])!;
    flows.push(curr - prev);
  }

  return flows;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].map(Math.abs).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Cap any flow above 3× median absolute daily flow (outlier guard). */
function capOutlierFlows(flows: number[]): number[] {
  if (flows.length < 2) return flows;

  const med = median(flows);
  if (med <= 0) return flows;

  const cap = OUTLIER_MEDIAN_MULTIPLIER * med;
  return flows.map((flow) => {
    const abs = Math.abs(flow);
    if (abs <= cap) return flow;
    return flow > 0 ? cap : -cap;
  });
}

function computeWeightedDailyFlow(flows: number[]): number | null {
  if (!flows.length) return null;

  const window = flows.slice(-MAX_TREND_DAYS);
  const capped = capOutlierFlows(window);
  const n = capped.length;

  let weightedSum = 0;
  let weightSum = 0;
  for (let i = 0; i < n; i += 1) {
    const weight = i + 1;
    weightedSum += capped[i] * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? weightedSum / weightSum : null;
}

export function computeProjectedSnapshotTvl(
  snapshots: Snapshot[],
  currentTvl: number,
  nowMs: number = Date.now()
): ProjectedSnapshotTvl {
  if (!snapshots.length || currentTvl <= 0) {
    return { available: false };
  }

  const nextSnapshotTimestamp = getNextSnapshotTimestamp(nowMs);
  const remainingMs = nextSnapshotTimestamp - nowMs;

  if (remainingMs <= 0) {
    return { available: false };
  }

  const closingByDay = buildDailyClosingTvl(snapshots, currentTvl, nowMs);
  const allFlows = computeDailyNetFlows(closingByDay);
  const weightedDailyFlow = computeWeightedDailyFlow(allFlows);

  if (weightedDailyFlow == null) {
    return { available: false };
  }

  const remainingDays = remainingMs / MS_PER_DAY;
  const projectedTvl = currentTvl + weightedDailyFlow * remainingDays;
  const expectedGrowth = projectedTvl - currentTvl;
  const expectedGrowthPercent = currentTvl > 0 ? (expectedGrowth / currentTvl) * 100 : 0;
  const dailyFlowsUsed = Math.min(allFlows.length, MAX_TREND_DAYS);

  return {
    available: true,
    currentTvl,
    projectedTvl,
    weightedDailyFlow,
    dailyFlowsUsed,
    remainingDays,
    remainingMs,
    nextSnapshotTimestamp,
    expectedGrowth,
    expectedGrowthPercent,
  };
}
