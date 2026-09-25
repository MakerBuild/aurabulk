"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FDV_SCENARIOS, cn, formatNumber, formatUsd } from "@/lib/utils";
import { useNarrowViewport } from "@/lib/use-narrow-viewport";
import { APR_TOTAL_AURA_SUPPLY } from "@/lib/overview-metrics";
import { computeFdv } from "@/lib/percentiles";
import { useLiveFinancials } from "@/components/live/LiveFinancialProvider";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { PanelCard, PanelLabel } from "@/components/overview/PanelCard";
import { RowHighlight } from "@/components/ui/RowHighlight";
import { PageHeading } from "@/components/layout/PageHeading";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import {
  Area,
  AreaChart,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const FDV_FIELD_INFO = {
  yourAura:
    "Total AURA your wallet has earned (or a target amount to model). Use Wallet Lookup or your leaderboard total.",
  fdv: "Fully Diluted Valuation — token price × fully diluted supply (as if all tokens were unlocked). Not market cap, which uses circulating supply only. Enter your scenario in M (millions) or B (billions).",
  allocation:
    "Portion of the total token supply allocated to the airdrop in your scenario.",
  totalSupply:
    "Assumed AURA in the airdrop pool at distribution — the number your FDV scenario is divided by. Live campaign total is only what has been earned so far and will keep growing. Overview APR models 60M.",
  poolValue:
    "FDV × Allocation (%) — the airdrop's market cap. Edit to set a target; FDV, Price per Aura, and Your Value update.",
} as const;

/** Cents, in full, with separators — except a trailing `.00`, which adds
 * nothing to "$1,250". formatUsd compacts anything past a thousand — fine
 * for a table cell, wrong for the single figure this page is built around,
 * where "$6.5K" hides the very digits being modelled. */
function formatUsdExact(value: number): string {
  const cents = Math.round(value * 100);
  const whole = cents % 100 === 0;
  return (
    "$" +
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * FDV at a fractional position along the scenario list — position 0 is the
 * first scenario, 1 the second, and 2.5 halfway between the third and fourth.
 *
 * Straight lines between the scenarios are what put the corners in the curve:
 * the steps run 150, 250, 250, 250, then 1000, so the slope quadruples in one
 * place and the eye reads a hinge. This is a monotone cubic (Fritsch-Carlson)
 * through the same six points — it keeps every one of them exactly, never
 * doubles back or overshoots the way a plain cubic would, and hands the
 * segments matching slopes where they meet, which is what turns the hinge into
 * a bend.
 *
 * The slopes are computed on the whole list rather than per call; sampling is
 * the only per-point work.
 */
function monotoneSlopes(values: readonly number[]): number[] {
  const n = values.length;
  const deltas: number[] = [];
  for (let i = 0; i < n - 1; i++) deltas.push(values[i + 1] - values[i]);

  const slopes: number[] = new Array(n);
  slopes[0] = deltas[0];
  slopes[n - 1] = deltas[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // Harmonic mean of the neighbouring steps: it leans towards the smaller of
    // the two, which is what stops a long step from dragging the curve past
    // the point it is meant to pass through.
    slopes[i] =
      deltas[i - 1] * deltas[i] <= 0
        ? 0
        : (2 * deltas[i - 1] * deltas[i]) / (deltas[i - 1] + deltas[i]);
  }

  // Fritsch-Carlson limiter — the step that makes it monotone rather than
  // merely smooth.
  for (let i = 0; i < n - 1; i++) {
    if (deltas[i] === 0) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const a = slopes[i] / deltas[i];
    const b = slopes[i + 1] / deltas[i];
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      slopes[i] = scale * a * deltas[i];
      slopes[i + 1] = scale * b * deltas[i];
    }
  }
  return slopes;
}

const FDV_SLOPES = monotoneSlopes(FDV_SCENARIOS);

function fdvAtPosition(position: number): number {
  const last = FDV_SCENARIOS.length - 1;
  const i = Math.min(Math.max(Math.floor(position), 0), last - 1);
  const t = position - i;
  const t2 = t * t;
  const t3 = t2 * t;
  // Cubic Hermite basis.
  return (
    (2 * t3 - 3 * t2 + 1) * FDV_SCENARIOS[i] +
    (t3 - 2 * t2 + t) * FDV_SLOPES[i] +
    (-2 * t3 + 3 * t2) * FDV_SCENARIOS[i + 1] +
    (t3 - t2) * FDV_SLOPES[i + 1]
  );
}

/** Stops laid between each neighbouring pair of scenarios — per interval, not
 * across the whole range. That distinction is the axis: subdividing each
 * interval equally keeps every scenario an equal number of stops from the next
 * one, so the six ticks stay evenly spaced across the plot. Subdividing the
 * range as a whole would have spaced the stops by value instead, which drags
 * $100M-$500M into the left quarter and spreads $1000M-$2000M across half the
 * width.
 *
 * High enough that the cursor slides rather than steps, low enough that the
 * whole series is trivial arithmetic on every keystroke in the FDV box. */
const FDV_STEPS_PER_SEGMENT = 24;

/** Millions up to a billion, then "$1B" / "$2B". Four-digit millions are the
 * point where the unit stops helping: "$2000M" has to be counted, "$2B" is
 * read.
 *
 * One formatter for every place an FDV is written — the axis ticks and the
 * scenario rows — so the same number can never be spelled two ways on one
 * screen. */
function fdvTick(value: number): string {
  if (value >= 1_000_000_000) return "$" + scaledFigure(value, 1_000_000_000, "B");
  return "$" + Math.round(value / 1_000_000) + "M";
}

/** `value / divisor` with at most one decimal and no trailing ".0". */
function scaledFigure(value: number, divisor: number, suffix: string): string {
  const n = value / divisor;
  return `${Number.isInteger(n) ? n : +n.toFixed(1)}${suffix}`;
}

function niceUsdStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Round dollar levels from $0 to the curve's own peak — the top tick is
 *  the $2B scenario, so the line reaches the top of the plot. */
function usdAxisTicks(max: number): { hi: number; ticks: number[] } {
  const hi = Math.max(max, 1);
  const step = niceUsdStep(hi / 4);
  const ticks: number[] = [];
  for (let v = 0; v < hi - step * 0.35; v += step) ticks.push(v);
  ticks.push(hi);
  return { hi, ticks };
}

function formatAxisUsd(value: number): string {
  if (value >= 1_000_000) return "$" + scaledFigure(value, 1_000_000, "M");
  if (value >= 1_000) return "$" + scaledFigure(value, 1_000, "K");
  return "$" + Math.round(value);
}

const FDV_Y_AXIS_W = 52;

/**
 * Axis label that hugs the plot's edges instead of overhanging them.
 *
 * Recharts centres every tick on its own gridline, so the first and last —
 * sitting on the very edges — spill half their width outside the plot. The fix
 * was margins wide enough to catch the overhang, but that pulled the curve in
 * from both sides and left it stopping short of the card. Anchoring the outer
 * two labels to their inside edge instead lets the plot run the full width and
 * the curve reach the card's edge.
 */
function FdvAxisTick({
  x,
  y,
  payload,
  index,
  visibleTicksCount,
  fontSize = 12,
}: {
  x?: number;
  y?: number;
  payload?: { value?: number };
  index?: number;
  visibleTicksCount?: number;
  fontSize?: number;
}) {
  const isFirst = index === 0;
  const isLast = visibleTicksCount != null && index === visibleTicksCount - 1;
  return (
    <text
      x={x}
      y={y}
      dy={14}
      textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
      fill="var(--color-text-primary)"
      fontSize={fontSize}
      fontFamily="var(--font-mono)"
    >
      {fdvTick(payload?.value ?? 0)}
    </text>
  );
}

/** Right-axis dollars. Lives in a gutter to the right of the plot so the
 * labels never sit on the curve, and end-anchors on the gutter's right —
 * the same x as Airdrop market cap in the header. */
function FdvYAxisTick({
  x,
  y,
  payload,
  index,
}: {
  x?: number;
  y?: number;
  payload?: { value?: number };
  index?: number;
}) {
  const isBottom = index === 0;
  return (
    <text
      x={x}
      y={y}
      dx={FDV_Y_AXIS_W - 2}
      dy={isBottom ? -6 : 4}
      textAnchor="end"
      fill="var(--color-text-primary)"
      fontSize={12}
      fontFamily="var(--font-mono)"
    >
      {formatAxisUsd(payload?.value ?? 0)}
    </text>
  );
}

/** The page's two tools. */
const TOOL_TABS = [
  { id: "estimator", label: "Airdrop Estimator" },
  { id: "predictor", label: "Aura Predictor" },
] as const;

type ToolTab = (typeof TOOL_TABS)[number]["id"];
type SupplyPreset = "live" | "custom";

export function CalculatorSection() {
  const { totalAura } = useLiveFinancials();
  const liveSupply = Math.round(totalAura);
  const [tab, setTab] = useState<ToolTab>("estimator");
  const [userAura, setUserAura] = useState(500);
  const [fdv, setFdv] = useState(500_000_000);
  const [allocation, setAllocation] = useState(30);
  // 60M, not the live earned-so-far figure: this card models a future drop,
  // and the campaign total is still a fraction of the assumed pool.
  const [supplyPreset, setSupplyPreset] = useState<SupplyPreset>("custom");
  const [customSupply, setCustomSupply] = useState(APR_TOTAL_AURA_SUPPLY);
  const auraSupply = supplyPreset === "live" ? liveSupply : customSupply;

  const result = useMemo(
    () => computeFdv(userAura, fdv, allocation, auraSupply),
    [userAura, fdv, allocation, auraSupply]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* The tool tabs sit inside the heading card: they pick which tool the
          page is, which is the heading's own question. Underlined like the
          site nav rather than a pill — switching whole views is the nav's
          kind of move; the pill is for swapping a series inside one panel. */}
      <PageHeading eyebrow="Tools" title="Calculators & estimators">
        <UnderlineTabs tabs={TOOL_TABS} value={tab} onChange={setTab} />
      </PageHeading>

      {tab === "estimator" ? (
        <EstimatorWorkbench
          userAura={userAura}
          setUserAura={setUserAura}
          fdv={fdv}
          setFdv={setFdv}
          allocation={allocation}
          setAllocation={setAllocation}
          auraSupply={auraSupply}
          setAuraSupply={(v) => {
            setSupplyPreset("custom");
            setCustomSupply(v);
          }}
          supplyPreset={supplyPreset}
          onToggleLiveSupply={() => {
            if (supplyPreset === "live") {
              // Freeze at the figure currently showing.
              setCustomSupply(liveSupply);
              setSupplyPreset("custom");
            } else {
              setSupplyPreset("live");
            }
          }}
          result={result}
        />
      ) : (
        <PanelCard glossy glossDelay={-11} className="py-10 text-center">
          <p className="font-label m-0 text-text-dim">Aura Predictor</p>
          <p className="mx-auto m-0 mt-3 max-w-[560px] font-sans text-[13px] leading-relaxed text-text-secondary">
            Coming soon: model your weekly trading earnings
          </p>
        </PanelCard>
      )}
    </div>
  );
}

const MARKET_SLIDE_MS = 560;
const MARKET_FADE_MS = 380;
const MARKET_SLIDE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** Collapsed strip: 8px gap under the header + h-11 bar. */
const MARKET_PEEK_H = 52;

function useContentHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = el.offsetHeight;
      setHeight((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, height };
}

/** The plot box's live size. Recharts redraws at every size rather than
 *  having its SVG stretched to fit: stretching squashed the axis text and the
 *  dots whenever the box changed height (Hide/Show, the row resizing). The
 *  series draw without animation, so a redraw per frame just follows the box. */
function usePlotSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [draw, setDraw] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = (w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      setDraw((prev) =>
        Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1 ? prev : { w, h }
      );
    };
    commit(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) commit(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, draw };
}

