"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RectangleProps } from "recharts";
import type { WalletData } from "@/types";
import { MARK_EASE, markFill, pulseBed, pulseMotion } from "@/lib/chart-gold-pulse";
import { cn, formatNumber } from "@/lib/utils";
import { useNarrowViewport } from "@/lib/use-narrow-viewport";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { Select } from "@/components/ui/Select";
import { PanelCard, PanelLabel } from "@/components/overview/PanelCard";
import {
  AURA_SOURCES_DONUT_WELL,
  donutApexInset,
  AuraDonut,
} from "@/components/overview/AuraDonut";
import { CATEGORY_NAME_SVG } from "@/components/overview/MetricTable";
import { useInViewOnce } from "@/components/overview/use-in-view-once";
import { chartPrimaryRamp, CHART_GOLD, type OverviewDonutSegment } from "@/lib/overview-metrics";
import {
  AuraStatsPanel,
  PersonalSourcesPanel,
} from "@/components/lookup/wallet-panels";
import {
  OVERVIEW_GROUP,
  buildCategoryGroupOptions,
  filterCategoryBreakdown,
  type CategoryBreakdownItem,
} from "@/lib/aura-category-groups";

/**
 * One Category Share bar, drawn the same way whatever state it's in, so the
 * fill and the dimming ease across with CSS transitions as the gold hands
 * over. Lit, the fill turns gold and breathes over `bed`. The pulse runs on
 * Framer Motion because Chromium drops CSS opacity animations on SVG.
 */
function CategoryBar({
  geom,
  fill,
  bed,
  lit,
  dimmed,
}: {
  geom: { x: number; y: number; width: number; height: number };
  fill: string;
  bed: string;
  lit: boolean;
  dimmed: boolean;
}) {
  const shape = { ...geom, radius: [0, 2, 2, 0] as [number, number, number, number] };
  return (
    <g style={{ opacity: dimmed ? 0.4 : 1, transition: `opacity ${MARK_EASE}` }}>
      <g style={{ opacity: lit ? 1 : 0, transition: `opacity ${MARK_EASE}` }}>
        <Rectangle {...shape} fill={bed} />
      </g>
      <motion.g {...pulseMotion(lit)}>
        <Rectangle {...shape} fill={fill} style={{ transition: `fill ${MARK_EASE}` }} />
      </motion.g>
    </g>
  );
}

function CategoryYTick({
  x,
  y,
  payload,
  active,
  dimmed,
  onHover,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  active?: boolean;
  dimmed?: boolean;
  onHover?: () => void;
}) {
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fill={
        active
          ? CHART_GOLD
          : dimmed
            ? "var(--color-text-muted)"
            : "var(--color-text-primary)"
      }
      fontFamily={CATEGORY_NAME_SVG.fontFamily}
      fontSize={CATEGORY_NAME_SVG.fontSize}
      fontWeight={CATEGORY_NAME_SVG.fontWeight}
      style={{ transition: "fill 0.2s ease" }}
      onMouseEnter={onHover}
    >
      {payload?.value}
    </text>
  );
}

interface CategoryChartsProps {
  data: CategoryBreakdownItem[];
  /** When set, panels morph into personal sources + Aura Stats. */
  wallet?: WalletData | null;
  /** Stretch to fill leftover page height (Aura analytics first viewport). */
  className?: string;
}

interface CategoryChartRow extends CategoryBreakdownItem {
  groupShare: number;
}

function withGroupShares(data: CategoryBreakdownItem[]): CategoryChartRow[] {
  const totalPoints = data.reduce((sum, item) => sum + item.points, 0);
  return data.map((item) => ({
    ...item,
    groupShare: totalPoints > 0 ? (item.points / totalPoints) * 100 : 0,
  }));
}

function collapseSmallCategories(data: CategoryChartRow[]) {
  const MIN_GROUP_SHARE = 1;

  const prominent = data.filter((item) => item.groupShare >= MIN_GROUP_SHARE || item.key === "others");
  const tiny = data.filter((item) => item.groupShare < MIN_GROUP_SHARE && item.key !== "others");

  if (tiny.length === 0 || prominent.length === 0) {
    return { chartData: [...data], othersCategories: [] };
  }

  return {
    chartData: [
      ...prominent,
      {
        key: "others-small",
        category: "Others",
        points: tiny.reduce((sum, item) => sum + item.points, 0),
        share: tiny.reduce((sum, item) => sum + item.share, 0),
        groupShare: tiny.reduce((sum, item) => sum + item.groupShare, 0),
      },
    ],
    othersCategories: tiny.map((item) => ({
      category: item.category,
      points: item.points,
      share: item.share,
      groupShare: item.groupShare,
    })),
  };
}

