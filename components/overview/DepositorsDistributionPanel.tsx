"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import { MARK_EASE, pulseMotion } from "@/lib/chart-gold-pulse";
import { PanelCard } from "@/components/overview/PanelCard";
import { SegmentedToggle } from "@/components/overview/SegmentedToggle";
import { CATEGORY_NAME } from "@/components/overview/MetricTable";
import { cn, formatNumber } from "@/lib/utils";
import { RowHighlight } from "@/components/ui/RowHighlight";
import { useNarrowViewport } from "@/lib/use-narrow-viewport";
import { OVERVIEW_BAR_W, OVERVIEW_BAR_W_NARROW } from "@/lib/overview-bars";

/** Which series the bars show. One bar per rank, the toggle swapping its
 * height between the two: a pair per rank, one solid and one a faint
 * outline, read as washed out, and flipping the toggle now shows the shift
 * between the two shapes as the bars move. */
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
 * more than the figures.
 *
 * At xl the gap ramps up later (16px at 1280, the full 36 from ~1800). The
 * card is only ~510px wide at 1280, and 2.5vw of gap there left the name
 * column 41px — "Challenger" needs 79 — so the rank names truncated. */
const TABLE_COLS =
  "grid grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))] xl:grid-cols-[minmax(0,180px)_minmax(0,74px)_minmax(0,44px)_minmax(0,64px)_minmax(0,84px)_minmax(0,56px)] items-center [column-gap:clamp(16px,2.5vw,36px)] xl:[column-gap:clamp(16px,calc(4vw_-_36px),36px)]";
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

/** Each rank's badge sits under its bar and over its name, and the name
 * rides the table's last row, level with Challenger beside it. The badge
 * hangs BADGE_OVERHANG into that row, over the name, and the bars stop
 * BADGE_GAP above it: so the bars' floor is lifted BARS_LIFT off the plot's
 * own floor, which the tallest bar pays for at its top. */
const BADGE = 16;
const BADGE_GAP = 6;
const BADGE_OVERHANG = 7;
const BARS_LIFT = BADGE + BADGE_GAP - BADGE_OVERHANG;

/** The table's header — TIER / SIZE / DEPOSITORS … — and the chart's own
 * blank space above its bars share this exact height too, for the same
 * reason: it puts the first shared gridline (the header's bottom rule) at
 * the same y on both sides, rather than wherever each one's own padding
 * happened to add up to. */
const HEAD_H = 30;

/** One bar per rank, twice the Overview's shared bar width: the Volume chart
 * packs two dozen bars, this one seven, and a single 20px bar sat lost in its
 * slot. A multiple of the shared width keeps the two plots one system. */
const BAR_W = OVERVIEW_BAR_W * 2;
const BAR_W_NARROW = OVERVIEW_BAR_W_NARROW * 2;
/** Only for a tier that really is empty — anything with wallets in it gets a
 * height off the scale below, which never rounds to nothing. */
const MIN_BAR_PCT = 1.2;

/** Nudge that drops the X-axis ranges onto the tier rows' own baseline.
 *
 * Centring the two boxes is not enough: this row's labels are 11px on
 * `leading-none`, so their line box IS the type, while a tier row's cells are
 * 13px on the default 1.5 line-height. Two boxes of the same height, centred
 * on the same y, still sit their text on baselines 1.75px apart — measured,
 * not derived — and the ranges read as riding above the row beside them.
 * Applied as a transform so the row keeps its exact ROW_H in the layout. */
const X_LABEL_BASELINE_NUDGE = 1.75;

/** Past this spread between a series' largest and smallest non-zero value a
 *  square root still flattens the small end to the floor, and the series is
 *  drawn on a log scale instead. */
const LOG_SPREAD = 300;

type Scale = (value: number) => number;

/**
 * Bar heights for one series, as percents of its largest value, compressed
 * only as far as its own spread needs.
 *
 * Wallet counts run from 54,980 Unranked down to a single Challenger. Even on
 * a square root every ranked tier sat on the floor under one tower, so a
 * spread like that goes on a log scale, where the ranks step down one after
 * another. Aura totals span about 30x, where a log scale squeezes 34K and
 * 1.1M to three quarters and full height; a square root keeps them apart.
 * Either way a bar with more in it is never shorter, and the exact figure is
 * printed on every bar, so nothing has to be read off the heights.
 */
