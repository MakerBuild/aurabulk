"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { DepositTier } from "@/lib/overview-metrics";
import { CHART_GOLD, chartSlateRamp } from "@/lib/overview-metrics";
import {
  CHART_GOLD_PULSE,
  CHART_GOLD_PULSE_TRANSITION,
  CHART_GOLD_PULSE_UNDERLAY,
} from "@/lib/chart-gold-pulse";
import { PanelCard } from "@/components/overview/PanelCard";
import { CATEGORY_NAME, LegendDot } from "@/components/overview/MetricTable";
import { cn, formatNumber } from "@/lib/utils";
import { RowHighlight } from "@/components/ui/RowHighlight";
import { useNarrowViewport } from "@/lib/use-narrow-viewport";
import {
  OVERVIEW_BAR_GAP,
  OVERVIEW_BAR_GAP_NARROW,
  OVERVIEW_BAR_W,
  OVERVIEW_BAR_W_NARROW,
} from "@/lib/overview-bars";

/** Which series the toggle has picked out. Both bars are always drawn — the
 * two have opposite shapes (Bulker is 55% of the depositors and 2.7% of the
 * money), so showing only one at a time hid exactly the comparison this
 * chart exists to make. The toggle instead decides which of the pair reads
 * at full strength and which steps back to a dim outline, and which side of
 * the axis its own numbers describe. */
type Metric = "count" | "value";

/** Splits "Bulker ($100-1K)" into its name and its range. The range is
 * authored alongside the label in overview-metrics, so this only has to
 * handle that one shape. Brackets are dropped — they were punctuation for
 * text tucked in beside a name, and both halves have their own column now. */
function splitLabel(label: string): { name: string; range: string } {
  const match = label.match(/^(.*?)\s*\((.*)\)$/);
  return match ? { name: match[1], range: match[2] } : { name: label, range: "" };
}

/** A tier with wallets in it never reads as 0.0%: 19 Megalodons out of 55,912
 *  holders is 0.03%, which rounds to a zero the row plainly contradicts. */
function formatShare(pct: number): string {
  if (pct > 0 && pct < 0.05) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

function auraCompact(value: number): string {
  if (!(value > 0)) return "0";
  return formatNumber(value);
}

function auraExact(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** Type scale — Familjen labels/names, Overpass Mono data cells. */
const HEADING = "font-label text-text-muted";
const CELL = "font-data";
/** The name column is capped at 180 so a wide viewport doesn't strand
 * "Megalodon" hundreds of pixels from its own row of figures — that was the
 * old bug this column existed to avoid. The five numeric ones are fixed to
 * their own content instead of sharing 1fr/0.7fr of whatever's left: letting
 * them stretch put "DEPOSITORS" (70px of header) and "AVG" (18px) in
 * same-width boxes, so a right-aligned header text sat close to its neighbour
 * in one column and 60-70px further from it in the next — the gap between
 * Size and Depositors read as noticeably tighter than the gap between Share,
 * Deposits and Avg, on the same row. Sized to the widest thing each column
 * actually holds, header or data — measured in the browser, same as
 * MetricTable's columns — that slack mostly disappears, because there's
 * almost nothing left over for a right-aligned value to float inside.
 *
 * The gap is fluid for the same reason MetricTable's is: on a viewport wide
 * enough that six content-fit columns don't need all the room this panel's
 * table has, the extra goes into breathing room between every column
 * equally, not into stretching whichever column happened to be flexible.
 *
 * That holds at xl, where this card is the narrow right half of the row.
 * Below xl the cards stack and this one runs the full width of the page, and
 * ~500px of content-fit columns left the whole right half of the table empty
 * — so there the columns share the width instead, the name column a bit
 * more than the figures. */
const TABLE_COLS =
  "grid grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))] xl:grid-cols-[minmax(0,180px)_minmax(0,74px)_minmax(0,44px)_minmax(0,64px)_minmax(0,84px)_minmax(0,56px)] items-center [column-gap:clamp(16px,2.5vw,36px)]";
const TABLE_COLS_NARROW =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,72px)_minmax(0,52px)] items-center gap-x-3";

