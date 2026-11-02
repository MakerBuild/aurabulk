"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { CHART_GOLD, chartMarketColor, chartSlateRamp } from "@/lib/overview-metrics";
import { marketBase } from "@/lib/bulk-exchange";
import {
  VOLUME_RANGES,
  coinForSymbol,
  type VolumeBucket,
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
import { Select } from "@/components/ui/Select";
import { formatUtcDay, formatUtcMonth, formatUtcTime } from "@/components/overview/spark-format";

/** A range switch replays a short entrance; see `switched` below. */
const SWITCH_ENTRANCE_MS = 350;
/** How often the ranges are refreshed in the background. */
const KEEP_FRESH_MS = 120_000;

type MarketGroup = "all" | "crypto" | "tradfi";

const GROUP_OPTIONS: { value: MarketGroup; label: string }[] = [
  { value: "all", label: "All" },
  { value: "crypto", label: "Crypto" },
  { value: "tradfi", label: "TradFi" },
];

function inGroup(symbol: string, group: MarketGroup): boolean {
  if (group === "all") return true;
  return (coinForSymbol(symbol) === "tradfi") === (group === "tradfi");
}

/** Markets shown on their own until the picker is touched: the largest few. */
const DEFAULT_PICKS = 3;

/** Rows the tooltip lists before it sums the smallest into one line. */
const TOOLTIP_ROWS = 6;

/** The picker's entry, and the series key, for the markets not picked. */
const OTHER = "other";
/** The picker's entry that ticks or clears every market at once. */
const ALL_MARKETS = "all-markets";

/** Where the viewer's chart choices are kept between visits. */
const PREFS_KEY = "overview:volume-chart";

interface VolumePrefs {
  range: VolumeRange;
  group: MarketGroup;
  picked: string[] | null;
  showOther: boolean;
  hidden: string[];
  showCumulative: boolean;
  showOi: boolean;
}

function loadPrefs(): Partial<VolumePrefs> | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<VolumePrefs> | null;
    if (!saved || typeof saved !== "object") return null;
    const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
    return {
      range: VOLUME_RANGES.includes(saved.range as VolumeRange) ? saved.range : undefined,
      group: GROUP_OPTIONS.some((o) => o.value === saved.group) ? saved.group : undefined,
      picked: saved.picked === null || strings(saved.picked) ? saved.picked : undefined,
      showOther: typeof saved.showOther === "boolean" ? saved.showOther : undefined,
      hidden: strings(saved.hidden) ? saved.hidden : undefined,
      showCumulative: typeof saved.showCumulative === "boolean" ? saved.showCumulative : undefined,
      showOi: typeof saved.showOi === "boolean" ? saved.showOi : undefined,
    };
  } catch {
    return null;
  }
}

function savePrefs(prefs: VolumePrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private windows and blocked storage: the choices just last the visit.
  }
}

/** A stacked series: one picked market, or the rest of the group as Other. */
interface Series {
  key: string;
  label: string;
  color: string;
}

const OI_COLOR = "var(--t-oi-line)";

/** The axes at the page's 13px text size, in the site face (the CSS in
 *  .volume-chart has the last word, as recharts' own rule is !important). */
const AXIS_TICK = {
  fill: "var(--t-text-muted)",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "var(--font-sans), system-ui, sans-serif",
} as const;
/** Room for "$500.0K" at 13px beside the plot. */
const Y_AXIS_WIDTH = 60;

const RANGE_OPTIONS = VOLUME_RANGES.map((r) => ({ value: r, label: r }));

function formatAxisTick(t: number, range: VolumeRange): string {
  if (range === "1D") return formatUtcTime(t);
  return range === "Y" ? formatUtcMonth(t) : formatUtcDay(t);
}

/** A bucket as drawn: the picked group's series by key, and no cumulative on
 * W's days still ahead. */
type ChartRow = Pick<VolumeBucket, "t" | "total" | "oi" | "future"> & {
  cumulative: number | null;
  [series: string]: number | null | true | undefined;
};

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

function LegendToggle({
  series,
  on,
  onToggle,
}: {
  series: Series;
  on: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(series.key)}
      aria-pressed={on}
      className={cn("inline-flex items-center gap-[7px] transition-opacity", on ? "text-text-secondary" : "opacity-40")}
    >
      <span className="h-2 w-2 rounded-[1px]" style={{ background: series.color }} />
      {series.label}
    </button>
  );
}

/** Space kept between the tooltip and the window's edge. */
const TIP_EDGE = 8;

