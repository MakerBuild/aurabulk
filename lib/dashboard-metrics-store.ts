import fs from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/atomic-write";
import type { DashboardMetrics } from "@/types";

const METRICS_FILE = path.join(process.cwd(), "data", "dashboard-metrics.json");

/**
 * The dashboard figures are precomputed in CI rather than at request time.
 *
 * Computing them costs ~450ms of CPU: reading and parsing the 34MB
 * leaderboard, then twenty passes and eight sorts over 56k entries. Its
 * inputs move once a week (the aura refresh) and once a day (totals), so
 * doing that work in the request path meant paying it thousands of times per
 * actual change — and it was the bulk of the project's Fluid Active CPU.
 *
 * The cron writes this file next to the data it derives from, so the running
 * app only reads a small JSON and never touches the 34MB source.
 */
interface DashboardMetricsFile {
  /** When the cron generated this, for staleness reporting. */
  generatedAt: string;
  /** mtime of leaderboard.json at generation time, so a data refresh that
   *  forgets to regenerate can be spotted rather than silently served. */
  sourceMtimeMs: number;
  metrics: DashboardMetrics;
}

export function readDashboardMetricsFile(): DashboardMetricsFile | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(METRICS_FILE, "utf-8"),
    ) as Partial<DashboardMetricsFile>;
    if (!parsed || typeof parsed !== "object" || !parsed.metrics) return null;
    return {
      generatedAt:
        typeof parsed.generatedAt === "string" ? parsed.generatedAt : new Date(0).toISOString(),
      sourceMtimeMs: Number(parsed.sourceMtimeMs) || 0,
      metrics: parsed.metrics as DashboardMetrics,
    };
  } catch {
    // Absent or malformed — the caller falls back to computing in process.
    return null;
  }
}

export function writeDashboardMetricsFile(
  metrics: DashboardMetrics,
  sourceMtimeMs: number,
): DashboardMetricsFile {
  const payload: DashboardMetricsFile = {
    generatedAt: new Date().toISOString(),
    sourceMtimeMs,
    metrics,
  };
  writeFileAtomic(METRICS_FILE,`${JSON.stringify(payload)}\n`);
  return payload;
}
