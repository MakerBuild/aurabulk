"use client";

import { useEffect, useMemo, useState } from "react";
import { holdBoot, useBootReady } from "@/lib/boot-gate";
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
import { loadVolume, peekVolume } from "@/lib/volume-history-client";
import { SegmentedToggle } from "@/components/overview/SegmentedToggle";
import { formatUtcDay, formatUtcMonth, formatUtcTime } from "@/components/overview/spark-format";

/** A range switch replays a short entrance; see `switched` below. */
const SWITCH_ENTRANCE_MS = 350;
/** How often the ranges are refreshed in the background. */
const KEEP_FRESH_MS = 120_000;

const COIN_META: Record<VolumeCoin, { label: string; color: string }> = {
  btc: { label: "BTC", color: chartPrimaryRamp(0, 4) },
  eth: { label: "ETH", color: chartPrimaryRamp(1, 4) },
  sol: { label: "SOL", color: chartPrimaryRamp(2, 4) },
  others: { label: "Others", color: chartPrimaryRamp(3, 4) },
};

const OI_COLOR = "var(--t-oi-line)";

const AXIS_TICK = {
  fill: "var(--t-text-muted)",
  fontSize: 11,
  fontFamily: "var(--font-overpass-mono), ui-monospace, monospace",
} as const;

const RANGE_OPTIONS = VOLUME_RANGES.map((r) => ({ value: r, label: r }));

function formatAxisTick(t: number, range: VolumeRange): string {
  if (range === "1D") return formatUtcTime(t);
  return range === "Y" ? formatUtcMonth(t) : formatUtcDay(t);
}

/** A bucket as drawn: only the enabled coins, and no cumulative on W's days
 * still ahead. */
type ChartRow = Omit<VolumeBucket, "cumulative"> & { cumulative: number | null };

/** The right axes leave their zero unlabelled: the left axis already marks
 * the baseline, and a right-hand "$0.00" crowds the last date under it. */
function rightAxisTick(v: number): string {
  return Number(v) === 0 ? "" : formatUsd(Number(v));
}