const AURA_PRESETS = [100, 500, 2_500, 5_000, 10_000, 100_000] as const;

/** Inputs card type scale — one figure size across every amount field. */
const FIGURE_FIELD =
  "font-figure text-[18px] leading-none tracking-[-0.03em]";
/** Shared Million/Billion/LIVE chrome — one typeface, one size, text centered. */
const TOGGLE_TRACK =
  "relative shrink-0 rounded-full bg-[rgb(var(--t-veil-rgb)/0.045)] p-[3px] shadow-[inset_0_0_0_1px_rgb(var(--t-veil-rgb)/0.06)]";
const TOGGLE_BTN =
  "relative z-10 inline-flex h-[22px] items-center justify-center rounded-full px-2.5 text-center font-sans text-[11px] font-semibold leading-none tracking-[0.02em] transition-colors duration-300";

function formatCompactUsdLabel(value: number): string {
  if (value >= 1_000_000_000) return "$" + scaledFigure(value, 1_000_000_000, "B");
  if (value >= 1_000_000) return "$" + scaledFigure(value, 1_000_000, "M");
  return formatUsd(value);
}

function formatCompactSupplyLabel(value: number): string {
  if (value >= 1_000_000) return scaledFigure(value, 1_000_000, "M");
  return formatNumber(value);
}

