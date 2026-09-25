/**
 * Snapshot live open interest + active traders into data/exchange-levels.json.
 * Hourly cron builds the 24h KPI sparks — Bulk has no OI/traders history API.
 *
 *   npm run record:levels
 */
import { fetchExchangeMetrics, fetchExchangeStats } from "../lib/bulk-exchange";
import { mergeLevelPoints } from "../lib/exchange-level-history";
import {
  readExchangeLevelsFile,
  writeExchangeLevelsFile,
} from "../lib/exchange-level-store";

async function main() {
  const [stats, metrics] = await Promise.all([fetchExchangeStats(), fetchExchangeMetrics(true)]);
  if (!stats || !metrics) {
    throw new Error(`exchange unavailable stats=${!!stats} metrics=${!!metrics}`);
  }

  const now = Date.now();
  // One side, priced at mark — as the exchange itself displays it.
  const openInterestUsd = Number(stats.openInterest?.totalUsd) || 0;
  // Accounts with a position or an open order — see lib/live-exchange-payload.
  const activeTraders = Number(metrics.executor_cardinality?.primary?.cached_accounts) || 0;
  if (!(openInterestUsd > 0) || !(activeTraders > 0)) {
    throw new Error(`bad snapshot oi=${openInterestUsd} traders=${activeTraders}`);
  }

  const prev = readExchangeLevelsFile();
  const next = writeExchangeLevelsFile({
    oi: mergeLevelPoints(prev.oi, [{ t: now, value: openInterestUsd }]),
    traders: mergeLevelPoints(prev.traders, [{ t: now, value: activeTraders }]),
  });

  console.log(
    `[levels] oi=${next.oi.length} traders=${next.traders.length} ` +
      `lastOi=${openInterestUsd.toFixed(0)} lastTraders=${activeTraders}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