function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export function VolumeChart() {
  const bootReady = useBootReady();
  const [range, setRange] = useState<VolumeRange>("1D");
  // The first draw plays the full entrance; a switch after it replays a
  // short one, so a range already in hand is back in a blink rather than a
  // line drawing itself across for a second and a half.
  const [switched, setSwitched] = useState(false);
  const pickRange = (next: VolumeRange) => {
    setSwitched(true);
    setRange(next);
  };
  const entranceMs = switched ? SWITCH_ENTRANCE_MS : undefined;
  const [enabled, setEnabled] = useState<Record<VolumeCoin, boolean>>({
    btc: true,
    eth: true,
    sol: true,
    others: false,
  });
  const [showCumulative, setShowCumulative] = useState(true);
  const [showOi, setShowOi] = useState(true);
  const [loaded, setLoaded] = useState<VolumeHistoryPayload | null>(null);
  const [failedRange, setFailedRange] = useState<VolumeRange | null>(null);
  // Read during render, not after an effect, so switching to a range that is
  // already in hand draws it at once rather than flashing "Loading volume…".
  const payload =
    loaded?.range === range ? loaded : (peekVolume(`range=${range}`) ?? null);
  const failed = failedRange === range && !payload;

  useEffect(() => {
    let cancelled = false;
    // The first range holds the boot splash, so the chart is drawn when the
    // page opens rather than popping in after it.
    void holdBoot(
      loadVolume(`range=${range}`)
        .then((next) => {
          if (!cancelled) setLoaded(next);
        })
        .catch(() => {
          if (!cancelled) setFailedRange(range);
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [range]);

  // As soon as the first range is in, fetch the others in the background so
  // the first switch to any of them is instant too, and keep them fresh
  // while the page is open: a range let go stale refetched on the switch,
  // and one whose first fetch failed showed "Loading volume…" for the whole
  // trip. Not tied to the boot splash, which can outlast the first fetch.
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      for (const r of VOLUME_RANGES) void loadVolume(`range=${r}`).catch(() => {});
      // The Total Volume card's hourly series, so it is fresh when the
      // Overview is opened again.
      void loadVolume("range=ALL&interval=1h").catch(() => {});
    };
    let first = 0;
    void loadVolume("range=1D")
      .catch(() => {})
      .finally(() => {
        first = window.setTimeout(warm, 300);
      });
    const every = window.setInterval(warm, KEEP_FRESH_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  const rows = useMemo(() => {
    const buckets = payload?.buckets ?? [];
    let running = 0;
    return buckets.map((b): ChartRow => {
      const visible: ChartRow = {
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
      // Null, not the running total, on days still ahead: the lines stop at
      // today instead of running flat across the rest of the week.
      visible.cumulative = b.future ? null : running;
      return visible;
    });
  }, [payload, enabled]);

  const barMax = Math.max(0, ...rows.map((r) => r.total));
  const cumMax = Math.max(0, ...rows.map((r) => r.cumulative ?? 0));
  const barStep = niceStep(barMax / 4);
  const cumStep = niceStep(cumMax / 4);
  const barHi = Math.max(barStep, Math.ceil(barMax / barStep) * barStep);
  const cumHi = Math.max(cumStep, Math.ceil(cumMax / cumStep) * cumStep);
  const oiMax = Math.max(0, ...rows.map((r) => r.oi ?? 0));
  const oiStep = niceStep(oiMax / 4);
  const oiHi = Math.max(oiStep, Math.ceil(oiMax / oiStep) * oiStep);
  // One right-hand scale fits: cumulative keeps it when both are on, and OI
  // is then read from the tooltip.
  const oiAxisVisible = showOi && !showCumulative;
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
          onChange={pickRange}
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
        <button
          type="button"
          onClick={() => setShowOi((v) => !v)}
          aria-pressed={showOi}
          className={cn(
            "inline-flex items-center gap-[7px] transition-opacity",
            showOi ? "text-text-secondary" : "opacity-40",
          )}
        >
          <span className="h-[2px] w-4" style={{ background: OI_COLOR }} />
          Open Interest
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
          // Mounted only once the splash lifts: Recharts plays its bar and
          // line entrance on mount, and under the splash it would be over
          // before anyone saw it.
          !bootReady ? null : (
          // Keyed by range so each switch replays the entrance rather than
          // morphing one range's bars into another's.
          <div key={range} className="h-full w-full">
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
                  hide={!showCumulative}
                  domain={[0, cumHi]}
                  tickFormatter={rightAxisTick}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <YAxis
                  yAxisId="oi"
                  orientation="right"
                  hide={!oiAxisVisible}
                  domain={[0, oiHi]}
                  tickFormatter={rightAxisTick}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  cursor={{ fill: "rgb(var(--t-veil-rgb)/0.03)" }}
                  content={({ active, payload: tip, label }) => {
                    if (!active || !tip?.length) return null;
                    const row = tip[0]?.payload as ChartRow | undefined;
                    if (!row || row.future) return null;
                    return (
                      <div className="rounded-lg border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-2.5 py-2 text-[11px] shadow-[var(--t-shadow-pop)]">
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
                        {showCumulative && row.cumulative != null && (
                          <p className="m-0 flex justify-between gap-6 text-accent">
                            <span>Cumulative</span>
                            <span className="font-data">{formatUsd(row.cumulative)}</span>
                          </p>
                        )}
                        {showOi && row.oi != null && (
                          <p className="m-0 flex justify-between gap-6" style={{ color: OI_COLOR }}>
                            <span>Open Interest</span>
                            <span className="font-data">{formatUsd(row.oi)}</span>
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
                      animationDuration={entranceMs}
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
                    animationDuration={entranceMs}
                    activeDot={{ r: 3, fill: CHART_GOLD }}
                  />
                )}
                {showOi && (
                  <Line
                    yAxisId="oi"
                    type="monotone"
                    dataKey="oi"
                    stroke={OI_COLOR}
                    strokeWidth={2}
                    dot={false}
                    animationDuration={entranceMs}
                    connectNulls
                    activeDot={{ r: 3, fill: OI_COLOR }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          )
        )}
        </div>
      </div>

    </div>
  );
}
