"use client";

import { useLiveExchange } from "@/components/live/LiveExchangeProvider";
import { KpiTerminalCounter } from "@/components/cards/KpiTerminalCounter";
import { StatSparkCard, seriesRange } from "@/components/overview/StatSparkCard";
import { formatSignedDelta, formatUtcTime, usdBoard } from "@/components/overview/spark-format";
import { useLevelSpark } from "@/lib/session-spark";

export function OiStatCard() {
  const exchange = useLiveExchange();
  const series = useLevelSpark("bulk-spark-oi", exchange.openInterestUsd, exchange.oiHistory);
  const first = series[0]?.value;
  const delta = first != null ? exchange.openInterestUsd - first : 0;
  const hasDelta = series.length > 1 && delta !== 0;
  const range = seriesRange(series);

  return (
    <StatSparkCard
      label="Open Interest"
      figure={<KpiTerminalCounter value={exchange.openInterestUsd} format="usd-board" />}
      delta={hasDelta ? formatSignedDelta(delta, usdBoard) : "live"}
      deltaUp={hasDelta ? delta >= 0 : undefined}
      series={series}
      formatValue={usdBoard}
      formatTime={formatUtcTime}

      stats={[
        { label: "Low", value: range ? usdBoard(range.low) : "—" },
        { label: "High", value: range ? usdBoard(range.high) : "—" },
        { label: "Long/Short", value: "—" },
      ]}
    />
  );
}