function seriesScale(values: number[]): Scale {
  const positive = values.filter((v) => v > 0);
  if (!positive.length) return () => MIN_BAR_PCT;
  const max = Math.max(...positive);
  const min = Math.min(...positive);
  const log = max / min > LOG_SPREAD;
  return (value) => {
    if (!(value > 0)) return MIN_BAR_PCT;
    const share = log ? Math.log1p(value) / Math.log1p(max) : Math.sqrt(value / max);
    // Rounded: the server and the browser print a long float differently,
    // which hydration reads as a mismatch.
    return Math.round(Math.max(MIN_BAR_PCT, share * 100) * 100) / 100;
  };
}

export function DepositorsDistributionPanel({ tiers }: { tiers: DepositTier[] }) {
  const [metric, setMetric] = useState<Metric>("count");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const narrow = useNarrowViewport();
  const barW = narrow ? BAR_W_NARROW : BAR_W;
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

  const rows = useMemo(() => {
    const countScale = seriesScale(tiers.map((t) => t.count));
    const auraScale = seriesScale(tiers.map((t) => t.aura));

    const rows = tiers.map((t) => {
      const { name } = splitLabel(t.label);
      return {
        ...t,
        name,
        range: t.auraRange,
        countHeight: countScale(t.count),
        valueHeight: auraScale(t.aura),
      };
    });

    return rows;
  }, [tiers]);

  // The plot takes every table row but the last, which holds the names.
  const plotRows = Math.max(3, rows.length - 1);

  const hoveredIndex = rows.findIndex((r) => r.id === hovered);
  const hoveredRow = hoveredIndex >= 0 ? rows[hoveredIndex] : null;
  // Every rank in its own official colour, in both modes and whether lit or
  // not: the colour names the rank, the way its badge does.
  const rankColor = (id: string) => `var(--t-rank-${id})`;

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
    const x = hoveredIndex * slotW + slotW / 2;
    const heightPct = metric === "count" ? hoveredRow.countHeight : hoveredRow.valueHeight;
    return { x, y: (plotSize.h - BARS_LIFT) * (1 - heightPct / 100) };
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

          {/* One table row shorter than the table: its last row is handed
              to the rank names below, so they sit level with the table's
              last rank rather than a row above it. A bar this tall (100%)
              tops out exactly at the header's rule and never higher. */}
          <div className="relative" style={{ height: ROW_H * plotRows }}>
            {/* No value axis: each bar carries its own figure on top, which
                reads at a glance where a square-root axis (55k, 35k, 20k,
                8.8k...) had to be decoded. */}

            <div
              ref={plotRef}
              className="absolute inset-0"
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                pointerX.set(e.clientX - r.left);
                pointerY.set(e.clientY - r.top);
              }}
            >
              {/* The shared grid itself: a line at every table row boundary,
                  ROW_H apart, from the header's rule down. No line at the
                  plot's floor: the badges sit across it. */}
              {Array.from({ length: plotRows }).map((_, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--color-line-soft)]"
                  style={{ top: i * ROW_H }}
                />
              ))}

              <div className="absolute inset-x-0 top-0 flex items-end" style={{ bottom: BARS_LIFT }}>
                {rows.map((row, i) => {
                  const muted = isMuted(row.id);
                  const isHovered = hovered === row.id;
                  const color = rankColor(row.id);
                  const dimOthers = hovered != null && !isHovered;
                  const figure =
                    metric === "count" ? row.count.toLocaleString("en-US") : auraCompact(row.aura);
                  return (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected === row.id}
                      aria-label={`Filter to ${row.name} rank`}
                      onMouseEnter={() => hoverTier(row.id, false)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={(e) => {
                        if (e.currentTarget.matches(":focus-visible")) hoverTier(row.id, true);
                      }}
                      onBlur={() => setHovered(null)}
                      onClick={() => toggleSelected(row.id)}
                      onKeyDown={(e) => onPressKey(e, () => toggleSelected(row.id))}
                      className="flex h-full flex-1 cursor-pointer items-end justify-center transition-opacity duration-250"
                      style={{ opacity: muted ? 0.22 : dimOthers ? 0.4 : 1 }}
                    >
                      <TierBar
                        width={barW}
                        height={metric === "count" ? row.countHeight : row.valueHeight}
                        lit={isHovered}
                        color={color}
                        figure={figure}
                        // Each bar catches the light a beat after the one to
                        // its left, so the sheen travels across the chart.
                        sheenDelay={i * SHEEN_STEP_S}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Each rank's badge, under its bar. */}
              <div
                className="pointer-events-none absolute inset-x-0 flex"
                style={{ bottom: -BADGE_OVERHANG, height: BADGE }}
              >
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-1 justify-center transition-opacity duration-250"
                    style={{
                      opacity: isMuted(row.id) ? 0.22 : hovered != null && hovered !== row.id ? 0.4 : 1,
                    }}
                  >
                    <RankBadge id={row.id} size={BADGE} />
                  </div>
                ))}
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

          {/* Each rank's name, level with the table's last row; its badge
              hangs just above it, from the plot. */}
          <div
            className="flex shrink-0 items-center"
            style={{
              height: ROW_H,
              transform: `translateY(${X_LABEL_BASELINE_NUDGE}px)`,
            }}
          >
            {rows.map((row) => {
              return (
              <div
                key={row.id}
                className="min-w-0 flex-1 text-center transition-opacity"
                style={{ opacity: isMuted(row.id) ? 0.22 : 1 }}
              >
                {/* The Aura band each rank covers is in the table and the
                    tooltip. */}
                <span className="block whitespace-nowrap px-0.5 text-center font-sans text-[9.5px] font-medium leading-none text-text-secondary sm:text-[11px]">
                  {row.name}
                </span>
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
            <span className="pl-[24px] text-left">Rank</span>
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
                  <RankBadge
                    id={row.id}
                    size={16}
                    className="transition-[transform,opacity] duration-300 ease-out"
                    style={{ transform: lit ? "scale(1.15)" : "scale(1)", opacity: dimmed ? 0.4 : 1 }}
                  />
                  <span className="truncate-safe">{row.name}</span>
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
        className="-translate-x-1/2 rounded-[4px] border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-3 py-2.5 shadow-[var(--t-shadow-pop)]"
      >
        <div className="mb-2 flex items-center justify-center gap-1.5 whitespace-nowrap font-sans text-[13px] font-medium leading-none text-[var(--t-text-primary)]">
          <RankBadge id={row.id} size={16} />
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
 * One rank's bar in the rank's own colour. The height eases when the toggle
 * swaps series; lit, it breathes and glows in its colour. The fill fades
 * toward the baseline for some depth, and the bar's figure rides on top.
 */
function TierBar({
  width,
  height,
  lit,
  color,
  figure,
  sheenDelay,
}: {
  width: number;
  /** Percent of the plot's height. */
  height: number;
  lit: boolean;
  /** The rank's colour. */
  color: string;
  /** The bar's value, printed above it. */
  figure: string;
  /** When in the shared cycle this bar's sheen passes, in seconds. */
  sheenDelay: number;
}) {
  return (
    <div
      className="relative"
      style={{ width, height: `${height}%`, transition: `height ${MARK_EASE}` }}
    >
      <span
        className={cn(
          "font-data absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap text-[11px] leading-none transition-colors duration-300",
          lit ? "text-text-primary" : "text-text-secondary"
        )}
      >
        {figure}
      </span>
      <motion.div
        className="absolute inset-0 overflow-hidden rounded-t-[4px]"
        {...pulseMotion(lit)}
        style={{
          backgroundColor: color,
          maskImage: BAR_FADE,
          WebkitMaskImage: BAR_FADE,
          filter: lit
            ? `drop-shadow(0 0 8px color-mix(in srgb, ${color} 55%, transparent))`
            : `drop-shadow(0 0 8px color-mix(in srgb, ${color} 0%, transparent))`,
          transition: `filter ${MARK_EASE}`,
        }}
      >
        <span className="bar-sheen" aria-hidden style={{ animationDelay: `${sheenDelay}s` }} />
      </motion.div>
    </div>
  );
}

/** Gap between neighbouring bars catching the sheen. */
const SHEEN_STEP_S = 0.12;

/** Full colour down the top half of a bar, easing to under half toward the
 *  baseline. */
const BAR_FADE = "linear-gradient(to bottom, #000 0%, #000 45%, rgb(0 0 0 / 0.45) 100%)";

/** A rank's official badge. Decorative: the rank's name is always beside it
 *  or in the row it sits in. */
function RankBadge({
  id,
  size,
  className,
  style,
}: {
  id: string;
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/ranks/${id}.webp`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size, ...style }}
    />
  );
}
