import fs from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/atomic-write";
import type { FeeTotals } from "@/lib/bulk-exchange";

/**
 * Hourly readings of the exchange's running fee totals, recorded by
 * scripts/record-fee-history.ts. `/feeState` only reports totals since
 * launch, so a week's net revenue is the latest total less the one read at
 * the Saturday 13:00 UTC the week opened at, and that reading has to be ours.
 */
export interface FeeHistoryFile {
  updatedAt: string;
  points: FeeTotals[];
}

const FILE = path.join(process.cwd(), "data", "fee-history.json");

export function readFeeHistoryFile(): FeeHistoryFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8")) as Partial<FeeHistoryFile>;
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      points: Array.isArray(parsed.points) ? parsed.points : [],
    };
  } catch {
    return { updatedAt: new Date(0).toISOString(), points: [] };
  }
}

export function appendFeeHistoryPoint(point: FeeTotals): FeeHistoryFile {
  const points = [...readFeeHistoryFile().points.filter((p) => p.at !== point.at), point].sort(
    (a, b) => a.at - b.at,
  );
  const file = { updatedAt: new Date().toISOString(), points };
  writeFileAtomic(FILE, `${JSON.stringify(file, null, 2)}\n`);
  return file;
}

/** How far a reading may sit from the snapshot and still stand in for it. */
const EXACT_WINDOW_MS = 15 * 60_000;
/** The widest gap between two readings we will draw a line across. */
const MAX_BRIDGE_MS = 3 * 3_600_000;

/**
 * Net revenue at `t` from our own readings: the reading taken then when
 * there is one (the recorder runs on the hour, so Saturday 13:00 is one),
 * else a straight line between the readings either side of
 * it. Null when we have neither, as for a week that began before recording.
 */
export function netRevenueAt(points: FeeTotals[], t: number): number | null {
  let before: FeeTotals | undefined;
  let after: FeeTotals | undefined;
  for (const point of points) {
    if (Math.abs(point.at - t) <= EXACT_WINDOW_MS) return point.netRevenueUsd;
    if (point.at < t) before = point;
    else if (!after) after = point;
  }
  if (!before || !after || after.at - before.at > MAX_BRIDGE_MS) return null;
  const share = (t - before.at) / (after.at - before.at);
  return before.netRevenueUsd + (after.netRevenueUsd - before.netRevenueUsd) * share;
}