function EstimatorWorkbench({
  userAura,
  setUserAura,
  fdv,
  setFdv,
  allocation,
  setAllocation,
  auraSupply,
  setAuraSupply,
  supplyPreset,
  onToggleLiveSupply,
  result,
}: {
  userAura: number;
  setUserAura: (v: number) => void;
  fdv: number;
  setFdv: (v: number) => void;
  allocation: number;
  setAllocation: (v: number) => void;
  auraSupply: number;
  setAuraSupply: (v: number) => void;
  supplyPreset: SupplyPreset;
  onToggleLiveSupply: () => void;
  result: { poolValue: number; auraValue: number; userValue: number };
}) {
  const [showMarket, setShowMarket] = useState(true);
  const marketFields = useContentHeight();
  const setMarketCap = (marketCap: number) => {
    if (allocation <= 0) return;
    setFdv(marketCap / (allocation / 100));
  };

  return (
    <>
      {/* 1fr / 2fr: the inputs column is a stack of single fields and needs
          only its own width, while the chart and the scenario table are the
          two things that actually improve with more of it. */}
      {/* No items-start: the two stretch to the taller of them, so the
          inputs card ends level with the chart beside it rather than stopping
          short and leaving a step in the row. */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
        <PanelCard className="min-w-0 xl:basis-0 xl:flex-1" glossy glossDelay={-16}>
          <PanelLabel>Your inputs</PanelLabel>
          <div className="mt-4 flex flex-col gap-5">
            {/* Your Aura — hero amount + quick chips */}
            <div className="rounded-[12px] border border-[rgb(var(--t-accent-rgb)/0.22)] bg-[rgb(var(--t-accent-rgb)/0.03)] px-3.5 py-3">
              <FieldLabel label="Your Aura" info={FDV_FIELD_INFO.yourAura} accent />
              <div className="mt-2 flex h-11 items-center rounded-[10px] border border-accent/50 bg-[var(--color-bulk-base)] px-3.5">
                <NumericInput
                  value={userAura}
                  onChange={setUserAura}
                  label="Your Aura"
                  className={cn(
                    "min-w-0 flex-1 bg-transparent text-text-primary outline-none",
                    FIGURE_FIELD
                  )}
                />
              </div>
              <div className="mt-2 grid w-full grid-cols-3 gap-1.5 sm:grid-cols-6">
                {AURA_PRESETS.map((preset) => {
                  const on = userAura === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setUserAura(preset)}
                      aria-pressed={on}
                      className={cn(
                        "h-7 min-w-0 rounded-[8px] border px-1 text-center text-[11px] font-medium tabular-nums transition-colors",
                        on
                          ? "border-[rgb(var(--t-veil-rgb)/0.16)] bg-[rgb(var(--t-veil-rgb)/0.08)] text-text-primary"
                          : "border-[var(--color-line-strong)] bg-[var(--color-bulk-base)] text-text-muted hover:border-[rgb(var(--t-veil-rgb)/0.14)] hover:text-text-secondary"
                      )}
                    >
                      {formatCommaNumber(preset)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Allocation — bar slider with live % */}
            <div>
              <div className="mb-2 flex h-[15px] items-center justify-between gap-3">
                <FieldLabel label="Allocation" info={FDV_FIELD_INFO.allocation} />
                <span className="font-figure text-[13px] leading-none text-text-primary">
                  {Math.round(allocation)}%
                </span>
              </div>
              <AllocationSlider value={allocation} onChange={setAllocation} />
            </div>

            {/* Market assumptions — collapsible FDV + airdrop cap */}
            <div>
              <div className="flex h-[15px] items-center justify-between gap-3">
                <p className="m-0 text-[13px] font-semibold leading-none text-text-primary">
                  Market assumptions
                </p>
                <button
                  type="button"
                  onClick={() => setShowMarket((v) => !v)}
                  aria-expanded={showMarket}
                  className="shrink-0 text-[11px] font-medium leading-none text-accent"
                >
                  {showMarket ? "Hide" : "Show"}
                </button>
              </div>
              <div
                className="relative overflow-hidden"
                style={{
                  height:
                    marketFields.height === 0
                      ? showMarket
                        ? undefined
                        : MARKET_PEEK_H
                      : showMarket
                        ? marketFields.height
                        : MARKET_PEEK_H,
                  transition: `height ${MARKET_SLIDE_MS}ms ${MARKET_SLIDE_EASE}`,
                }}
              >
                <button
                  type="button"
                  tabIndex={showMarket ? -1 : 0}
                  onClick={() => setShowMarket(true)}
                  aria-hidden={showMarket}
                  className="absolute inset-x-0 top-2 z-10 flex h-11 w-full min-w-0 items-stretch overflow-hidden rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-bulk-base)] text-left"
                  style={{
                    opacity: showMarket ? 0 : 1,
                    pointerEvents: showMarket ? "none" : "auto",
                    transition: `opacity ${MARKET_FADE_MS}ms ${MARKET_SLIDE_EASE}`,
                  }}
                >
                  {(
                    [
                      { label: "FDV", value: formatCompactUsdLabel(fdv) },
                      { label: "Cap", value: formatCompactUsdLabel(result.poolValue) },
                      { label: "Supply", value: formatCompactSupplyLabel(auraSupply) },
                    ] as const
                  ).map((item, i) => (
                    <span
                      key={item.label}
                      className={cn(
                        "flex min-w-0 flex-1 flex-col justify-center gap-1 px-3",
                        i > 0 && "border-l border-[var(--color-line-strong)]"
                      )}
                    >
                      <span className="font-label leading-none text-text-muted">{item.label}</span>
                      <span className="truncate font-figure text-[15px] leading-none tracking-[-0.03em] text-text-primary">
                        {item.value}
                      </span>
                    </span>
                  ))}
                </button>
                <div
                  ref={marketFields.ref}
                  inert={!showMarket || undefined}
                  aria-hidden={!showMarket}
                  className="flex flex-col gap-3 pt-3"
                  style={{
                    opacity: showMarket ? 1 : 0,
                    pointerEvents: showMarket ? "auto" : "none",
                    transition: `opacity ${MARKET_FADE_MS}ms ${MARKET_SLIDE_EASE}`,
                  }}
                >
                  <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-2">
                    <UnitMoneyField
                      label="FDV"
                      info={FDV_FIELD_INFO.fdv}
                      value={fdv}
                      onChange={setFdv}
                      fractionDigits={2}
                    />
                    <UnitMoneyField
                      label="Airdrop Market Cap"
                      info={FDV_FIELD_INFO.poolValue}
                      value={result.poolValue}
                      onChange={setMarketCap}
                      fractionDigits={3}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="mb-2 flex h-[15px] items-center">
                      <FieldLabel label="Total AURA supply" info={FDV_FIELD_INFO.totalSupply} />
                    </div>
                    <div className="flex h-11 items-center gap-3 rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-bulk-base)] pl-3.5 pr-1.5">
                      <NumericInput
                        value={auraSupply}
                        onChange={setAuraSupply}
                        label="Total AURA supply"
                        className={cn(
                          "min-w-0 flex-1 bg-transparent text-right outline-none",
                          FIGURE_FIELD
                        )}
                      />
                      <LiveSupplyButton
                        on={supplyPreset === "live"}
                        onToggle={onToggleLiveSupply}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </PanelCard>

        <div className="flex min-h-[280px] min-w-0 flex-col xl:min-h-0 xl:flex-[2] xl:basis-0 xl:overflow-hidden">
          <FdvValueChart
            userAura={userAura}
            fdv={fdv}
            allocation={allocation}
            auraSupply={auraSupply}
            result={result}
          />
        </div>
      </div>

      {/* Full width, below both columns rather than stacked under the chart.
          Pairing the inputs off two at a time left that card barely taller
          than the chart beside it, and the matrix — kept in the right-hand
          column — walled off the space under the inputs as a blank square.
          Across the whole row it fills that space and its four columns get
          the room to spread out besides. */}
      <FdvScenarioPanel
        userAura={userAura}
        fdv={fdv}
        allocation={allocation}
        auraSupply={auraSupply}
        currentValue={result.userValue}
      />
    </>
  );
}

/** Vertical-tick track + pill thumb. Ticks are integer device-pixel rects —
 *  a CSS repeating mask aliases into broken strokes and uneven gaps. */
function AllocationSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const uid = useId().replace(/:/g, "");
  const [dragging, setDragging] = useState(false);
  const [trackW, setTrackW] = useState(0);
  const clamped = Math.min(100, Math.max(0, value));
  const padX = 10;
  const innerW = Math.max(0, trackW - padX * 2);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const next = el.clientWidth;
      setTrackW((prev) => (prev === next ? prev : next));
    };
    update();
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const ticks = useMemo(() => {
    const devW = Math.max(0, Math.round(innerW * dpr));
    const tick = Math.max(1, Math.round(dpr));
    const gap = Math.max(2, Math.round(3 * dpr));
    const n = Math.max(1, Math.floor((devW + gap) / (tick + gap)));
    const used = n * tick + (n - 1) * gap;
    const origin = Math.floor((devW - used) / 2);
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(origin + i * (tick + gap));
    return { devW, tick, xs };
  }, [innerW, dpr]);

  const commit = (next: number) => {
    const snapped = Math.min(100, Math.max(0, Math.round(next)));
    if (snapped === valueRef.current) return;
    onChange(snapped);
  };

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const inner = rect.width - padX * 2;
    if (inner <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - padX) / inner));
    commit(ratio * 100);
  };

  const maskId = `${uid}-ticks`;
  const clipId = `${uid}-clip`;
  const svgH = Math.max(8, Math.round(14 * dpr));
  const fillW = ticks.devW * (clamped / 100);

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Allocation"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={`${Math.round(clamped)}%`}
      tabIndex={0}
      className="relative h-8 min-w-0 cursor-pointer touch-none overflow-hidden rounded-full border border-[var(--color-line-strong)] bg-[rgb(var(--t-veil-rgb)/0.035)] outline-none select-none focus-visible:ring-1 focus-visible:ring-accent/50"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setFromClientX(e.clientX);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          commit(Math.round(clamped) - 1);
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          commit(Math.round(clamped) + 1);
        } else if (e.key === "Home") {
          e.preventDefault();
          commit(0);
        } else if (e.key === "End") {
          e.preventDefault();
          commit(100);
        }
      }}
    >
      <div className="pointer-events-none absolute inset-[7px_10px] min-w-0 overflow-hidden">
        {ticks.devW > 0 && (
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${ticks.devW} ${svgH}`}
            preserveAspectRatio="none"
            className="block h-full w-full"
            style={{ minWidth: 0, overflow: "hidden" }}
            shapeRendering="crispEdges"
          >
            <defs>
              <mask id={maskId} maskUnits="userSpaceOnUse">
                {ticks.xs.map((x) => (
                  <rect
                    key={x}
                    x={x}
                    y={0}
                    width={ticks.tick}
                    height={svgH}
                    /* Mask channel, not a colour: white = opaque. Must not
                       be themed or the tick mask stops masking. */
                    fill="#fff"
                  />
                ))}
              </mask>
              <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                <rect x="0" y="0" width={fillW} height={svgH} />
              </clipPath>
            </defs>
            <rect
              x="0"
              y="0"
              width={ticks.devW}
              height={svgH}
              fill="rgb(var(--t-veil-rgb)/0.16)"
              mask={`url(#${maskId})`}
            />
            <rect
              x="0"
              y="0"
              width={ticks.devW}
              height={svgH}
              fill="var(--t-accent)"
              mask={`url(#${maskId})`}
              clipPath={`url(#${clipId})`}
            />
          </svg>
        )}
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 h-[18px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_1px_6px_rgba(0,0,0,0.45)]"
        style={{
          left: `calc(${padX}px + (100% - ${padX * 2}px) * ${clamped / 100})`,
          transition: dragging ? undefined : "left 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
    </div>
  );
}

/** The scenario curve, plus wherever the FDV box currently sits on it.
 *
 * Spaced by position rather than by value: the six scenarios run 100M to
 * 2000M, so a true numeric axis crushes the first four into the left fifth of
 * the chart and the reading everyone actually wants — how the payout steps
 * from one scenario to the next — disappears into a corner. Even spacing
 * costs the curve its literal straightness (value is linear in FDV) and buys
 * six legible steps.
 *
 * The live FDV is marked at the nearest interpolated stop, so a typed 637M
 * sits between $500M and $750M rather than snapping to a scenario. */
function FdvValueChart({
  userAura,
  fdv,
  allocation,
  auraSupply,
  result,
}: {
  userAura: number;
  fdv: number;
  allocation: number;
  auraSupply: number;
  result: { poolValue: number; auraValue: number; userValue: number };
}) {
  // One point per scenario is six stops for the cursor to jump between; this
  // fills the gaps so the readout slides instead of stepping. The axis is
  // unaffected — it is told explicitly to label the six scenarios and nothing
  // else, so a hundred data points still produce six ticks.
  //
  // Keyed on the number rather than on its formatted label: two nearby steps
  // can round to the same "$120M" string, and duplicate categories collapse
  // into one another on the axis.
  const data = useMemo(() => {
    const stops: number[] = [];
    for (let i = 0; i < FDV_SCENARIOS.length - 1; i++) {
      for (let step = 0; step < FDV_STEPS_PER_SEGMENT; step++) {
        stops.push(Math.round(fdvAtPosition(i + step / FDV_STEPS_PER_SEGMENT)));
      }
    }
    stops.push(FDV_SCENARIOS[FDV_SCENARIOS.length - 1]);
    return stops.map((f) => {
      const at = computeFdv(userAura, f, allocation, auraSupply);
      return {
        fdv: f,
        value: at.userValue,
        auraValue: at.auraValue,
        poolValue: at.poolValue,
      };
    });
  }, [userAura, allocation, auraSupply]);

  // The beacon snaps to the nearest stop rather than the typed FDV getting a
  // stop of its own: an extra point inserted mid-grid would push every
  // scenario after it off the even spacing the axis depends on. The grid is
  // fine enough that the nearest stop is within a few million. Null when the
  // FDV box is outside the scenario range — there is no curve out there to
  // stand on.
  const beacon = useMemo(() => {
    if (fdv < data[0].fdv || fdv > data[data.length - 1].fdv) return null;
    return data.reduce((best, point) =>
      Math.abs(point.fdv - fdv) < Math.abs(best.fdv - fdv) ? point : best
    );
  }, [data, fdv]);

  // Hovering the curve previews a scenario. All three figures switch, not
  // just the payout: they are one reading of a single FDV, and leaving the
  // two on the right showing the typed-in FDV while the headline showed the
  // hovered one would put two different scenarios side by side as if they
  // belonged together.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hovered = hoveredIndex != null ? (data[hoveredIndex] ?? null) : null;
  const shownValue = hovered ? hovered.value : result.userValue;
  const shownAuraValue = hovered ? hovered.auraValue : result.auraValue;
  const shownPoolValue = hovered ? hovered.poolValue : result.poolValue;

  const yMax = data.reduce((m, d) => Math.max(m, d.value), 0);
  const { hi: yHi, ticks: yTicks } = usdAxisTicks(yMax);
  const narrow = useNarrowViewport();
  const xTicks = narrow
    ? [100_000_000, 500_000_000, 1_000_000_000, 2_000_000_000]
    : [...FDV_SCENARIOS];

  const scenarioPoints = useMemo(
    () =>
      FDV_SCENARIOS.map((f) => ({
        fdv: f,
        value: computeFdv(userAura, f, allocation, auraSupply).userValue,
      })),
    [userAura, allocation, auraSupply]
  );

  const plot = usePlotSize();

  return (
    <PanelCard className="h-full min-h-0" glossy glossDelay={-11}>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <PanelLabel>Your Airdrop Value</PanelLabel>
          <p className="m-0 mt-2 truncate font-figure text-[clamp(24px,3vw,34px)] leading-none text-accent">
            {formatUsdExact(shownValue)}
          </p>
        </div>
        {/* Read-only: the market cap is edited in the inputs card, and one
            edit point per number keeps it clear which is the real one. */}
        <div className="flex shrink-0 items-start gap-4 border-l border-[var(--color-line)] pl-4 sm:gap-6 sm:pl-6">
          <div className="text-right">
            <PanelLabel>Price per Aura</PanelLabel>
            <p className="font-data m-0 mt-1.5 text-[12px] font-semibold text-accent">
              ${shownAuraValue.toFixed(4)}
            </p>
          </div>
          <div className="text-right">
            <PanelLabel>Airdrop market cap</PanelLabel>
            <p className="font-data m-0 mt-1.5 text-[12px] font-semibold text-accent">
              {formatUsd(shownPoolValue)}
            </p>
          </div>
        </div>
      </div>

      <div
        ref={plot.ref}
        className="relative mt-4 min-h-[214px] w-full min-w-0 flex-1 overflow-hidden xl:min-h-0"
      >
        {plot.draw.w > 0 && plot.draw.h > 0 && (
          <div className="fdv-chart absolute inset-0">
          <AreaChart
            width={plot.draw.w}
            height={plot.draw.h}
            data={data}
            margin={{ top: 8, right: 0, bottom: 24, left: 0 }}
            onMouseMove={(state) => {
              const index = (state as { activeTooltipIndex?: number } | undefined)
                ?.activeTooltipIndex;
              setHoveredIndex(typeof index === "number" ? index : null);
            }}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <defs>
              <linearGradient id="fdv-curve-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--t-accent)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--t-accent)" stopOpacity={0.02} />
              </linearGradient>
              {/* Mosaic over the wash, same treatment as the Overview charts:
                  a dot lattice turned 45 degrees so it reads as a diamond
                  mesh. Sparse enough that the scenario dots stay legible. */}
              <pattern
                id="fdv-curve-mesh"
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <circle cx="1.25" cy="1.25" r="0.6" fill="var(--t-accent)" fillOpacity={0.34} />
              </pattern>
              {/* The line is the plane's contrast colour now, not the accent.
                  The horizontal stops keep it fading out at both ends. */}
              <linearGradient id="fdv-curve-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--t-spark-line)" stopOpacity={0} />
                <stop offset="7%" stopColor="var(--t-spark-line)" stopOpacity={1} />
                <stop offset="93%" stopColor="var(--t-spark-line)" stopOpacity={1} />
                <stop offset="100%" stopColor="var(--t-spark-line)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {yTicks.map((y) => (
              <ReferenceLine
                key={`h-${y}`}
                y={y}
                stroke="rgb(var(--t-chart-b-rgb)/0.16)"
                strokeDasharray="3 3"
              />
            ))}
            {FDV_SCENARIOS.map((f) => (
              <ReferenceLine
                key={`v-${f}`}
                x={f}
                stroke="rgb(var(--t-chart-b-rgb)/0.12)"
                strokeDasharray="3 3"
              />
            ))}
            <XAxis
              dataKey="fdv"
              ticks={xTicks}
              interval={0}
              tickLine={false}
              axisLine={false}
              tick={(props) => <FdvAxisTick {...props} fontSize={narrow ? 10 : 12} />}
              tickMargin={10}
            />
            <YAxis
              orientation="right"
              domain={[0, yHi]}
              ticks={yTicks}
              interval={0}
              tick={<FdvYAxisTick />}
              axisLine={false}
              tickLine={false}
              tickSize={0}
              tickMargin={0}
              width={FDV_Y_AXIS_W}
            />
            <Tooltip
              cursor={{ stroke: "var(--color-line-strong)", strokeWidth: 1 }}
              content={() => null}
            />
            {/* Wash first, mesh on top of it — one Area cannot carry both
                fills, and the pattern alone leaves gaps that read as holes. */}
            <Area
              type="monotone"
              dataKey="value"
              stroke="none"
              fill="url(#fdv-curve-fill)"
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="url(#fdv-curve-stroke)"
              strokeWidth={2}
              fill="url(#fdv-curve-mesh)"
              isAnimationActive={false}
              dot={false}
              activeDot={{
                r: 5,
                fill: "var(--color-bulk-base)",
                stroke: "var(--t-accent)",
                strokeWidth: 2,
              }}
            />
            {scenarioPoints.map((point) => (
              <ReferenceDot
                key={`scen-${point.fdv}`}
                x={point.fdv}
                y={point.value}
                r={2.5}
                fill="var(--t-accent)"
                stroke="var(--t-base)"
                strokeWidth={1.5}
              />
            ))}
            {beacon && (
              <ReferenceDot
                x={beacon.fdv}
                y={beacon.value}
                r={3.5}
                fill="var(--t-accent)"
                stroke="none"
                className="chart-beacon"
                isFront
              />
            )}
          </AreaChart>
          </div>
        )}
      </div>
    </PanelCard>
  );
}

