/**
 * Append the exchange's running fee totals to data/fee-history.json.
 * Hourly cron on the hour, so one reading lands on every Saturday 13:00 UTC,
 * when a Challenger Series week opens: the baseline the week's net revenue
 * (and its 12.5% prize pool) is counted from. BULK has no fee history API.
 *
 *   npm run record:fees
 */
import { fetchFeeTotals } from "../lib/bulk-exchange";
import { appendFeeHistoryPoint } from "../lib/fee-history";

async function main() {
  // Bypass the 10s fetch cache: this reading is a baseline, not a display.
  const totals = await fetchFeeTotals(0);
  if (!totals) throw new Error("exchange /feeState unavailable");

  const file = appendFeeHistoryPoint(totals);
  console.log(
    `[fees] points=${file.points.length} at=${new Date(totals.at).toISOString()} ` +
      `net=${totals.netRevenueUsd.toFixed(2)} fills=${totals.settledFills}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
