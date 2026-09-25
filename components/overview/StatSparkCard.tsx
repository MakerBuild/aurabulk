"use client";

import { PanelCard, PanelLabel } from "@/components/overview/PanelCard";
import { MiniSpark, type SparkRow } from "@/components/overview/MiniSpark";
import { cn } from "@/lib/utils";

export function seriesRange(rows: SparkRow[]): { low: number; high: number } | null {
  if (!rows.length) return null;
  let low = rows[0].value;
  let high = rows[0].value;
  for (const row of rows) {
    if (row.value < low) low = row.value;
    if (row.value > high) high = row.value;
  }
  return { low, high };
}

export type SparkFootStat = { label: string; value: string };

export function StatSparkCard({
  label,
  badge = "24H",
  figure,
  delta,
  deltaUp,
  series,
  formatValue,
  formatTime,
  stats,
}: {
  label: React.ReactNode;
  badge?: string;
  figure: React.ReactNode;
  delta: React.ReactNode;
  deltaUp?: boolean;
  series: SparkRow[];
  formatValue: (n: number) => string;
  formatTime: (t: number) => string;
  stats: SparkFootStat[];
}) {
  return (
    <PanelCard className="h-full px-4 py-3 sm:px-4 sm:py-3">
      <div className="mb-2.5 flex h-4 items-center justify-between gap-3 leading-none">
        <div className="min-w-0">
          {typeof label === "string" ? <PanelLabel>{label}</PanelLabel> : label}
        </div>
        <span className="font-label shrink-0 text-[var(--t-accent)]">{badge}</span>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-3">
        <div className="flex min-h-0 min-w-0 shrink-0 flex-col">
          <p className="font-figure m-0 pb-0.5 whitespace-nowrap text-[26px] font-semibold leading-none tracking-[-0.02em] sm:text-[28px] xl:text-[30px]">
            {figure}
          </p>
          <p className="m-0 flex flex-1 items-center font-data text-[12px] leading-none">
            <span
              className={cn(
                "translate-y-px",
                deltaUp == null && "text-text-muted",
                deltaUp === true && "text-[var(--color-bid-green)]",
                deltaUp === false && "text-[var(--color-neg-strong)]",
              )}
            >
              {delta}
            </span>
          </p>
        </div>
        <MiniSpark rows={series} formatValue={formatValue} formatTime={formatTime} />
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-line)] pt-2">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <p className="font-label m-0 text-text-dim">{stat.label}</p>
            <p className="font-data m-0 mt-1 truncate text-[11px] leading-none text-text-secondary tabular-nums">
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </PanelCard>
  );
}