/** Every scenario as a row, with the live one picked out and each other one
 * quoted against it. The old table showed the same three numbers with no
 * anchor, which left "is $750M much better than $500M?" to mental arithmetic
 * — vs. Current answers it directly. */
function FdvScenarioPanel({
  userAura,
  fdv,
  allocation,
  auraSupply,
  currentValue,
}: {
  userAura: number;
  fdv: number;
  allocation: number;
  auraSupply: number;
  currentValue: number;
}) {
  const rows = FDV_SCENARIOS.map((scenario) => {
    const { userValue, auraValue } = computeFdv(userAura, scenario, allocation, auraSupply);
    const delta = currentValue > 0 ? (userValue / currentValue - 1) * 100 : 0;
    return {
      key: fdvTick(scenario),
      isCurrent: scenario === fdv,
      auraValue: "$" + auraValue.toFixed(4),
      userValue: formatUsd(userValue),
      delta,
    };
  });
  const tableRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef<Record<string, HTMLDivElement | null>>({});
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <PanelCard glossy glossDelay={-6}>
      <PanelLabel>FDV scenario matrix</PanelLabel>

      <div ref={tableRef} className="relative isolate mt-4">
        <RowHighlight
          containerRef={tableRef}
          target={hovered != null ? (rowEls.current[hovered] ?? null) : null}
        />
        {/* Same shape as the Overview tables: a 10px uppercase heading row on
            a hairline, then fixed-height rows divided by the softer one, first
            column left, every number right. */}
        <div className="-mx-2.5 grid grid-cols-4 items-center gap-x-2 border-b border-[var(--color-line)] px-2.5 pb-1.5 sm:gap-x-8">
          <span className="font-label text-text-muted">
            <span className="sm:hidden">FDV</span>
            <span className="hidden sm:inline">FDV (USD)</span>
          </span>
          <span className="text-right font-label text-text-muted">
            <span className="sm:hidden">Price</span>
            <span className="hidden sm:inline">Price per Aura</span>
          </span>
          <span className="text-right font-label text-text-muted">
            <span className="sm:hidden">Value</span>
            <span className="hidden sm:inline">Your Value</span>
          </span>
          <span className="text-right font-label text-text-muted">
            <span className="sm:hidden">vs now</span>
            <span className="hidden sm:inline">vs. Current</span>
          </span>
        </div>
        {rows.map((row, i) => (
          <div
            key={row.key}
            ref={(el) => {
              rowEls.current[row.key] = el;
            }}
            onMouseEnter={() => setHovered(row.key)}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              "-mx-2.5 grid grid-cols-4 items-center gap-x-2 px-2.5 sm:gap-x-8",
              i > 0 && "border-t border-[var(--color-line-soft)]",
              "cursor-default transition-colors",
              hovered === row.key && "border-transparent"
            )}
            style={{ height: 42 }}
          >
            <span
              className={cn(
                "font-data truncate text-[13px]",
                row.isCurrent ? "text-accent" : "text-text-primary"
              )}
            >
              {row.key}
            </span>
            <span
              className={cn(
                "font-data text-right text-[13px]",
                row.isCurrent ? "text-accent" : "text-text-secondary"
              )}
            >
              {row.auraValue}
            </span>
            <span
              className={cn(
                "font-data text-right text-[13px] font-semibold",
                row.isCurrent ? "text-accent" : "text-text-primary"
              )}
            >
              {row.userValue}
            </span>
            <span
              className={cn(
                "font-data text-right text-[13px] font-medium",
                row.isCurrent
                  ? "text-accent"
                  : row.delta >= 0
                    ? "text-bid-green"
                    : "text-[var(--color-neg-strong)]"
              )}
            >
              {row.isCurrent
                ? "—"
                : (row.delta >= 0 ? "+" : "−") + Math.abs(row.delta).toFixed(0) + "%"}
            </span>
          </div>
        ))}
      </div>
    </PanelCard>
  );
}

