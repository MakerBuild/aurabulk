"use client";

import { useMemo, useState } from "react";
import type { WalletData } from "@/types";
import {
  AuraDonut,
  AURA_SOURCES_DONUT_WELL,
  donutApexInset,
} from "@/components/overview/AuraDonut";
import { PanelLabel } from "@/components/overview/PanelCard";
import { Select } from "@/components/ui/Select";
import { aggregateBySource, filterCategoryBreakdown } from "@/lib/aura-category-groups";
import { extractCampaignWeek } from "@/lib/wallet-aura-breakdown";
import {
  chartPrimaryRamp,
  type OverviewDonutSegment,
} from "@/lib/overview-metrics";
import { auraTierName, categoryLabel, cn, formatNumber, formatUsd } from "@/lib/utils";
import { useNarrowViewport } from "@/lib/use-narrow-viewport";

function weekBreakdown(categories: Record<string, number> | undefined) {
  const byWeek = new Map<number, number>();
  for (const [key, raw] of Object.entries(categories ?? {})) {
    const points = Number(raw) || 0;
    if (points <= 0) continue;
    const week = extractCampaignWeek(key);
    if (week == null) continue;
    byWeek.set(week, (byWeek.get(week) ?? 0) + points);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, points]) => ({ week, points }));
}

/**
 * Same Source Breakdown shell as the global view — AuraDonut + legend —
 * fed with this wallet's sources and a week filter instead of Overview groups.
 */
export function PersonalSourcesPanel({ data }: { data: WalletData }) {
  const [selectedWeek, setSelectedWeek] = useState<"all" | number>("all");
  const narrow = useNarrowViewport();
  const weeks = useMemo(() => weekBreakdown(data.categories), [data.categories]);

  const sources = useMemo(() => {
    const items = Object.entries(data.categories ?? {})
      .filter(([key, raw]) => {
        const points = Number(raw) || 0;
        if (points <= 0) return false;
        if (selectedWeek === "all") return true;
        return extractCampaignWeek(key) === selectedWeek;
      })
      .map(([key, points]) => ({
        key,
        category: categoryLabel(key),
        points: Number(points) || 0,
        share: 0,
      }));

    // "All weeks" rolls up by source type (Mainnet / Pre-Deposits / …). Picking
    // one week drills into that week's own categories instead, exactly as the
    // global breakdown does — mainnet trading merged, prefixes stripped.
    const rows =
      selectedWeek === "all"
        ? aggregateBySource(items)
        : filterCategoryBreakdown(items, `week-${selectedWeek}`);

    return rows.filter((row) => row.points > 0).sort((a, b) => b.points - a.points);
  }, [data.categories, selectedWeek]);

  const totalAura = useMemo(
    () => sources.reduce((sum, row) => sum + row.points, 0),
    [sources]
  );

  const segments = useMemo<OverviewDonutSegment[]>(
    () =>
      sources.map((row, i) => ({
        id: row.key,
        label: row.category,
        color: chartPrimaryRamp(i, sources.length),
        pct: totalAura > 0 ? (row.points / totalAura) * 100 : 0,
        points: row.points,
      })),
    [sources, totalAura]
  );

  const weekOptions = useMemo(
    () => [
      { value: "all", label: "All weeks" },
      ...weeks.map((row) => ({
        value: String(row.week),
        label: `Week ${row.week}`,
      })),
    ],
    [weeks]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex min-h-8 shrink-0 items-center justify-between gap-3">
        <PanelLabel>Source Breakdown</PanelLabel>
        {weekOptions.length > 1 && (
          <Select
            value={selectedWeek === "all" ? "all" : String(selectedWeek)}
            onChange={(value) =>
              setSelectedWeek(value === "all" ? "all" : Number(value))
            }
            options={weekOptions}
            className="w-[9.5rem] shrink-0"
            compact
          />
        )}
      </div>
      {segments.length === 0 ? (
        <p className="font-data text-[13px] text-text-muted">
          {selectedWeek === "all"
            ? "No source breakdown."
            : `No Aura recorded for week ${selectedWeek}.`}
        </p>
      ) : (
        <div
          className="flex min-h-0 flex-1 items-start"
          style={narrow ? undefined : { minHeight: AURA_SOURCES_DONUT_WELL }}
        >
          <div className="flex h-full min-h-0 w-full min-w-0">
            <AuraDonut
              key={selectedWeek === "all" ? "all" : `w${selectedWeek}`}
              segments={segments}
              totalAuraNumber={totalAura}
              showShare={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** PnL keeps its sign — "-$133" and "$133" are opposite outcomes, and a bare
 *  figure would read as a gain either way. */
function formatSignedUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value === 0) return formatUsd(0);
  return value < 0 ? `-${formatUsd(Math.abs(value))}` : `+${formatUsd(value)}`;
}

export function AuraStatsPanel({ data }: { data: WalletData }) {
  const narrow = useNarrowViewport();
  const exchange = data.exchange;
  const tier = auraTierName(data.aura);

  const stats: { label: string; value: string; accent?: boolean }[] = [
    { label: "Total Aura", value: formatNumber(data.aura), accent: true },
    { label: "Aura rank", value: `#${data.aura_rank.toLocaleString("en-US")}` },
    { label: "Peak PnL", value: formatSignedUsd(exchange?.peakPnlUsd) },
    { label: "Current PnL", value: formatSignedUsd(exchange?.pnlUsd) },
    {
      // Upstream reports volume over a rolling window, not for all time.
      label: `Volume (${exchange?.windowDays ?? 14}d)`,
      value: exchange && exchange.volumeUsd > 0 ? formatUsd(exchange.volumeUsd) : "—",
    },
    {
      label: "Volume rank",
      value: exchange?.volumeRank ? `#${exchange.volumeRank.toLocaleString("en-US")}` : "—",
    },
    { label: "Aura tier", value: tier ?? "—" },
    {
      label: "Fees paid",
      value: typeof exchange?.feesUsd === "number" ? formatUsd(exchange.feesUsd) : "—",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex min-h-8 shrink-0 items-center">
        <PanelLabel>Aura Stats</PanelLabel>
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-2 content-start gap-x-6 gap-y-5"
        style={
          narrow
            ? undefined
            : {
                // Same inset as the donut legend, so Total Aura / Aura Rank
                // sit on CATEGORY / AURA and the ring apex.
                paddingTop: donutApexInset(AURA_SOURCES_DONUT_WELL),
              }
        }
      >
        {stats.map((stat) => (
          <div key={stat.label}>
            <p className="font-label m-0 text-text-muted">{stat.label}</p>
            <p
              className={cn(
                "mt-1 font-data text-[15px] font-medium tabular-nums",
                stat.accent ? "text-accent" : "text-text-primary"
              )}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
