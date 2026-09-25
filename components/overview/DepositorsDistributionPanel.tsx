"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  type MotionValue,
} from "framer-motion";
import type { DepositTier } from "@/lib/overview-metrics";
import { CHART_GOLD, chartSlateRamp } from "@/lib/overview-metrics";
import { MARK_EASE, heldFill, pulseBed, pulseMotion } from "@/lib/chart-gold-pulse";
import { PanelCard } from "@/components/overview/PanelCard";
import { SegmentedToggle } from "@/components/overview/SegmentedToggle";
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

const METRIC_OPTIONS = [
  { value: "count", label: "Count" },
  { value: "value", label: "Aura" },
] as const;

/** Enter / Space on a `role="button"` element, as a native button would. */
function onPressKey(e: KeyboardEvent, action: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}

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
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
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

  const hoveredIndex = rows.findIndex((r) => r.id === hovered);
  const hoveredRow = hoveredIndex >= 0 ? rows[hoveredIndex] : null;
  const litIndex = hoveredIndex >= 0 ? hoveredIndex : null;
  // Gold rests on the first tier in both modes. Count gives the rest their
  // own ramp colours; Aura flips them to the reversed slate ramp. One source
  // for the bars, their pulse beds and the table's dots.
  const restColorAt = (i: number) =>
    i === 0
      ? CHART_GOLD
      : metric === "count"
        ? rows[i].color
        : chartSlateRamp(rows.length - 1 - i, rows.length);

  // Pointer hover follows the cursor. Hover from the table (or keyboard
  // focus) parks the tooltip over that tier's bar instead — the pointer is
  // elsewhere, so its last plot position would be the wrong column.
  const [anchored, setAnchored] = useState(false);
  const plotRef = useRef<HTMLDivElement | null>(null);
  // Motion values, not state: the tooltip follows the cursor without
  // re-rendering the panel on every mousemove.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const [plotSize, setPlotSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setPlotSize({ w: r.width, h: r.height });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const barAnchor = (() => {
    if (!anchored || !hoveredRow || plotSize.w <= 0) return null;
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

  /** Dimmed by a selection elsewhere, not by the cursor: hovering brightens
   * its own tier, selecting mutes every other one. */
  const isMuted = (id: string) => selected != null && selected !== id;

  const toggleSelected = (id: string) => setSelected((prev) => (prev === id ? null : id));
  const hoverTier = (id: string, anchor: boolean) => {
    setHovered(id);
    setAnchored(anchor);
  };

  return (
    // Two cards, not one, and no box of their own: `contents` hands both
    // straight to the page grid, which places them — under the Volume chart
    // and the donut at xl, bars beside the donut with the tiers full-width
    // below between lg and xl (see app/page.tsx).
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
      {/* Left, over the chart it drives — not over the table. */}
      <div ref={toggleRowRef} className="flex pb-2">
        <SegmentedToggle
          options={METRIC_OPTIONS}
          value={metric}
          onChange={setMetric}
          layoutId="deposit-metric-toggle-pill"
        />
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
                  // 11px / text-secondary: what globals.css's `.recharts-text`
                  // override renders on Recharts axes, matched by hand since
                  // this panel isn't Recharts.
                  className="font-data absolute right-2 -translate-y-1/2 whitespace-nowrap text-[11px] leading-none text-text-secondary"
                  style={{ top: i * ROW_H }}
                >
                  {label}
                </span>
              ))}
            </div>

            {/* Everything else — gridlines, bars, the tooltip — inset by the
                gutter's width, in its own containing block so the bars'
                flex-1 slots and the tooltip's clamping divide the plot's
                width, not the axis labels' too. */}

            <div
              ref={plotRef}
              className="absolute inset-y-0"
              style={{ left: yAxisW, right: 0 }}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                pointerX.set(e.clientX - r.left);
                pointerY.set(e.clientY - r.top);
              }}
            >
              {/* The shared grid itself: six lines, ROW_H apart, from the
                  header's rule down to the bottom of the fifth row. The band
                  below belongs to the range labels, not a bar. */}
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
                  const color = heldFill(i, litIndex, restColorAt);
                  const bed = pulseBed(restColorAt(i));
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
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected === row.id}
                      aria-label={`Filter to ${row.name} tier`}
                      onMouseEnter={() => hoverTier(row.id, false)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={(e) => {
                        if (e.currentTarget.matches(":focus-visible")) hoverTier(row.id, true);
                      }}
                      onBlur={() => setHovered(null)}
                      onClick={() => toggleSelected(row.id)}
                      onKeyDown={(e) => onPressKey(e, () => toggleSelected(row.id))}
                      className="flex h-full flex-1 cursor-pointer items-end justify-center transition-opacity duration-250"
                      style={{
                        gap: barGap,
                        opacity: muted ? 0.22 : dimOthers ? 0.4 : 1,
                      }}
                    >
                      {/* Depositors, then Aura — each drawn solid while the
                          toggle shows it and as an outline otherwise. */}
                      <TierBar
                        width={barW}
                        height={row.countHeight}
                        solid={countActive}
                        lit={countLit}
                        color={color}
                        bed={bed}
                      />
                      <TierBar
                        width={barW}
                        height={row.valueHeight}
                        solid={!countActive}
                        lit={valueLit}
                        color={color}
                        bed={bed}
                      />
                    </div>
                  );
                })}
              </div>

            {/* AnimatePresence keeps the card's last props through its
                fade-out, so it goes on showing the tier it was on. */}
            <AnimatePresence>
              {hoveredRow && (
                <TierTooltip
                  key="tier-card"
                  row={hoveredRow}
                  metric={metric}
                  pointerX={pointerX}
                  pointerY={pointerY}
                  anchorX={barAnchor?.x ?? null}
                  anchorY={barAnchor?.y ?? null}
                  plotW={plotSize.w}
                  plotH={plotSize.h}
                />
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
                role="button"
                tabIndex={0}
                aria-pressed={selected === row.id}
                onMouseEnter={() => hoverTier(row.id, true)}
                onMouseLeave={() => setHovered(null)}
                onFocus={(e) => {
                  if (e.currentTarget.matches(":focus-visible")) hoverTier(row.id, true);
                }}
                onBlur={() => setHovered(null)}
                onClick={() => toggleSelected(row.id)}
                onKeyDown={(e) => onPressKey(e, () => toggleSelected(row.id))}
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
                    color={lit ? CHART_GOLD : heldFill(i, litIndex, restColorAt)}
                    restColor={restColorAt(i)}
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

/** Spring the tooltip glides after the cursor on: it lags a beat and
 * settles rather than being dragged. */
const CARD_SPRING = { stiffness: 300, damping: 26, mass: 0.5 };

/**
 * The hover card over the plot. Positioned from motion values, so following
 * the cursor re-renders nothing; re-placed after every render too, since a
 * new tier or metric changes the card's own size. Clamped to the plot, and
 * flipped under the point when there's no room above it.
 */
function TierTooltip({
  row,
  metric,
  pointerX,
  pointerY,
  anchorX,
  anchorY,
  plotW,
  plotH,
}: {
  row: DepositTier & { name: string };
  metric: Metric;
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  /** Fixed point to sit over instead of the pointer (table / keyboard hover). */
  anchorX: number | null;
  anchorY: number | null;
  plotW: number;
  plotH: number;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const x = useSpring(0, CARD_SPRING);
  const y = useSpring(0, CARD_SPRING);
  const placed = useRef(false);

  const place = () => {
    const card = cardRef.current;
    if (!card) return;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const fx = anchorX ?? pointerX.get();
    const fy = anchorY ?? pointerY.get();
    const half = w / 2;
    const nx = Math.min(Math.max(fx, half), Math.max(half, plotW - half));
    const above = fy - h - 14;
    const ny = above >= 0 ? above : Math.min(fy + 18, Math.max(0, plotH - h));
    // First placement jumps, so the card fades in where it lands.
    if (placed.current) {
      x.set(nx);
      y.set(ny);
    } else {
      x.jump(nx);
      y.jump(ny);
      placed.current = true;
    }
  };

  useLayoutEffect(() => place());
  useMotionValueEvent(pointerX, "change", place);
  useMotionValueEvent(pointerY, "change", place);

  // Only the figures the active toggle explains: Count is how many and what
  // share of depositors; Aura is the tier's total, its share and the average.
  const figures =
    metric === "count"
      ? ([
          ["Wallets", row.count.toLocaleString("en-US")],
          ["Share", formatShare(row.pct)],
        ] as const)
      : ([
          ["Total Aura", auraCompact(row.aura)],
          ["Share", formatShare(row.auraPct)],
          ["Avg", auraExact(row.avgAura)],
        ] as const);

  return (
    <motion.div
      className="pointer-events-none absolute left-0 top-0 z-20"
      style={{ x, y }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <div
        ref={cardRef}
        className="-translate-x-1/2 rounded-[4px] border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-3 py-2.5 shadow-[0_14px_36px_rgba(0,0,0,.55)]"
      >
        <div className="mb-2 whitespace-nowrap text-center font-sans text-[13px] font-medium leading-none text-[var(--t-text-primary)]">
          {row.name}
        </div>
        {/* Separate grid columns so the values stack under each other. */}
        <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-[6px] whitespace-nowrap leading-none">
          {figures.map(([label, value]) => (
            <Fragment key={label}>
              <span className="font-label text-text-muted">{label}</span>
              <span className="font-data text-right text-[var(--t-accent)]">{value}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * One bar of a tier's pair, drawn the same way whatever state it's in, so
 * the colour, outline and glow ease across with CSS transitions as the gold
 * hands over. Lit, the fill turns gold and breathes over `bed`. Both bars
 * keep a border at all times (transparent on the solid one) so switching
 * treatments never shifts either by the border's width.
 */
function TierBar({
  width,
  height,
  solid,
  lit,
  color,
  bed,
}: {
  width: number;
  /** Percent of the plot's height. */
  height: number;
  /** The series the toggle is showing: solid fill, no border. Otherwise an
   * outline — a faint tint with a coloured border. */
  solid: boolean;
  lit: boolean;
  /** Colour while not lit (see `heldFill`). */
  color: string;
  /** What the pulse breathes over (see `pulseBed`). */
  bed: string;
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
      style={{ width, height: `${height}%`, transition: `height ${MARK_EASE}` }}
    >
      <div
        className="absolute inset-0 rounded-t-[2px]"
        style={{
          background: bed,
          opacity: lit ? 1 : 0,
          transition: `opacity ${MARK_EASE}`,
        }}
      />
      <motion.div
        className="absolute inset-0 rounded-t-[2px] border-[0.5px]"
        {...pulseMotion(lit)}
        style={{
          backgroundColor: fill,
          borderColor: border,
          outline: `1px solid ${lit ? "var(--t-text-primary)" : "transparent"}`,
          filter: lit
            ? "drop-shadow(0 0 4px rgb(var(--t-accent-rgb) / 0.28))"
            : "drop-shadow(0 0 4px rgb(var(--t-accent-rgb) / 0))",
          transition: `background-color ${MARK_EASE}, border-color ${MARK_EASE}, outline-color ${MARK_EASE}, filter ${MARK_EASE}`,

        }}
      />
    </div>
  );
}