function FieldLabel({
  label,
  info,
  accent,
}: {
  label: string;
  info?: string;
  accent?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className={cn("font-label leading-none", accent ? "text-accent" : "text-text-muted")}>
        {label}
      </span>
      {info ? <InfoTooltip text={info} floating panelClassName="w-64" /> : null}
    </span>
  );
}

/** Million / Billion switch — equal cells, label dead-centered in each. */
function UnitToggle({
  value,
  onChange,
}: {
  value: FdvUnit;
  onChange: (unit: FdvUnit) => void;
}) {
  return (
    <div className={cn(TOGGLE_TRACK, "grid grid-cols-2 gap-[2px]")}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-[3px] bottom-[3px] left-[3px] z-0 rounded-full bg-accent"
        style={{
          width: "calc((100% - 8px) / 2)",
          transform: value === "B" ? "translateX(calc(100% + 2px))" : "translateX(0)",
          transition: "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
      {([
        { id: "M" as const, label: "Million" },
        { id: "B" as const, label: "Billion" },
      ]).map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={on}
            className={cn(
              TOGGLE_BTN,
              "min-w-0",
              on ? "text-bulk-base" : "text-text-muted hover:text-text-secondary"
            )}
          >
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function LiveSupplyButton({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={cn(TOGGLE_TRACK, "inline-flex")}>
      <button
        type="button"
        aria-pressed={on}
        title={on ? "Following live campaign total — click to freeze" : "Use earned-so-far campaign total"}
        onClick={onToggle}
        className={cn(
          TOGGLE_BTN,
          "min-w-[3.75rem] gap-1.5",
          on ? "text-bulk-base" : "text-text-muted hover:text-text-secondary"
        )}
      >
        {on && (
          <span className="absolute inset-0 rounded-full bg-accent" />
        )}
        <span className={cn("live-air relative z-10", on && "is-live")} aria-hidden="true">
          <span className="live-air-halo" />
          <span className="live-air-core" />
        </span>
        <span className="relative z-10">LIVE</span>
      </button>
    </div>
  );
}

/** Input chrome that can host a trailing control — % or M/B — without a
 * second column eating width from fields that have nothing to put there. */
function CompoundInput({
  children,
  trailing,
}: {
  children: React.ReactNode;
  trailing: React.ReactNode;
}) {
  return (
    <div className="flex h-11 items-center rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-bulk-base)] pl-3.5 pr-1.5 transition-[border-color] duration-150 focus-within:border-accent">
      {children}
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}

type FdvUnit = "M" | "B";

const FDV_UNIT_MULTIPLIER: Record<FdvUnit, number> = {
  M: 1_000_000,
  B: 1_000_000_000,
};

function unitFor(value: number): FdvUnit {
  return value >= 1_000_000_000 ? "B" : "M";
}

function formatCommaNumber(value: number, maxFractionDigits = 0): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  });
}

function formatCommaInput(raw: string, maxFractionDigits: number): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (cleaned === "" || cleaned === ".") return cleaned;

  const [intPart = "", decPart] = cleaned.split(".");
  const normalizedInt = intPart.replace(/^0+(?=\d)/, "") || "0";
  const withCommas = normalizedInt.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (cleaned.includes(".")) {
    return `${withCommas}.${(decPart ?? "").slice(0, maxFractionDigits)}`;
  }
  return withCommas;
}

function parseCommaNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function restoreCommaCursor(el: HTMLInputElement, formatted: string, digitsBefore: number) {
  let pos = 0;
  let seen = 0;
  while (pos < formatted.length && seen < digitsBefore) {
    if (/[\d.]/.test(formatted[pos]!)) seen += 1;
    pos += 1;
  }
  el.setSelectionRange(pos, pos);
}

/**
 * Comma-grouped text input over a number. Unfocused it shows `display`;
 * while focused it shows what the user typed (regrouped, caret kept in place)
 * and sends every parseable keystroke to `onInput`. Blurring an edited box
 * commits it, with empty meaning 0.
 */
function useCommaDraft({
  display,
  fractionDigits,
  onInput,
}: {
  display: string;
  fractionDigits: number;
  onInput: (parsed: number) => void;
}) {
  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [dirty, setDirty] = useState(false);
  // A fresh object per keystroke, so the caret is restored even when the
  // regrouped text comes out unchanged.
  const [caret, setCaret] = useState<{ digitsBefore: number } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (caret && ref.current) restoreCommaCursor(ref.current, draft, caret.digitsBefore);
  }, [caret, draft]);

  const allowed = fractionDigits > 0 ? /^[\d,]*\.?\d*$/ : /^[\d,]*$/;

  const inputProps = {
    ref,
    type: "text",
    inputMode: fractionDigits > 0 ? "decimal" : "numeric",
    value: focused ? draft : display,
    onFocus: () => {
      setDraft(display);
      setDirty(false);
      setFocused(true);
    },
    onBlur: () => {
      setFocused(false);
      setCaret(null);
      if (dirty) onInput(parseCommaNumber(draft) ?? 0);
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const nextRaw = input.value;
      if (nextRaw !== "" && !allowed.test(nextRaw)) return;

      const cursor = input.selectionStart ?? nextRaw.length;
      const digitsBefore = nextRaw.slice(0, cursor).replace(/[^\d.]/g, "").length;
      const formatted = formatCommaInput(nextRaw, fractionDigits);
      setDraft(formatted);
      setDirty(true);
      setCaret({ digitsBefore });

      const parsed = parseCommaNumber(formatted);
      if (parsed != null) onInput(parsed);
    },
  } as const;

  return { draft, focused, inputProps };
}

