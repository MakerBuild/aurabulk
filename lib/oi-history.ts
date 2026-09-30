import type { LevelPoint } from "@/lib/exchange-level-history";

/**
 * Long-running open interest history for the Total Volume chart.
 *
 * Bulk has no OI history API, so we keep our own: the hourly levels cron
 * appends one vertex per hour to data/oi-history.json. Everything before our
 * first recording was backfilled once from DefiLlama's daily Bulk OI series
 * (scripts/backfill-oi-history.ts).
 *
 * Hourly vertices are kept for two weeks, enough for the 1D and W charts at
 * full resolution. Older ones fold to the last vertex of each UTC day, which
 * is all the M / Q / Y / ALL charts draw.
 */
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const HOURLY_KEEP_MS = 14 * DAY_MS;

export function mergeOiHistory(now: number, ...lists: LevelPoint[][]): LevelPoint[] {
  const hourlyFrom = now - HOURLY_KEEP_MS;
  const byKey = new Map<number, LevelPoint>();
  const rows = lists
    .flat()
    .filter((row) => row && Number.isFinite(row.t) && row.t > 0 && Number.isFinite(row.value) && row.value > 0)
    .sort((a, b) => a.t - b.t);
  for (const row of rows) {
    const key =
      row.t >= hourlyFrom ? Math.floor(row.t / HOUR_MS) * HOUR_MS : Math.floor(row.t / DAY_MS) * DAY_MS;
    // Later rows win their slot, so a folded day keeps its closing value.
    byKey.set(key, { t: key, value: row.value });
  }
  return [...byKey.values()].sort((a, b) => a.t - b.t);
}

/**
 * OI per chart bucket. A bucket with its own vertex shows the latest one in
 * it; an empty bucket gets the value interpolated at its start between the
 * vertices either side, so every bar in the covered span has a tooltip
 * figure and the line has no holes. Buckets before the first vertex stay
 * null, since there is no OI to show there.
 */
export function oiForBuckets(starts: number[], points: LevelPoint[]): (number | null)[] {
  const out: (number | null)[] = starts.map(() => null);
  if (!starts.length || !points.length) return out;
  const last = starts.length - 1;
  // The newest bucket's span, taken from the step before it. Without an end,
  // today's print lands in yesterday's bar whenever today has no candle yet.
  const end = last > 0 ? starts[last] + (starts[last] - starts[last - 1]) : Infinity;

  let p = 0;
  for (let b = 0; b <= last; b++) {
    const start = starts[b];
    const next = b < last ? starts[b + 1] : end;
    while (p < points.length && points[p].t < start) p++;
    let q = p;
    while (q < points.length && points[q].t < next) q++;
    if (q > p) {
      out[b] = points[q - 1].value;
      continue;
    }
    const before = p > 0 ? points[p - 1] : null;
    const after = p < points.length ? points[p] : null;
    if (!before || !after) continue;
    out[b] = before.value + ((after.value - before.value) * (start - before.t)) / (after.t - before.t);
  }
  return out;
}