/** Every body row, in both the table AND the chart, is this tall. Bumped
 * from 26 alongside the rest of the chart's own numbers (BAR_W, the width
 * bounds below) — bigger rows make a bigger chart AND a bigger table, since
 * both are paced off this one constant, so the two grow together instead of
 * drifting back out of step.
 *
 * The two used to keep separate rhythms — the table paced itself in its own
 * rows, the chart drew its own reference lines at even fractions of
 * whatever height it happened to be given — and side by side that read as
 * two unrelated grids stacked on one panel, each with lines at its own
 * unrelated heights. Driving both from this one number is what makes them
 * one grid instead of two: every line the chart draws sits at a multiple of
 * ROW_H, which is exactly where a table row boundary also falls. */
const ROW_H = 34;

/** The table's header — TIER / SIZE / DEPOSITORS … — and the chart's own
 * blank space above its bars share this exact height too, for the same
 * reason: it puts the first shared gridline (the header's bottom rule) at
 * the same y on both sides, rather than wherever each one's own padding
 * happened to add up to. */
const HEAD_H = 30;

/** Both bars sit in every tier's slot at once, side by side with a hairline
 * between them, so the pair reads as one object — the two readings of a
 * single tier — rather than two unrelated bars that happen to be adjacent. */
const BAR_W = OVERVIEW_BAR_W;
const BAR_GAP = OVERVIEW_BAR_GAP;
/** Only for a tier that really is empty — anything with wallets in it gets a
 * height off the scale below, which never rounds to nothing. */
const MIN_BAR_PCT = 1.2;

/** Width of the axis gutter on the chart's left — one line of digits
 * ("7,591", "$13.13M") right-aligned with 8px clear of the first bar. Static
 * rather than measured: the labels are short, fixed-format numbers, not
 * arbitrary text, so a number sized to the widest plausible one of them
 * covers every real value without needing to watch the DOM for it.
 *
 * 54, not the 44 this was: Value's top label runs to a full "$13.13M", 45px
 * of text that needs 53 with its 8px of clearance. At 44 it simply overran
 * the gutter to the left — invisible while the chart carried a wide left
 * margin, which had room to spare for it to bleed into, but the moment the
 * chart went flush with the card's padding that overrun poked out past the
 * card's own left edge. */
const Y_AXIS_W = 54;

/** Nudge that drops the X-axis ranges onto the tier rows' own baseline.
 *
 * Centring the two boxes is not enough: this row's labels are 11px on
 * `leading-none`, so their line box IS the type, while a tier row's cells are
 * 13px on the default 1.5 line-height. Two boxes of the same height, centred
 * on the same y, still sit their text on baselines 1.75px apart — measured,
 * not derived — and the ranges read as riding above the row beside them.
 * Applied as a transform so the row keeps its exact ROW_H in the layout. */
const X_LABEL_BASELINE_NUDGE = 1.75;

/**
 * Bar height as a fraction of the tallest bar, on a square-root scale.
 *
 * The shares here span 55.4% down to 0.2% — a factor of 277. Drawn straight,
 * the two tiers that hold most of the money were 2.5px and 1.5px tall and
 * simply could not be seen. Square root pulls that range into a factor of 17,
 * which puts them at 22px and 11px: visible, and still four times apart, which
 * is what they actually are.
 *
 * A minimum height was the other option and is worse. It makes every small
 * tier the same size, so Auramaxer and Megalodon would draw identically
 * despite one being 4x the other — the exact fault that got the tier donut
 * replaced by a table in the first place.
 *
 * What it costs: heights are no longer proportional, so a bar twice as tall is
 * four times the share, not twice. Both figures are in the table and the
 * tooltip.
 */
function barHeight(share: number, peak: number): number {
  if (!(share > 0) || !(peak > 0)) return MIN_BAR_PCT;
  return Math.max(MIN_BAR_PCT, (Math.sqrt(share) / Math.sqrt(peak)) * 100);
}