/** Whole-number field (Aura amounts, supply). */
function NumericInput({
  value,
  onChange,
  label,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  className?: string;
}) {
  const { inputProps } = useCommaDraft({
    display: formatCommaNumber(value),
    fractionDigits: 0,
    onInput: onChange,
  });
  return <input {...inputProps} aria-label={label} className={className} />;
}

/** Dollar amount typed in millions or billions, with an M/B switch. The unit
 * starts at whichever reads naturally for the initial value and is then the
 * user's to change. */
function UnitMoneyField({
  label,
  info,
  value,
  onChange,
  fractionDigits,
}: {
  label: string;
  info?: string;
  value: number;
  onChange: (v: number) => void;
  fractionDigits: number;
}) {
  const [unit, setUnit] = useState<FdvUnit>(() => unitFor(value));
  const { draft, focused, inputProps } = useCommaDraft({
    display: formatCommaNumber(value / FDV_UNIT_MULTIPLIER[unit], fractionDigits),
    fractionDigits,
    onInput: (parsed) => onChange(parsed * FDV_UNIT_MULTIPLIER[unit]),
  });

  const selectUnit = (nextUnit: FdvUnit) => {
    if (nextUnit === unit) return;
    setUnit(nextUnit);
    // Mid-edit, the typed figure is re-read in the new unit rather than the
    // value being converted.
    const parsed = focused ? parseCommaNumber(draft) : null;
    if (parsed != null) onChange(parsed * FDV_UNIT_MULTIPLIER[nextUnit]);
  };

  return (
    <div className="min-w-0">
      <div className="mb-2 flex h-[15px] items-center">
        <FieldLabel label={label} info={info} />
      </div>
      <CompoundInput trailing={<UnitToggle value={unit} onChange={selectUnit} />}>
        <input
          {...inputProps}
          aria-label={label}
          className={cn("min-w-0 flex-1 bg-transparent outline-none", FIGURE_FIELD)}
        />
      </CompoundInput>
    </div>
  );
}