/**
 * The tooltip's box, lifted by however much of it would fall past the bottom
 * of the window (and never past the top). Recharts places it below the
 * pointer with no thought for the window, and a bar opened to every market
 * ran off the screen. Measured from where Recharts is moving the tooltip,
 * read off its transform, not where it is mid-glide.
 */
function TooltipFit({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const wrapper = el?.closest<HTMLElement>(".recharts-tooltip-wrapper");
    if (!el || !wrapper) return;
    const fit = () => {
      const target = /translate(?:3d)?\(\s*[-\d.]+px,\s*([-\d.]+)px/.exec(wrapper.style.transform);
      if (!target) return;
      // Where the wrapper sits untranslated: its box now, less the part of
      // the glide it has covered so far.
      const gliding = new DOMMatrix(getComputedStyle(wrapper).transform).m42;
      const top = wrapper.getBoundingClientRect().top - gliding + Number(target[1]);
      const overflow = top + el.offsetHeight - (window.innerHeight - TIP_EDGE);
      const next = overflow > 0 ? -Math.min(overflow, top - TIP_EDGE) : 0;
      setLift((prev) => (Math.abs(next - prev) > 0.5 ? next : prev));
    };
    fit();
    // Again whenever Recharts moves the tooltip or its rows change, which
    // need not re-render this box.
    const moved = new MutationObserver(fit);
    moved.observe(wrapper, { attributes: true, attributeFilter: ["style"] });
    const resized = new ResizeObserver(fit);
    resized.observe(el);
    return () => {
      moved.disconnect();
      resized.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className={className} style={lift ? { transform: `translateY(${lift}px)` } : undefined}>
      {children}
    </div>
  );
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
  const [group, setGroup] = useState<MarketGroup>("all");
  // Null until the picker is touched: then the largest markets of whatever
  // range is on screen.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [showOther, setShowOther] = useState(true);
  // Series switched off from the legend; they stay picked.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  // The bar whose tooltip lists every market rather than the largest few.
  const [expandedT, setExpandedT] = useState<number | null>(null);
  const [showCumulative, setShowCumulative] = useState(true);
  const [showOi, setShowOi] = useState(true);

  // Saved choices are read after mount: the server rendered the defaults, and
  // reading storage during render would not match it. Nothing is written
  // until they are in, or the defaults would overwrite them.
  const [prefsRead, setPrefsRead] = useState(false);
  useEffect(() => {
    const saved = loadPrefs();
    if (saved) {
      if (saved.range) setRange(saved.range);
      if (saved.group) setGroup(saved.group);
      if (saved.picked !== undefined) setPicked(saved.picked);
      if (saved.showOther !== undefined) setShowOther(saved.showOther);
      if (saved.hidden) setHidden(new Set(saved.hidden));
      if (saved.showCumulative !== undefined) setShowCumulative(saved.showCumulative);
      if (saved.showOi !== undefined) setShowOi(saved.showOi);
    }
    setPrefsRead(true);
  }, []);
  useEffect(() => {
    if (!prefsRead) return;
    savePrefs({ range, group, picked, showOther, hidden: [...hidden], showCumulative, showOi });
  }, [prefsRead, range, group, picked, showOther, hidden, showCumulative, showOi]);
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

  // The group's markets that traded in the range, largest first.
  const groupMarkets = useMemo(() => {
    const totals = new Map<string, number>();
    for (const b of payload?.buckets ?? []) {
      for (const [symbol, usd] of Object.entries(b.markets ?? {})) {
        if (inGroup(symbol, group)) totals.set(symbol, (totals.get(symbol) ?? 0) + usd);
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([symbol]) => symbol);
  }, [payload, group]);

  // Stacked largest at the bottom, whatever order they were ticked in.
  const picks = useMemo(
    () => (picked ? groupMarkets.filter((m) => picked.includes(m)) : groupMarkets.slice(0, DEFAULT_PICKS)),
    [groupMarkets, picked],
  );
  const hasRest = showOther && groupMarkets.length > picks.length;

  // Colour by rank in the group, not among the picks, so ticking one market
  // leaves the others their colours. Other stays slate.
  const series = useMemo((): Series[] => {
    const list = picks.map((m) => ({
      key: m,
      label: marketBase(m),
      color: chartMarketColor(groupMarkets.indexOf(m)),
    }));
    if (hasRest) list.push({ key: OTHER, label: "Other", color: chartSlateRamp(3, 7) });
    return list;
  }, [picks, hasRest, groupMarkets]);
  const drawn = useMemo(() => series.filter((s) => !hidden.has(s.key)), [series, hidden]);

  const rows = useMemo(() => {
    const buckets = payload?.buckets ?? [];
    let running = 0;
    return buckets.map((b): ChartRow => {
      const visible: ChartRow = { t: b.t, oi: b.oi, future: b.future, total: 0, cumulative: 0 };
      let rest = 0;
      for (const [symbol, usd] of Object.entries(b.markets ?? {})) {
        if (!inGroup(symbol, group)) continue;
        if (picks.includes(symbol)) visible[symbol] = usd;
        else rest += usd;
      }
      if (hasRest) visible[OTHER] = rest;
      for (const s of drawn) visible.total += Number(visible[s.key] ?? 0);
      running += visible.total;
      // Null, not the running total, on days still ahead: the lines stop at
      // today instead of running flat across the rest of the week.
      visible.cumulative = b.future ? null : running;
      return visible;
    });
  }, [payload, group, picks, hasRest, drawn]);

  function toggleSeries(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const allPicked = groupMarkets.length > 0 && picks.length === groupMarkets.length;
  const marketOptions = [
    { value: ALL_MARKETS, label: "All markets" },
    { value: OTHER, label: "Other" },
    ...groupMarkets.map((m) => ({ value: m, label: marketBase(m) })),
  ];
  const pickerValues = [...(allPicked ? [ALL_MARKETS] : []), ...(showOther ? [OTHER] : []), ...picks];
  const pickerSummary = allPicked ? "All markets" : `${picks.length} ${picks.length === 1 ? "market" : "markets"}`;

  function changePicks(values: string[]) {
    setShowOther(values.includes(OTHER));
    // "All markets" ticks every market, or clears them all when unticked.
    if (values.includes(ALL_MARKETS) !== allPicked) {
      setPicked(allPicked ? [] : groupMarkets);
      return;
    }
    setPicked(values.filter((v) => v !== OTHER && v !== ALL_MARKETS));
  }

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
  const topSeries = drawn.at(-1)?.key;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-3">
          <p className="font-label m-0 text-text-muted">Total Volume</p>
          <Select
            bare
            compact
            options={GROUP_OPTIONS}
            value={group}
            onChange={(next) => {
              setGroup(next as MarketGroup);
              setPicked(null);
              setHidden(new Set());
            }}
          />
          <Select
            multiple
            searchable
            bare
            compact
            options={marketOptions}
            values={pickerValues}
            summary={pickerSummary}
            onChange={changePicks}
          />
        </div>
        <SegmentedToggle
          options={RANGE_OPTIONS}
          value={range}
          onChange={pickRange}
          layoutId="volume-range-pill"
          className="min-w-[240px]"
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-4 text-[11px] text-text-muted select-none">
        {series.map((s) => (
          <LegendToggle key={s.key} series={s} on={!hidden.has(s.key)} onToggle={toggleSeries} />
        ))}
        <button
          type="button"
          onClick={() => setShowCumulative((v) => !v)}
          aria-pressed={showCumulative}
          className={cn(
            "inline-flex items-center gap-[7px] transition-opacity",
            showCumulative ? "text-text-secondary" : "opacity-40",
          )}
        >
          {/* The line's own colour: the accent is BTC's in the dark theme. */}
          <span className="h-[2px] w-4 bg-[var(--t-spark-line)]" />
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
      <div className="volume-chart relative mt-2 min-h-[220px] flex-1 xl:min-h-0">
        <div className="absolute inset-0">
        {failed ? (
          <p className="m-0 pt-10 text-center font-sans text-[13px] text-text-dim">Couldn’t load volume.</p>
        ) : !payload ? (
          <p className="m-0 pt-10 text-center font-sans text-[13px] text-text-dim">Loading volume…</p>
        ) : rows.length === 0 ? (
          <p className="m-0 pt-10 text-center font-sans text-[13px] text-text-dim">No volume in this window.</p>
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
                // A click on a bar lists every market in its tooltip; a
                // second click folds it back to the largest few.
                onClick={(state) => {
                  const t = Number(state?.activeLabel);
                  if (Number.isFinite(t)) setExpandedT((prev) => (prev === t ? null : t));
                }}
                className="cursor-pointer"
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
                  width={Y_AXIS_WIDTH}
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
                  width={Y_AXIS_WIDTH}
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
                  width={Y_AXIS_WIDTH}
                />
                <Tooltip
                  cursor={{ fill: "rgb(var(--t-veil-rgb)/0.03)" }}
                  // Free to run past the plot downwards: with many markets it
                  // is taller than the chart, and clamped it was cut off.
                  allowEscapeViewBox={{ x: false, y: true }}
                  wrapperStyle={{ zIndex: 30 }}
                  content={({ active, payload: tip, label }) => {
                    if (!active || !tip?.length) return null;
                    const row = tip[0]?.payload as ChartRow | undefined;
                    if (!row || row.future) return null;
                    // Largest first; past TOOLTIP_ROWS the smallest share a line.
                    const ranked = drawn
                      .filter((s) => Number(row[s.key]) > 0)
                      .sort((a, b) => Number(row[b.key]) - Number(row[a.key]));
                    const cap = row.t === expandedT ? ranked.length : TOOLTIP_ROWS;
                    const tipRows = { listed: ranked.slice(0, cap), rest: ranked.slice(cap) };
                    if (tipRows.rest.length === 1) tipRows.listed.push(tipRows.rest.pop()!);
                    return (
                      // Readable first: the page's 13px text, room between
                      // rows, and every row on one grid, name at the left and
                      // figure at the right. Sections part by a rule with the
                      // same space either side: the hour, the coins, the total
                      // (the one bold line), the running lines in their own
                      // colours. The margins live on the sections, not the rows.
                      <TooltipFit className="min-w-[200px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-3.5 py-3 font-sans text-[13px] leading-none tabular-nums shadow-[var(--t-shadow-pop)]">
                        <p className="m-0 text-text-muted">{formatAxisTick(Number(label), range)}</p>
                        <div className="mt-2.5 flex flex-col gap-2 border-t border-[var(--color-line)] pt-2.5">
                          {tipRows.listed.map((s) => (
                            <p key={s.key} className="m-0 flex justify-between gap-8 text-text-secondary">
                              <span className="inline-flex items-center gap-[7px]">
                                <span className="h-2 w-2 rounded-[1px]" style={{ background: s.color }} />
                                {s.label}
                              </span>
                              <span className="text-text-primary">{formatUsd(Number(row[s.key]))}</span>
                            </p>
                          ))}
                          {tipRows.rest.length > 0 && (
                            <p className="m-0 flex justify-between gap-8 text-text-muted">
                              <span>+{tipRows.rest.length} more</span>
                              <span>{formatUsd(tipRows.rest.reduce((sum, s) => sum + Number(row[s.key]), 0))}</span>
                            </p>
                          )}
                        </div>
                        <div className="mt-2.5 border-t border-[var(--color-line)] pt-2.5">
                          <p className="m-0 flex justify-between gap-8 font-semibold text-text-primary">
                            <span>Total</span>
                            <span>{formatUsd(row.total)}</span>
                          </p>
                        </div>
                        {(showCumulative && row.cumulative != null) || (showOi && row.oi != null) ? (
                          <div className="mt-2.5 flex flex-col gap-2.5 border-t border-[var(--color-line)] pt-2.5">
                            {showCumulative && row.cumulative != null && (
                              <p className="m-0 flex justify-between gap-8 text-[var(--t-spark-line)]">
                                <span>Cumulative</span>
                                <span>{formatUsd(row.cumulative)}</span>
                              </p>
                            )}
                            {showOi && row.oi != null && (
                              <p className="m-0 flex justify-between gap-8" style={{ color: OI_COLOR }}>
                                <span>Open Interest</span>
                                <span>{formatUsd(row.oi)}</span>
                              </p>
                            )}
                          </div>
                        ) : null}
                      </TooltipFit>
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
                {drawn.map((s) => (
                  <Bar
                    key={s.key}
                    yAxisId="bar"
                    dataKey={s.key}
                    stackId="vol"
                    fill={s.color}
                    barSize={OVERVIEW_BAR_W}
                    animationDuration={entranceMs}
                    radius={
                      s.key === topSeries
                        ? [OVERVIEW_BAR_RADIUS, OVERVIEW_BAR_RADIUS, 0, 0]
                        : 0
                    }
                  />
                ))}
                {showCumulative && (
                  <Line
                    yAxisId="cum"
                    type="monotone"
                    dataKey="cumulative"
                    stroke="var(--t-spark-line)"
                    strokeWidth={2.2}
                    dot={false}
                    animationDuration={entranceMs}
                    activeDot={{ r: 3, fill: "var(--t-spark-line)" }}
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
