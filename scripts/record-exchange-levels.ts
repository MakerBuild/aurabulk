/**
 * Snapshot live open interest + active traders into data/exchange-levels.json.
 * Hourly cron builds the 24h KPI sparks — Bulk has no OI/traders history API.
 *
 *   npm run record:levels
 */
import { mergeLevelPoints } from "../lib/exchange-level-history";
import {
  readExchangeLevelsFile,
  writeExchangeLevelsFile,
} from "../lib/exchange-level-store";

const EXCHANGE_API_BASE =
  process.env.BULK_EXCHANGE_API_BASE?.replace(/\/$/, "") ||
  "https://mainnet-api1.bulk.trade/api/v1";
/** One side, as the exchange itself displays it — see lib/live-exchange-payload. */
const OI_SIDES = 1;

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${EXCHANGE_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AURA-Intelligence/1.0" },
  });
  if (!res.ok) {
    throw new Error(`${path} ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function main() {
  const [stats, metrics] = await Promise.all([
    fetchJson<{ openInterest?: { totalUsd?: number } }>("/stats?period=1d"),
    fetchJson<{
      executor_cardinality?: { primary?: { cached_accounts?: number } };
    }>("/metrics"),
  ]);

  const now = Date.now();
  const openInterestUsd = (Number(stats.openInterest?.totalUsd) || 0) * OI_SIDES;
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