export function CategoryCharts({ data, wallet, className }: CategoryChartsProps) {
  const groupOptions = useMemo(() => buildCategoryGroupOptions(data), [data]);
  const [pickedGroup, setSelectedGroup] = useState(OVERVIEW_GROUP);
  const narrow = useNarrowViewport();
  // Falls back to the overview when new data no longer offers the pick.
  const selectedGroup = groupOptions.some((option) => option.value === pickedGroup)
    ? pickedGroup
    : OVERVIEW_GROUP;

  const filtered = useMemo(
    () => filterCategoryBreakdown(data, selectedGroup),
    [data, selectedGroup]
  );

  const isDrillDown = selectedGroup !== OVERVIEW_GROUP;

  const { chartData, othersCategories } = useMemo(() => {
    const withShares = withGroupShares(filtered);
    const collapsed = collapseSmallCategories(withShares);
    return {
      ...collapsed,
      // Largest → smallest, top to bottom, so the bright→dull slate ramp
      // tracks share rank.
      chartData: [...collapsed.chartData].sort((a, b) => b.groupShare - a.groupShare),
    };
  }, [filtered]);

  const colored = useMemo(
    () =>
      chartData.map((row, i) => ({
        ...row,
        // Gold primary + slate ramp — same transfer model as the Overview donut.
        color: chartPrimaryRamp(i, chartData.length),
      })),
    [chartData]
  );

  const segments = useMemo<OverviewDonutSegment[]>(
    () =>
      colored.map((row) => ({
        id: row.key,
        label: row.category,
        color: row.color,
        pct: row.groupShare,
        points: row.points,
      })),
    [colored]
  );

  const totalAuraNumber = useMemo(
    () => colored.reduce((sum, row) => sum + row.points, 0),
    [colored]
  );

  const apexInset = donutApexInset();
  const restAt = (i: number) => colored[i].color;


  const othersInfo =
    othersCategories.length > 0 ? (
      <span className="block">
        <span className="mb-1.5 block font-medium text-text-primary">
          “Others” combines {othersCategories.length} smaller sources:
        </span>
        <span className="block space-y-0.5">
          {othersCategories.map((c) => (
            <span key={c.category} className="flex justify-between gap-3">
              <span>{c.category}</span>
              <span className="font-data text-text-secondary">
                {formatNumber(c.points)} Aura · {c.groupShare.toFixed(1)}%
              </span>
            </span>
          ))}
        </span>
      </span>
    ) : null;

  const { ref, hasEntered } = useInViewOnce<HTMLDivElement>(0.2);
  const [sharedHover, setSharedHover] = useState<number | undefined>(undefined);

  if (wallet) {
    return (
      <div
        className={cn(
          "grid min-h-[292px] items-stretch gap-4 lg:grid-cols-2",
          className
        )}
      >
        <PanelCard
          glossy
          glossDelay={-8}
          className={narrow ? undefined : "h-full min-h-[292px]"}
        >
          <PersonalSourcesPanel data={wallet} />
        </PanelCard>
        <PanelCard
          glossy
          glossDelay={-11}
          className={narrow ? undefined : "h-full min-h-[292px]"}
        >
          <AuraStatsPanel data={wallet} />
        </PanelCard>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn(
        "grid min-h-[292px] items-stretch gap-4 lg:grid-cols-2",
        className
      )}
      onMouseLeave={() => setSharedHover(undefined)}
    >
        <PanelCard
          glossy
          glossDelay={-8}
          className={narrow ? undefined : "h-full min-h-[292px]"}
        >
          <div className="mb-2 flex min-h-8 shrink-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <PanelLabel>Source Breakdown</PanelLabel>
              {othersInfo && <InfoTooltip text={othersInfo} panelClassName="w-72" floating />}
            </div>
            <Select
              value={selectedGroup}
              onChange={setSelectedGroup}
              options={groupOptions}
              className="w-[9.5rem] shrink-0"
              compact
            />
          </div>
          {segments.length > 0 && (
            <div
              className="flex min-h-0 flex-1 items-start"
              style={narrow ? undefined : { minHeight: AURA_SOURCES_DONUT_WELL }}
            >
              <div className="flex h-full min-h-0 w-full min-w-0">
                <AuraDonut
                  key={selectedGroup}
                  segments={segments}
                  totalAuraNumber={totalAuraNumber}
                  showShare={false}
                  hoverIndex={sharedHover}
                  onHoverIndexChange={setSharedHover}
                />
              </div>
            </div>
          )}
        </PanelCard>

        <PanelCard
          glossy
          glossDelay={-11}
          className={narrow ? undefined : "h-full min-h-[292px]"}
        >
          <div className="mb-2 flex min-h-8 shrink-0 items-center">
            <div className="flex items-center gap-1.5">
              <PanelLabel>Category Share</PanelLabel>
              {othersInfo && <InfoTooltip text={othersInfo} panelClassName="w-72" floating />}
            </div>
          </div>
          <div
            className="category-share-chart relative min-h-0 w-full flex-1"
            style={{
              minHeight: narrow
                ? Math.max(180, colored.length * 36)
                : AURA_SOURCES_DONUT_WELL,
            }}
          >
            <div className="absolute inset-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                key={`${hasEntered ? "cat-animate" : "cat-idle"}-${selectedGroup}`}
                data={colored}
                layout="vertical"
                // top margin = donut apex inset so the first bar's top edge
                // shares a line with the ring peak (and CATEGORY / AURA).
                margin={{
                  top: narrow ? 0 : apexInset,
                  left: 4,
                  right: narrow ? 36 : 48,
                  bottom: 8,
                }}
                // Modest gap between category bands so bars don't stack flush.
                barCategoryGap="18%"
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  domain={[0, "dataMax"]}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                  minTickGap={28}
                  tick={{
                    fontSize: 12,
                    fontFamily: "var(--font-mono), ui-monospace, monospace",
                    fill: "var(--color-text-primary)",
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={narrow ? 92 : isDrillDown ? 128 : 110}
                  interval={0}
                  padding={{ top: 0, bottom: 0 }}
                  tick={(props) => {
                    const i = colored.findIndex((r) => r.category === props.payload?.value);
                    return (
                      <CategoryYTick
                        {...props}
                        active={sharedHover === i}
                        dimmed={sharedHover != null && sharedHover !== i}
                        onHover={() => i >= 0 && setSharedHover(i)}
                      />
                    );
                  }}
                />
                <Tooltip
                  cursor={false}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as CategoryChartRow | undefined;
                    if (!row) return null;
                    return (
                      <div className="rounded-[4px] border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-3 py-2.5 shadow-[0_14px_36px_rgba(0,0,0,.55)]">
                        <p className="m-0 mb-1.5 font-sans text-[13px] font-medium leading-none text-[var(--t-text-primary)]">
                          {String(label)}
                        </p>
                        <div className="grid grid-cols-[auto_auto] gap-x-3 leading-none">
                          <span className="font-label text-text-muted">Share</span>
                          <span className="font-data text-right text-[var(--t-accent)]">
                            {row.groupShare.toFixed(1)}% of group · {row.share.toFixed(2)}% total
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="groupShare"
                  radius={[0, 2, 2, 0]}
                  minPointSize={3}
                  isAnimationActive={hasEntered}
                  activeBar={false}
                  onMouseEnter={(_, i) => setSharedHover(i)}
                  shape={(props: unknown) => {
                    const p = props as RectangleProps & { index?: number; className?: string };
                    // Grow with the band when the panel stretches, but keep a
                    // gap between bars (never fill the whole band).
                    const band = Number(p.height) || 28;
                    const h = Math.min(band * 0.72, Math.max(22, Math.min(36, band)));
                    const idx = typeof p.index === "number" ? p.index : -1;
                    const row = colored[idx];
                    if (!row) return <g />;
                    const lit = sharedHover === idx;
                    return (
                      <CategoryBar
                        geom={{
                          x: Number(p.x) || 0,
                          // Centre the bar in its category band.
                          y: (Number(p.y) || 0) + (band - h) / 2,
                          width: Number(p.width) || 0,
                          height: h,
                        }}
                        fill={markFill(idx, sharedHover, restAt)}
                        bed={pulseBed(row.color)}
                        lit={lit}
                        dimmed={sharedHover != null && !lit}
                      />
                    );
                  }}
                >
                  <LabelList
                    dataKey="groupShare"
                    position="right"
                    formatter={(value: number) => `${value.toFixed(1)}%`}
                    fill="var(--color-text-primary)"
                    fontSize={12}
                    fontFamily="var(--font-mono), ui-monospace, monospace"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          </div>
        </PanelCard>
      </div>
  );
}
