"use client";

import { useLiveExchange } from "@/components/live/LiveExchangeProvider";
import { KpiTerminalCounter } from "@/components/cards/KpiTerminalCounter";
import { StatSparkCard, seriesRange } from "@/components/overview/StatSparkCard";
import { formatSignedDelta, formatUtcTime } from "@/components/overview/spark-format";
import { useLevelSpark } from "@/lib/session-spark";

function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function TradersStatCard() {
  const exchange = useLiveExchange();
  const series = useLevelSpark(
    "bulk-spark-traders",
    exchange.activeTraders,
    exchange.tradersHistory,
  );
  const first = series[0]?.value;
  const delta = first != null ? exchange.activeTraders - first : 0;
  const hasDelta = series.length > 1 && delta !== 0;
  const range = seriesRange(series);

  return (
    <StatSparkCard
      label="Active Traders"
      figure={<KpiTerminalCounter value={exchange.activeTraders} format="plain" />}
      delta={
        hasDelta
          ? formatSignedDelta(delta, (n) => n.toLocaleString("en-US"))
          : `${exchange.totalAccounts.toLocaleString("en-US")} accounts`
      }
      deltaUp={hasDelta ? delta >= 0 : undefined}
      series={series}
      formatValue={formatCount}
      formatTime={formatUtcTime}

      stats={[
        { label: "Low", value: range ? formatCount(range.low) : "—" },
        { label: "High", value: range ? formatCount(range.high) : "—" },
        {
          label: "Accounts",
          value:
            exchange.totalAccounts > 0 ? formatCount(exchange.totalAccounts) : "—",
        },
      ]}
    />
  );
}
