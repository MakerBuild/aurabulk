"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_GOLD, chartPrimaryRamp } from "@/lib/overview-metrics";
import {
  VOLUME_COINS,
  VOLUME_RANGES,
  type VolumeBucket,
  type VolumeCoin,
  type VolumeHistoryPayload,
  type VolumeRange,
} from "@/lib/volume-history";
import {
  OVERVIEW_BAR_GAP,
  OVERVIEW_BAR_RADIUS,
  OVERVIEW_BAR_W,
} from "@/lib/overview-bars";
import { cn, formatUsd } from "@/lib/utils";
import { SegmentedToggle } from "@/components/overview/SegmentedToggle";
import { formatUtcDay, formatUtcTime } from "@/components/overview/spark-format";

const COIN_META: Record<VolumeCoin, { label: string; color: string }> = {
  btc: { label: "BTC", color: chartPrimaryRamp(0, 4) },
  eth: { label: "ETH", color: chartPrimaryRamp(1, 4) },
  sol: { label: "SOL", color: chartPrimaryRamp(2, 4) },
  others: { label: "Others", color: chartPrimaryRamp(3, 4) },
};

const AXIS_TICK = {
  fill: "var(--t-text-muted)",
  fontSize: 11,
  fontFamily: "var(--font-overpass-mono), ui-monospace, monospace",
} as const;

const RANGE_OPTIONS = VOLUME_RANGES.map((r) => ({ value: r, label: r }));

function formatAxisTick(t: number, range: VolumeRange): string {
  return range === "1D" ? formatUtcTime(t) : formatUtcDay(t);
}

