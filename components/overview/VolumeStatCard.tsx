"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveExchange, useLiveTps } from "@/components/live/LiveExchangeProvider";
import { holdBoot } from "@/lib/boot-gate";
import { KpiTerminalCounter } from "@/components/cards/KpiTerminalCounter";
import { StatSparkCard, seriesRange } from "@/components/overview/StatSparkCard";
import {
  formatSignedDelta,
  formatUtcDay,
  formatUtcTime,
  usdBoard,
} from "@/components/overview/spark-format";
import type { VolumeHistoryPayload } from "@/lib/volume-history";
import { loadVolume } from "@/lib/volume-history-client";
import { cn } from "@/lib/utils";

const MS_DAY = 86_400_000;
const MS_HOUR = 3_600_000;
const MODES = [
  { id: "24h", label: "24H Volume" },
  { id: "total", label: "Total Volume" },
] as const;
type VolumeMode = (typeof MODES)[number]["id"];

function sumWindow(buckets: { t: number; total: number }[], from: number, to: number): number {
  let sum = 0;
  for (const b of buckets) {
    if (b.t >= from && b.t < to) sum += b.total;
  }
  return sum;
}

/** Trailing 24h notional as of the end of the hour at `end`. */
function rolling24hAt(buckets: { t: number; total: number }[], end: number): number {
  return sumWindow(buckets, end - MS_DAY + MS_HOUR, end + MS_HOUR);
}

function rolling24hSeries(
  buckets: { t: number; total: number }[],
  live24h: number,
): { t: number; value: number }[] {
  if (!buckets.length) {
    return live24h > 0 ? [{ t: Date.now(), value: live24h }] : [];
  }

  const earliest = buckets[0].t;
  const lastT = buckets[buckets.length - 1].t;
  const rows = buckets
    .filter((b) => b.t > lastT - MS_DAY && b.t - earliest >= MS_DAY - MS_HOUR)
    .map((b) => ({ t: b.t, value: rolling24hAt(buckets, b.t) }))
    .filter((row) => row.value > 0);

  if (live24h > 0) {
    const last = rows.at(-1);
    if (!last || Date.now() - last.t > 5 * 60_000) {
      rows.push({ t: Date.now(), value: live24h });
    } else {
      last.value = live24h;
    }
  }
  return rows;
}


/** One decimal below ten, none above — 108 reads as throughput, 8.4 does not. */
function formatTps(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  return value >= 10 ? Math.round(value).toLocaleString("en-US") : value.toFixed(1);
}

export function VolumeStatCard() {
  const exchange = useLiveExchange();
  const [mode, setMode] = useState<VolumeMode>("24h");
  const [day, setDay] = useState<VolumeHistoryPayload | null>(null);
  const [all, setAll] = useState<VolumeHistoryPayload | null>(null);
  const [allFailed, setAllFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 1D is the fallback for when the hourly ALL series fails; the spark
    // waits for ALL rather than drawing each partial series in turn, which
    // morphed the line as they landed. Shared with the Total Volume chart,
    // which asks for 1D too. Each holds the boot splash, so the spark is
    // drawn when the page opens.
    const load = (query: string, set: (p: VolumeHistoryPayload) => void, onFail?: () => void) =>
      holdBoot(
        loadVolume(query)
          .then((payload) => {
            if (!cancelled) set(payload);
          })
          .catch(() => {
            if (!cancelled) onFail?.();
          }),
      );
    void load("range=1D", setDay);
    void load("range=ALL&interval=1h", setAll, () => setAllFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const now = Date.now();
  const series = useMemo(() => {
    if (!all?.buckets.length && !allFailed) return [];
    if (mode === "total") {
      const buckets = (all?.buckets.length ? all.buckets : day?.buckets) ?? [];
      const rows = buckets.map((b) => ({ value: b.cumulative, t: b.t }));
      const last = rows.at(-1);
      if (last && exchange.volumeTotalUsd > last.value) {
        rows.push({ value: exchange.volumeTotalUsd, t: Date.now() });
      }
      return rows;
    }
    const hourly = all?.buckets.length ? all.buckets : (day?.buckets ?? []);
    return rolling24hSeries(hourly, exchange.volume24hUsd);
  }, [mode, all, allFailed, day, exchange.volumeTotalUsd, exchange.volume24hUsd]);

  const totalUsd =
    exchange.volumeTotalUsd ||
    (all?.buckets.length ? all.buckets[all.buckets.length - 1].cumulative : 0);
  const value = mode === "24h" ? exchange.volume24hUsd : totalUsd;
  // Yesterday's window needs 48 hourly buckets, which only ALL has.
  const prev24h = all?.buckets.length
    ? sumWindow(all.buckets, now - 2 * MS_DAY, now - MS_DAY)
    : 0;
  const delta = mode === "24h" ? exchange.volume24hUsd - prev24h : exchange.volume24hUsd;
  // Without yesterday's window the 24h delta would print today's whole figure
  // as growth (+$15.5M), and without today's it printed -$18.4M.
  const deltaReady = value > 0 && (mode === "total" || prev24h > 0);
  const range = seriesRange(series);
  const tps = useLiveTps();

  return (
    <StatSparkCard
      label={
        <div className="flex h-4 items-center gap-[7px]" role="group" aria-label="Volume range">
          {MODES.map((m, i) => {
            const on = m.id === mode;
            return (
              <span key={m.id} className="contents">
                {i > 0 && (
                  <span className="text-text-dim" aria-hidden>
                    |
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={on}
                  className={cn(
                    "font-label m-0 h-4 border-0 bg-transparent p-0 leading-none transition-colors",
                    on ? "volume-mode-on" : "volume-mode-off text-text-muted hover:text-text-secondary",
                  )}
                >
                  {m.label}
                </button>
              </span>
            );
          })}
        </div>
      }
      badge={mode === "total" ? "ALL" : "24H"}
      figure={value > 0 ? <KpiTerminalCounter value={value} format="usd-board" /> : "—"}
      delta={deltaReady ? formatSignedDelta(delta, usdBoard) : "—"}
      deltaUp={deltaReady ? delta >= 0 : undefined}
      series={series}
      formatValue={usdBoard}
      formatTime={mode === "24h" ? formatUtcTime : formatUtcDay}

      stats={[
        { label: "Low", value: range ? usdBoard(range.low) : "—" },
        { label: "High", value: range ? usdBoard(range.high) : "—" },
        {
          // Submissions per second — orders, cancels and modifies. Not trades:
          // at the ~109/s measured here, a day of fills would be 9.4M against
          // $36M of volume, which would put the average trade at four dollars.
          label: "TPS",
          value: formatTps(tps),
        },
      ]}
    />
  );
}
