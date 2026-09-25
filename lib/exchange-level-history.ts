export type LevelPoint = { t: number; value: number };

/** Same 1h step as the volume 24h spark (klines are hourly). */
const LEVEL_SAMPLE_MS = 3_600_000;
const LEVEL_KEEP_MS = 86_400_000;
const LEVEL_MAX_POINTS = 24;

function bucketLevelTime(t: number): number {
  return Math.floor(t / LEVEL_SAMPLE_MS) * LEVEL_SAMPLE_MS;
}

export function mergeLevelPoints(...lists: LevelPoint[][]): LevelPoint[] {
  const byTime = new Map<number, number>();
  const cutoff = Date.now() - LEVEL_KEEP_MS;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      // Rows arrive from localStorage and from data/exchange-levels.json, so
      // neither field is trusted. A NaN `t` used to slip past `t < cutoff`
      // and become a NaN bucket key, which then poisoned the sort.
      if (!row || !Number.isFinite(row.t) || row.t < cutoff) continue;
      if (!Number.isFinite(row.value) || row.value < 0) continue;
      byTime.set(bucketLevelTime(row.t), row.value);
    }
  }
  const rows = [...byTime.entries()]
    .map(([t, value]) => ({ t, value }))
    .sort((a, b) => a.t - b.t);
  return rows.length > LEVEL_MAX_POINTS ? rows.slice(-LEVEL_MAX_POINTS) : rows;
}
