/**
 * Precompute the Overview / Aura dashboard figures into
 * data/dashboard-metrics.json so the running app never does it.
 *
 * The computation reads and parses the 34MB leaderboard and then makes
 * twenty passes and eight sorts over 56k entries — about 450ms of CPU. Its
 * inputs change once a week (aura refresh) and once a day (totals), so this
 * belongs next to those refreshes rather than in the request path.
 *
 *   npm run build:metrics
 */
import { computeDashboardMetricsUncached } from "../lib/stats";
import { getLeaderboardMtimeMs } from "../lib/fetcher";
import { writeDashboardMetricsFile } from "../lib/dashboard-metrics-store";

async function main() {
  const startedAt = Date.now();
  const metrics = await computeDashboardMetricsUncached();

  // Guard against writing a file built from an empty or unreadable
  // leaderboard — that would quietly blank the dashboard on the next deploy.
  if (!(metrics.depositSizeDistribution?.length > 0) || !(metrics.categoryBreakdown?.length > 0)) {
    throw new Error(
      "refusing to write: computed metrics are empty " +
        `(buckets=${metrics.depositSizeDistribution?.length ?? 0} ` +
        `categories=${metrics.categoryBreakdown?.length ?? 0})`,
    );
  }

  const written = writeDashboardMetricsFile(metrics, getLeaderboardMtimeMs());
  const bytes = Buffer.byteLength(JSON.stringify(written));

  console.log(
    `[metrics] computed in ${Date.now() - startedAt}ms · ` +
      `${(bytes / 1024).toFixed(0)}KB · ` +
      `buckets=${metrics.depositSizeDistribution.length} ` +
      `categories=${metrics.categoryBreakdown.length}`,
  );
}

main().catch((error) => {
  console.error("[metrics] failed:", error);
  process.exit(1);
});