function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export function VolumeChart() {
  const [range, setRange] = useState<VolumeRange>("1D");
  const [enabled, setEnabled] = useState<Record<VolumeCoin, boolean>>({
    btc: true,
    eth: true,
    sol: true,
    others: false,
  });
  const [showCumulative, setShowCumulative] = useState(true);
  const [payload, setPayload] = useState<VolumeHistoryPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setFailed(false);
    void fetch(`/api/volume-history?range=${range}`)
      .then((res) => {
        if (!res.ok) throw new Error(`volume-history ${res.status}`);
        return res.json() as Promise<VolumeHistoryPayload>;
      })
      .then((next) => {
        if (!cancelled) setPayload(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const rows = useMemo(() => {
    const buckets = payload?.buckets ?? [];
    let running = 0;
    return buckets.map((b) => {
      const visible: VolumeBucket = {
        ...b,
        btc: enabled.btc ? b.btc : 0,
        eth: enabled.eth ? b.eth : 0,
        sol: enabled.sol ? b.sol : 0,
        others: enabled.others ? b.others : 0,
        total: 0,
        cumulative: 0,
      };
      visible.total = visible.btc + visible.eth + visible.sol + visible.others;
      running += visible.total;
      visible.cumulative = running;
      return visible;
    });
  }, [payload, enabled]);

  const barMax = Math.max(0, ...rows.map((r) => r.total));
  const cumMax = Math.max(0, ...rows.map((r) => r.cumulative));
  const barStep = niceStep(barMax / 4);
  const cumStep = niceStep(cumMax / 4);
  const barHi = Math.max(barStep, Math.ceil(barMax / barStep) * barStep);
  const cumHi = Math.max(cumStep, Math.ceil(cumMax / cumStep) * cumStep);
  const lastEnabled = [...VOLUME_COINS].reverse().find((coin) => enabled[coin]) ?? null;

  function toggleCoin(coin: VolumeCoin) {
    setEnabled((prev) => ({ ...prev, [coin]: !prev[coin] }));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="font-label m-0 text-text-muted">Total Volume</p>
        <SegmentedToggle
          options={RANGE_OPTIONS}
          value={range}
          onChange={setRange}
          layoutId="volume-range-pill"
          className="min-w-[240px]"
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-4 text-[11px] text-text-muted select-none">
        {VOLUME_COINS.map((coin) => {
          const on = enabled[coin];
          const meta = COIN_META[coin];
          return (
            <button
              key={coin}
              type="button"
              onClick={() => toggleCoin(coin)}
              aria-pressed={on}
              className={cn(
                "inline-flex items-center gap-[7px] transition-opacity",
                on ? "text-text-secondary" : "opacity-40",
              )}
            >
              <span
                className="h-2 w-2 rounded-[1px]"
                style={{ background: meta.color }}
              />
              {meta.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowCumulative((v) => !v)}
          aria-pressed={showCumulative}
          className={cn(
            "inline-flex items-center gap-[7px] transition-opacity",
            showCumulative ? "text-text-secondary" : "opacity-40",
          )}
        >
          <span className="h-[2px] w-4 bg-accent" />
          Cumulative
        </button>
      </div>

      {/* The plot box is sized by the card alone — content sits in an
          absolute layer — so swapping the loading line for the chart never
          changes the height of the grid row this card shares with the donut. */}
      <div className="relative mt-2 min-h-[220px] flex-1 overflow-hidden xl:min-h-0">
        <div className="absolute inset-0">
        {failed ? (
          <p className="font-data m-0 pt-10 text-center text-text-dim">Couldn’t load volume.</p>
        ) : !payload ? (
          <p className="font-data m-0 pt-10 text-center text-text-dim">Loading volume…</p>
        ) : rows.length === 0 ? (
          <p className="font-data m-0 pt-10 text-center text-text-dim">No volume in this window.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={90}>
            <ComposedChart
              data={rows}
              margin={{ top: 6, right: 8, bottom: 4, left: 8 }}
              barCategoryGap={OVERVIEW_BAR_GAP}
              barGap={0}
            >
              <defs>
                {/* Cumulative area: wash for body, then a dot lattice turned
                    45 degrees for the mesh. Sparser and fainter than the KPI
                    sparklines because the bars have to stay readable through
                    it — see the ordering note below. */}
                <linearGradient id="volCumWash" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_GOLD} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={CHART_GOLD} stopOpacity={0.02} />
                </linearGradient>
                <pattern
                  id="volCumMesh"
                  width="5"
                  height="5"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <circle cx="1.25" cy="1.25" r="0.6" fill={CHART_GOLD} fillOpacity={0.34} />
                </pattern>
              </defs>
              <CartesianGrid stroke="rgb(var(--t-veil-rgb)/.05)" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={(t) => formatAxisTick(Number(t), range)}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
                height={26}
              />
              <YAxis
                yAxisId="bar"
                orientation="left"
                domain={[0, barHi]}
                tickFormatter={(v) => formatUsd(Number(v))}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <YAxis
                yAxisId="cum"
                orientation="right"
                domain={[0, cumHi]}
                tickFormatter={(v) => formatUsd(Number(v))}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                cursor={{ fill: "rgb(var(--t-veil-rgb)/0.03)" }}
                content={({ active, payload: tip, label }) => {
                  if (!active || !tip?.length) return null;
                  const row = tip[0]?.payload as VolumeBucket | undefined;
                  if (!row) return null;
                  return (
                    <div className="rounded-lg border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-2.5 py-2 text-[11px] shadow-[0_14px_36px_rgba(0,0,0,.55)]">
                      <p className="font-data m-0 mb-1.5 text-text-muted">
                        {formatAxisTick(Number(label), range)}
                      </p>
                      {VOLUME_COINS.filter((c) => enabled[c] && row[c] > 0).map((c) => (
                        <p key={c} className="m-0 flex justify-between gap-6 text-text-secondary">
                          <span>{COIN_META[c].label}</span>
                          <span className="font-data text-text-primary">{formatUsd(row[c])}</span>
                        </p>
                      ))}
                      <p className="m-0 mt-1 flex justify-between gap-6 text-text-secondary">
                        <span>Total</span>
                        <span className="font-data text-text-primary">{formatUsd(row.total)}</span>
                      </p>
                      {showCumulative && (
                        <p className="m-0 flex justify-between gap-6 text-accent">
                          <span>Cumulative</span>
                          <span className="font-data">{formatUsd(row.cumulative)}</span>
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              {/* Drawn ahead of the bars on purpose. Recharts paints children
                  in order, so declaring the area here puts it behind the bars
                  rather than burying them under the cumulative fill. */}
              {showCumulative && (
                <Area
                  yAxisId="cum"
                  type="monotone"
                  dataKey="cumulative"
                  stroke="none"
                  fill="url(#volCumWash)"
                  isAnimationActive={false}
                  activeDot={false}
                />
              )}
              {showCumulative && (
                <Area
                  yAxisId="cum"
                  type="monotone"
                  dataKey="cumulative"
                  stroke="none"
                  fill="url(#volCumMesh)"
                  isAnimationActive={false}
                  activeDot={false}
                />
              )}
              {VOLUME_COINS.map((coin) =>
                enabled[coin] ? (
                  <Bar
                    key={coin}
                    yAxisId="bar"
                    dataKey={coin}
                    stackId="vol"
                    fill={COIN_META[coin].color}
                    barSize={OVERVIEW_BAR_W}
                    radius={
                      coin === lastEnabled
                        ? [OVERVIEW_BAR_RADIUS, OVERVIEW_BAR_RADIUS, 0, 0]
                        : 0
                    }
                  />
                ) : null,
              )}
              {showCumulative && (
                <Line
                  yAxisId="cum"
                  type="monotone"
                  dataKey="cumulative"
                  stroke="var(--t-spark-line)"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 3, fill: CHART_GOLD }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        </div>
      </div>

    </div>
  );
}