export function DepositorsDistributionPanel({ tiers }: { tiers: DepositTier[] }) {
  const [metric, setMetric] = useState<Metric>("count");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const narrow = useNarrowViewport();
  const barW = narrow ? OVERVIEW_BAR_W_NARROW : BAR_W;
  const barGap = narrow ? OVERVIEW_BAR_GAP_NARROW : BAR_GAP;
  const yAxisW = narrow ? 36 : Y_AXIS_W;
  const tableCols = narrow ? TABLE_COLS_NARROW : TABLE_COLS;

  // The chart and the table are separate cards now, each sized by the page
  // grid, so neither measures the other any more. What still has to be
  // measured is the toggle: it sits in the chart card, above the chart, and
  // the table card needs to reserve exactly that much height or every tier
  // row would sit a toggle's worth higher than the bar it belongs to. Read
  // off the element rather than hardcoded so it can't drift when the control
  // changes size.
  const toggleRowRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const tableRows = useRef<Record<string, HTMLDivElement | null>>({});
  const [toggleRowH, setToggleRowH] = useState(0);

  useEffect(() => {
    const el = toggleRowRef.current;
    if (!el) return;

    // getBoundingClientRect, not offsetHeight: the latter rounds to whole
    // pixels, and the half-pixel it threw away was enough to leave every
    // tier row half a pixel off the bar beside it.
    const measure = () => setToggleRowH(el.getBoundingClientRect().height);
    measure();

    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);

    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  const { rows, peak } = useMemo(() => {
    // Both series are scaled against the single largest share in either of
    // them, not each against its own maximum. Two independent scales would
    // draw Bulker's 55% of people and Megalodon's 38% of the money at the
    // same height, which is the one comparison this chart exists to make.
    // Exposed alongside the rows themselves — the axis below has to invert
    // this same sqrt scale to label it correctly, and needs the number this
    // was computed from to do it.
    const peak = tiers.reduce((max, t) => Math.max(max, t.pct, t.auraPct), 0) || 1;

    const rows = tiers.map((t) => {
      const { name } = splitLabel(t.label);
      return {
        ...t,
        name,
        range: t.auraRange,
        countHeight: barHeight(t.pct, peak),
        valueHeight: barHeight(t.auraPct, peak),
      };
    });

    return { rows, peak };
  }, [tiers]);

  // The six shared gridlines, top to bottom, as the real count or dollar
  // value each one falls at — inverting the sqrt scale the bars themselves
  // are drawn on (see barHeight) rather than dividing the axis evenly in
  // value, which would put it out of step with where the bars actually are.
  //
  // Because that inverse is quadratic, the labels are NOT evenly spaced in
  // value the way a typical axis is — they bunch up low and spread out high,
  // the same compression the bars themselves are drawn under. That is the
  // honest reading of a sqrt-scaled chart: a gridline a fifth of the way up
  // is not a fifth of the peak value, the same way a bar half as tall is not
  // half the share. Labelling it as if it were evenly spaced would be the
  // wrong number at every line but the top and bottom.
  const axisLabels = useMemo(() => {
    const total = tiers.reduce(
      (sum, t) => ({ count: sum.count + t.count, aura: sum.aura + t.aura }),
      { count: 0, aura: 0 }
    );
    const totalForMetric = metric === "count" ? total.count : total.aura;
    return [100, 80, 60, 40, 20, 0].map((fraction) => {
      const value = (peak / 100) * (fraction / 100) ** 2 * totalForMetric;
      return metric === "count"
        ? value >= 1000
          ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
          : Math.round(value).toLocaleString("en-US")
        : auraCompact(value);
    });
  }, [tiers, peak, metric]);

  const hoveredRow = rows.find((r) => r.id === hovered) ?? null;
  // Named apart from hoveredRow only for the tooltip: AnimatePresence keeps
  // the card's last render through its fade-out, so it goes on showing the
  // tier it was on after `hovered` clears.
  const cardRow = hoveredRow;
  const hoveredIndex = hoveredRow ? rows.findIndex((r) => r.id === hoveredRow.id) : -1;
  // Gold highlight always stays on the first tier. Value only flips the
  // companion slate ramp (dull→bright), so the idle gold never jumps right.
  const primaryIndex = 0;
  const primaryId = rows[primaryIndex]?.id;
  const colorAt = (i: number) => {
    if (metric === "count") return rows[i]?.color ?? CHART_GOLD;
    return chartSlateRamp(rows.length - 1 - i, rows.length);
  };
  /** Hovering a non-primary tier: gold leaves the primary and the lit tier
   * takes it — same transfer as the Overview donut. */
  const borrowColor =
    hovered && primaryId && hovered !== primaryId && hoveredIndex >= 0
      ? colorAt(hoveredIndex)
      : null;

  // Plot hover follows the cursor. Table hover parks over that tier's bar —
  // the pointer is in the other card, so the last plot position would leave
  // the card sitting on the wrong column (highlight correct, tooltip not).
  const [hoverSource, setHoverSource] = useState<"plot" | "table" | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [plotSize, setPlotSize] = useState({ w: 0, h: 0 });
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setPlotSize({ w: r.width, h: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [hovered, metric]);

  const half = cardSize.w / 2;
  const barAnchor = (() => {
    if (hoverSource !== "table" || !hoveredRow || hoveredIndex < 0 || plotSize.w <= 0) {
      return null;
    }
    const slotW = plotSize.w / rows.length;
    const pairW = barW * 2 + barGap;
    const pairLeft = hoveredIndex * slotW + (slotW - pairW) / 2;
    const x =
      metric === "count"
        ? pairLeft + barW / 2
        : pairLeft + barW + barGap + barW / 2;
    const heightPct = metric === "count" ? hoveredRow.countHeight : hoveredRow.valueHeight;
    return { x, y: plotSize.h * (1 - heightPct / 100) };
  })();
  const followX = barAnchor?.x ?? pointer.x;
  const followY = barAnchor?.y ?? pointer.y;
  const cardX = Math.min(Math.max(followX, half), Math.max(half, plotSize.w - half));
  const above = followY - cardSize.h - 14;
  const cardY =
    above >= 0
      ? above
      : Math.min(followY + 18, Math.max(0, plotSize.h - cardSize.h));

  /** Dimmed by a selection elsewhere, not by the cursor: hovering brightens
   * its own tier, selecting mutes every other one. */
  const isMuted = (id: string) => selected != null && selected !== id;

  const toggleSelected = (id: string) => setSelected((prev) => (prev === id ? null : id));

  return (
    // Two cards, not one, and no box of their own: `contents` hands both
    // straight to the page grid, which places them — under the TVL curve and
    // the donut at xl, bars beside the donut with the tiers full-width below
    // between lg and xl (see app/page.tsx).
    <div className="contents">
      {/* ------------------------------------------------ chart card */}
      <PanelCard glossy glossDelay={-16}>
      {/* No title, no legend: the colour and the row order already tie a
          bar to its tier — hovering either lights the other — and what each
          bar height means is in the tooltip the moment it's asked for, which
          is a shorter path than reading it off a legend first. The one
          control that stayed is Count/Value, since without it there is no
          way to ask "which of these two series is the one I'm looking at" —
          hovering only explains a single tier at a time, not the whole
          chart. */}
      {/* Left, over the chart it drives — not over the table. Flush with the
          panel's own padding, which is where the chart below and the TVL
          card's Current/Projected toggle above both start, so the three sit
          on one line down the left edge. */}
      <div ref={toggleRowRef} className="flex pb-2">
        {/* Same sliding-pill treatment as the TVL card's Current/Projected
            toggle — a shared border+padding shell with a spring-animated
            accent pill sliding under whichever label is active — so the two
            toggles on this page read as one kind of control. A distinct
            layoutId from that one ("tvl-toggle-pill"): framer-motion
            animates a FROM/TO transition between any two elements sharing an
            id, and both toggles are mounted on the page at once, so sharing
            the id would have this pill leap across the page toward the TVL
            one's position the instant either changed. */}
        <div className="term-seg">
          {(["count", "value"] as const).map((m) => {
            const on = m === metric;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                aria-pressed={on}
                className={cn("term-seg-btn", on ? "is-on" : "is-off")}
              >
                {on && (
                  <motion.span
                    layoutId="deposit-metric-toggle-pill"
                    className="term-seg-pill"
                    transition={{ type: "spring", stiffness: 480, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{m === "count" ? "Count" : "Aura"}</span>
              </button>
            );
          })}
        </div>
      </div>

        {/* Fills its own card now rather than being measured against the
            table's width — the card itself is what the page grid sizes, so
            the chart simply takes it. The bars stay at BAR_W whatever that
            comes to; the extra width a wide viewport brings goes into the
            space between tier groups, not into fatter bars. */}
        <div className="flex w-full min-h-0 flex-1 flex-col">
          {/* Blank, at the table header's own height — see HEAD_H. Its only
              job is to put the chart's first gridline at the same y as the
              header's bottom rule. */}
          <div style={{ height: HEAD_H }} aria-hidden="true" />

          {/* Five rows tall, not six — the sixth is handed to the range
              labels below instead of tacked on past the table's own bottom.
              A bar this tall (100%) tops out exactly at the header's rule
              and never higher, which is what keeps the chart from
              overrunning the "Tier" level above it. */}
          <div className="relative" style={{ height: ROW_H * 5 }}>
            {/* The axis gutter. Six labels, each pinned to the exact y its
                gridline sits at (i * height / 5, the same arithmetic the
                gridlines below are laid out with) rather than left to a
                second `justify-between` guessing at it independently — text
                has real line-height where the gridlines are borders on a
                zero-height div, so two separately-distributed flex columns
                would not necessarily land on the same y at all. */}
            <div
              className="pointer-events-none absolute inset-y-0 left-0"
              style={{ width: yAxisW }}
            >
              {axisLabels.map((label, i) => (
                <span
                  key={i}
                  // IBM Plex Sans, 11px, text-secondary — matches the TVL
                  // chart's own Y-axis labels exactly. HeroTvlChart's source
                  // declares fontSize 10.5 and fill var(--t-text-muted) on
                  // its YAxis ticks, but globals.css's
                  // `.recharts-text { fill: var(--color-text-secondary) !important;
                  // font-size: 11px !important }` overrides both on any tick
                  // recharts renders through its own Text component (the
                  // YAxis, unlike the X-axis's custom tick component, goes
                  // through that path) — so 11px / text-secondary, not
                  // 10.5px / text-muted, is what actually renders. Matched
                  // here literally since this panel isn't recharts and gets
                  // no such override.
                  className="font-data absolute right-2 -translate-y-1/2 whitespace-nowrap text-[11px] leading-none text-text-secondary"
                  style={{ top: (i * (ROW_H * 5)) / 5 }}
                >
                  {label}
                </span>
              ))}
            </div>

            {/* Everything else — gridlines, bars, the tooltip — inset by the
                gutter's width, in its own containing block so their existing
                percentage-of-width math (the tooltip's left offset, the
                bars' flex-1 slots) still divides the space they actually
                have rather than the axis labels' width too. */}
            <div
              ref={plotRef}
              className="absolute inset-y-0"
              style={{ left: yAxisW, right: 0 }}
              onMouseMove={(e) => {
                const el = plotRef.current;
                if (!el) return;
                const r = el.getBoundingClientRect();
                setPointer({ x: e.clientX - r.left, y: e.clientY - r.top });
                setPlotSize({ w: r.width, h: r.height });
              }}
            >
              {/* The shared grid itself: five lines, each one ROW_H apart,
                  which is what a 6-row table divides into internally (the
                  header's own rule is the first shared line, drawn on the
                  table side — see the header below). No line below the fifth
                  row here: that band belongs to the range labels, not a bar. */}
              <div
                className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between"
                style={{ height: ROW_H * 5 }}
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="border-t border-dashed border-[var(--color-line-soft)]" />
                ))}
              </div>

              {/* Both series, every tier, always — the toggle changes which
                  one is highlighted, not which one is drawn. Highlighting is
                  a solid-vs-outline SWAP, not a shared opacity dip: giving
                  the inactive bar a flat opacity multiplier still left it
                  reading as "the same bar, dimmer" — because it never
                  stopped being a solid fill, it just got fainter along with
                  its neighbour, so the pair changed brightness together
                  instead of trading places. Toggling now swaps which one of
                  the two is drawn solid (bright fill, no border) and which is
                  drawn as an outline (a faint tint, coloured border) — the
                  same two treatments as before, just no longer nailed to
                  "count is always solid." Both bars keep a border at all
                  times (transparent on the solid one) so swapping doesn't
                  shift either by the width of the border toggling on and
                  off. */}
              <div className="absolute inset-0 flex items-end">
                {rows.map((row, i) => {
                  const muted = isMuted(row.id);
                  const countActive = metric === "count";
                  const isHovered = hovered === row.id;
                  const isPrimary = i === primaryIndex;
                  const baseColor =
                    isPrimary ? (borrowColor ?? CHART_GOLD) : colorAt(i);
                  const dimOthers = hovered != null && !isHovered;
                  // Only the series the toggle is showing solid takes the
                  // highlight. Lighting both bars of the pair made the hover
                  // read as "this tier", when what it marks is the one figure
                  // the toggle has picked out — the outline landed on the
                  // faint companion bar just as brightly as on the answer.
                  const countLit = isHovered && countActive;
                  const valueLit = isHovered && !countActive;
                  return (
                    <div
                      key={row.id}
                      onMouseEnter={() => {
                        setHovered(row.id);
                        setHoverSource("plot");
                      }}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => toggleSelected(row.id)}
                      className="flex h-full flex-1 cursor-pointer items-end justify-center transition-opacity duration-250"
                      style={{
                        gap: barGap,
                        opacity: muted ? 0.22 : dimOthers ? 0.4 : 1,
                      }}
                    >
                      {/* Depositors — solid while Count is active, an
                          outline of the same colour otherwise. Primary beds
                          on slate while pulsing so gold↔gray reads, not gold↔gold. */}
                      {/* Depositors, then Deposits — each drawn solid while
                          the toggle shows it and as an outline otherwise. */}
                      <TierBar
                        width={barW}
                        height={row.countHeight}
                        solid={countActive}
                        lit={countLit}
                        color={baseColor}
                        restColor={isPrimary ? CHART_GOLD : row.color}
                      />
                      <TierBar
                        width={barW}
                        height={row.valueHeight}
                        solid={!countActive}
                        lit={valueLit}
                        color={baseColor}
                        restColor={isPrimary ? CHART_GOLD : row.color}
                      />
                    </div>
                  );
                })}
              </div>

            <AnimatePresence>
            {cardRow && (
              <motion.div
                key="tier-card"
                className="pointer-events-none absolute left-0 top-0 z-20"
                // Spring, not a linear move: the card lags the cursor a beat
                // and settles, which is what reads as gliding rather than
                // being dragged. It starts at the pointer, not the plot's
                // corner, and fades in and out there instead of popping.
                initial={{ x: cardX, y: cardY, opacity: 0 }}
                animate={{ x: cardX, y: cardY, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 26,
                  mass: 0.5,
                  opacity: { duration: 0.18, ease: "easeOut" },
                }}
              >
                <div
                  ref={cardRef}
                  className="-translate-x-1/2 rounded-[4px] border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-3 py-2.5 shadow-[0_14px_36px_rgba(0,0,0,.55)]"
                >
                  {/* Tier name alone, centred. The size band it used to carry
                      is the same string the table's own SIZE column shows for
                      this row a few inches away, and the range labels under
                      the bars repeat it a third time. */}
                  <div className="mb-2 whitespace-nowrap text-center font-sans text-[13px] font-medium leading-none text-[var(--t-text-primary)]">
                    {cardRow.name}
                  </div>
                  {/* Only the pair the active toggle actually explains: Count
                      means "how many, what share of depositors" and stops
                      there — Deposits and Avg are a different metric's
                      answer, not a supporting detail for this one. Value flips
                      that: Deposits and its share of TVL, plus what that
                      averages to per
                      wallet, with the depositor count dropped since a $
                      reading doesn't need a headcount attached to it.

                      Label and value are separate grid columns rather than one
                      run of text: that is what stacks the numbers under each
                      other instead of starting each one wherever its own label
                      happened to end. */}
                  <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-[6px] whitespace-nowrap leading-none">
                    {(metric === "count"
                      ? ([
                          ["Wallets", cardRow.count.toLocaleString("en-US")],
                          ["Share", formatShare(cardRow.pct)],
                        ] as const)
                      : ([
                          ["Total Aura", auraCompact(cardRow.aura)],
                          ["Share", formatShare(cardRow.auraPct)],
                          ["Avg", auraExact(cardRow.avgAura)],
                        ] as const)
                    ).map(([label, value]) => (
                      <Fragment key={label}>
                        <span className="font-label text-text-muted">{label}</span>
                        <span className="font-data text-right text-[var(--t-accent)]">{value}</span>
                      </Fragment>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
            </div>
          </div>

          {/* Exclusive Aura bands — two lines so `10000-100000 AURA` fits
              the column. paddingLeft matches the axis gutter above. */}
          <div
            className="flex shrink-0 items-center"
            style={{
              height: ROW_H,
              paddingLeft: yAxisW,
              transform: `translateY(${X_LABEL_BASELINE_NUDGE}px)`,
            }}
          >
            {rows.map((row) => {
              const band = row.range.replace(/\s+AURA$/i, "");
              return (
              <div
                key={row.id}
                className="min-w-0 flex-1 text-center transition-opacity"
                style={{ opacity: isMuted(row.id) ? 0.22 : 1 }}
              >
                <div className="px-0.5 text-center text-[10px] leading-[1.15] tabular-nums text-text-secondary sm:text-[11px]">
                  <span className="block">{band}</span>
                  <span className="block">AURA</span>
                </div>
              </div>
              );
            })}
          </div>
        </div>

      </PanelCard>

      {/* ------------------------------------------------ table card */}
      {/* A different gloss delay from the chart card's, so the two drift out
          of step with each other rather than lighting up in unison. */}
      <PanelCard className="lg:col-span-2 xl:col-span-1">
        {/* Reserves exactly the height of the toggle sitting in the card
            beside this one. Without it the table's header rule — and every
            tier row under it — would ride a toggle's worth higher than the
            bar it belongs to, and the two cards would stop reading as one
            object split in half. Only at xl: below that the cards stack,
            where there is nothing to line up against and this would just be
            unexplained padding at the top of the card. */}
        <div aria-hidden="true" className="hidden xl:block" style={{ height: toggleRowH }} />
        {/* At xl TABLE_COLS' columns are fixed to their own content (see its
            comment), so the table sits at the start of its card and leaves the
            slack on the right. Stacked below xl they share the full width. */}
        <div ref={tableRef} className="relative isolate flex min-w-0 flex-col">
          {/* Follows the cursor first and the pinned tier otherwise, sliding
              between rows rather than redrawing on each one. */}
          <RowHighlight
            containerRef={tableRef}
            target={tableRows.current[hovered ?? selected ?? ""] ?? null}
          />
          <div
            className={cn(
              tableCols,
              HEADING,
              "-mx-2.5 border-b border-[var(--color-line)] px-2.5"
            )}
            style={{ height: HEAD_H }}
          >
            <span className="pl-[17px] text-left">Tier</span>
            {narrow && metric === "value" ? (
              <>
                <span className="text-right">Total Aura</span>
                <span className="text-right">Avg</span>
              </>
            ) : (
              <>
                <span className="text-right">Wallets</span>
                <span className="text-right">Share</span>
              </>
            )}
            {!narrow && <span className="text-right">Aura</span>}
            {!narrow && <span className="text-right">Total Aura</span>}
            {!narrow && <span className="text-right">Avg</span>}
          </div>

          {rows.map((row, i) => {
            const muted = isMuted(row.id);
            const lit = hovered === row.id || selected === row.id;
            // Dim every non-active row — including the primary tier (gold
            // transfer used to leave Snowflake fully lit).
            const dimmed = muted || (hovered != null && !lit);
            const color = dimmed ? "var(--t-text-dim)" : "var(--t-text-primary)";
            return (
              <div
                key={row.id}
                ref={(el) => {
                  tableRows.current[row.id] = el;
                }}
                onMouseEnter={() => {
                  setHovered(row.id);
                  setHoverSource("table");
                  const el = plotRef.current;
                  if (!el) return;
                  const r = el.getBoundingClientRect();
                  setPlotSize({ w: r.width, h: r.height });
                }}
                onMouseLeave={() => setHovered(null)}
                onClick={() => toggleSelected(row.id)}
                className={cn(
                  tableCols,
                  // Same always-on inset as MetricTableRow, so the highlight
                  // box that takes this row's bounds clears the scaled bullet.
                  "-mx-2.5 shrink-0 cursor-pointer px-2.5 transition-colors select-none [-webkit-touch-callout:none]",
                  i > 0 && "border-t border-[var(--color-line-soft)]",
                  lit && i > 0 && "border-transparent"
                )}
                style={{ height: ROW_H }}
              >
                <span className={cn("flex min-w-0 items-center gap-2", CATEGORY_NAME)} style={{ color }}>
                  <LegendDot
                    color={
                      lit
                        ? CHART_GOLD
                        : i === primaryIndex && borrowColor
                          ? borrowColor
                          : colorAt(i)
                    }
                    restColor={colorAt(i)}
                    active={lit}
                    pulse={lit}
                    dimmed={dimmed}
                  />
                  <span className="truncate">{row.name}</span>
                </span>
                {narrow && metric === "value" ? (
                  <>
                    <span className={cn(CELL, "text-right")} style={{ color }}>
                      {auraCompact(row.aura)}
                    </span>
                    <span
                      className={cn(CELL, "text-right")}
                      style={{ color: muted ? "var(--t-text-dim)" : "var(--t-text-secondary)" }}
                    >
                      {auraCompact(row.avgAura)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={cn(CELL, "text-right")} style={{ color }}>
                      {row.count.toLocaleString("en-US")}
                    </span>
                    <span className={cn(CELL, "text-right font-semibold")} style={{ color }}>
                      {formatShare(row.pct)}
                    </span>
                  </>
                )}
                {!narrow && (
                  <span className={cn(CELL, "text-right")} style={{ color }}>
                    {row.range}
                  </span>
                )}
                {!narrow && (
                  <span className={cn(CELL, "text-right")} style={{ color }}>
                    {auraCompact(row.aura)}
                  </span>
                )}
                {!narrow && (
                  <span
                    className={cn(CELL, "text-right")}
                    style={{ color: muted ? "var(--t-text-dim)" : "var(--t-text-secondary)" }}
                  >
                    {auraCompact(row.avgAura)}
                  </span>
                )}
              </div>
            );
          })}

          {selected && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ghost-pill shrink-0 cursor-pointer px-2.5 py-[3px] text-[11px]"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>
      </PanelCard>
    </div>
  );
}

const BAR_EASE = "300ms cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * One bar of a tier's pair, drawn the same way whatever state it's in.
 *
 * The lit bar used to be a different element from the plain one it replaced,
 * so moving along the chart dropped the gold on one bar and picked it up on
 * the next in a single frame. Kept as one set of nodes, the colour, outline
 * and glow ease across with CSS transitions (the colours are CSS variables,
 * which only the browser can interpolate), the same hand-off as the donut and
 * the legend swatches.
 *
 * Lit, the fill turns gold and its opacity breathes over a bed in the bar's
 * resting colour — slate for a bar that rests gold, so the beat reads
 * gold↔slate rather than gold↔gold. Both bars keep a border at all times
 * (transparent on the solid one) so switching treatments never shifts either
 * by the border's width.
 */
function TierBar({
  width,
  height,
  solid,
  lit,
  color,
  restColor,
}: {
  width: number;
  /** Percent of the plot's height. */
  height: number;
  /** The series the toggle is showing: solid fill, no border. Otherwise an
   * outline — a faint tint with a coloured border. */
  solid: boolean;
  lit: boolean;
  color: string;
  restColor: string;
}) {
  const fill = lit
    ? CHART_GOLD
    : solid
      ? color
      : `color-mix(in srgb, ${color} 55%, transparent)`;
  const border =
    lit || solid ? "transparent" : `color-mix(in srgb, ${color} 85%, transparent)`;
  return (
    <div
      className="relative"
      style={{ width, height: `${height}%`, transition: `height ${BAR_EASE}` }}
    >
      <div
        className="absolute inset-0 rounded-t-[2px]"
        style={{
          background: restColor === CHART_GOLD ? CHART_GOLD_PULSE_UNDERLAY : restColor,
          opacity: lit ? 1 : 0,
          transition: `opacity ${BAR_EASE}`,
        }}
      />
      <motion.div
        className="absolute inset-0 rounded-t-[2px] border-[0.5px]"
        initial={false}
        animate={lit ? CHART_GOLD_PULSE : { opacity: 1 }}
        transition={lit ? CHART_GOLD_PULSE_TRANSITION : { duration: 0.3 }}
        style={{
          backgroundColor: fill,
          borderColor: border,
          outline: `1px solid ${lit ? "var(--t-text-primary)" : "transparent"}`,
          filter: lit
            ? "drop-shadow(0 0 4px rgb(var(--t-accent-rgb) / 0.28))"
            : "drop-shadow(0 0 4px rgb(var(--t-accent-rgb) / 0))",
          transition: `background-color ${BAR_EASE}, border-color ${BAR_EASE}, outline-color ${BAR_EASE}, filter ${BAR_EASE}`,
        }}
      />
    </div>
  );
}
