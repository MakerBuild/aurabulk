"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Pie, PieChart, Sector } from "recharts";
import type { OverviewDonutSegment } from "@/lib/overview-metrics";
import { CHART_GOLD, chartPrimaryRamp } from "@/lib/overview-metrics";
import { MARK_EASE, markFill, pulseBed, pulseMotion } from "@/lib/chart-gold-pulse";
import { cn } from "@/lib/utils";
import { RowHighlight } from "@/components/ui/RowHighlight";
import { useNarrowViewport } from "@/lib/use-narrow-viewport";
import {
  MetricTableHeader,
  MetricTableRow,
  metricTableMinWidth,
  METRIC_TABLE_LEAD_INSET,
} from "@/components/overview/MetricTable";

function compactAura(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  return Math.round(value).toLocaleString("en-US");
}
const SWEEP_MS = 900;
/** 12 o'clock, sweeping clockwise. */
const START_ANGLE = 90;
/** Ring radii as a fraction of the donut box's measured width rather than
 * fixed pixels — the box is sized by the surrounding layout, so deriving the
 * radii from it is what keeps the ring in proportion at any viewport instead
 * of only at the one a hardcoded radius was tuned for. */
const RING_OUTER_RATIO = 0.45;
/** Thinner band than before — leaves a larger hole so the centre figure
 * can sit in proportion with the ring instead of floating in empty space. */
const RING_INNER_RATIO = 0.398;
/** Room so sector strokes never clip the canvas edge. */
const GLOW_HEADROOM = 6;
/** Square well floor for the Aura analytics ring / Category Share chart.
 * Cards stretch above this to fill leftover viewport height. */
export const AURA_SOURCES_DONUT_WELL = 280;

/** Distance from the well's top to the ring's apex — the legend and the
 * bar chart both pad by this so they meet the donut rather than the box. */
export function donutApexInset(well = AURA_SOURCES_DONUT_WELL): number {
  const outerRadius = Math.max(0, Math.min(well * RING_OUTER_RATIO, well / 2 - GLOW_HEADROOM));
  return well / 2 - outerRadius;
}

/** Floor under the ring. Without one it is the only thing in the row sized
 * from the leftover, so on a narrow layout it absorbed the entire shortfall
 * and rendered at 42px — a ring too small to read next to a legend that had
 * taken everything. Below this the legend's own columns give way instead. */
const MIN_RING = 120;
/** Matches the `gap-5` on the row below (20px). */
const ROW_GAP = 20;
/** Keeps sub-pixel rounding in the measured row from tipping the ring's
 * leftover width over by one. */
const ROUNDING_SLACK = 1;
/** Largest ring when the legend stacks under it. */
const STACKED_RING_MAX = 242;
/** Tailwind's xl — where Overview stops stacking its panels (app/page.tsx). */
const XL_BREAKPOINT = 1280;
/** Widest the legend grows in the stacked Overview layout: wide enough to read
 * as a table beside the ring, not so wide that a name sits a screen-width from
 * its figures. */
const SPREAD_LEGEND_MAX = 560;
/** Empty width beside the ring before the legend stops hugging the right edge
 * and the pair centres instead. */
const SPREAD_MIN_SLACK = 200;
/** The side-by-side row clips horizontally, and its legend sits flush with
 * the row's right edge — so the legend rows' 10px highlight bleed (-mx-2.5)
 * was cut off square on the right while the left end, clear of the edge,
 * stayed rounded. The row reaches this far into the card's own padding with
 * a matching inset, which leaves the content where it was but moves the clip
 * out past the highlight. */
const CLIP_BLEED = 10;

interface SectorGeometry {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  /** The row's `nameKey` — how a sector finds its own index. */
  name?: string;
}

/**
 * One slice, drawn the same way whatever state it's in. Every slice renders
 * through this (the ring marks them all active), so each keeps its own nodes
 * across a hover and the gold eases from one slice to the next.
 *
 * Two layers: a bed (`pulseBed`) and the slice on top. Lit, the slice turns
 * gold and its opacity breathes over the bed. Framer Motion drives the pulse
 * — CSS opacity animations on SVG run on Safari but Chromium drops them.
 */
function DonutSlice({
  geom,
  fill,
  bed,
  lit,
  dimmed,
}: {
  geom: SectorGeometry;
  fill: string;
  bed: string;
  lit: boolean;
  dimmed: boolean;
}) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle } = geom;
  const shape = { cx, cy, innerRadius, outerRadius, startAngle, endAngle };
  return (
    <g style={{ opacity: dimmed ? 0.5 : 1, transition: `opacity ${MARK_EASE}` }}>
      <Sector
        {...shape}
        fill={bed}
        stroke="none"
        style={{ opacity: lit ? 1 : 0, transition: `opacity ${MARK_EASE}` }}
      />
      <motion.g {...pulseMotion(lit)}>
        <Sector
          {...shape}
          fill={fill}
          stroke="var(--color-bulk-base)"
          strokeWidth={1}
          style={{ transition: `fill ${MARK_EASE}` }}
        />
      </motion.g>
    </g>
  );
}

interface DonutRow {
  category: string;
  share: number;
  points: number;
  color: string;
}

/** Resting colour of slice `i`: gold on the primary, its own ramp colour
 * otherwise. */
function restColorOf(rows: DonutRow[], i: number): string {
  return i === 0 ? CHART_GOLD : rows[i].color;
}

/**
 * The ring, and the sweep that draws it in.
 *
 * Recharts' own entrance animation stays off (react-smooth was observed
 * leaving sectors with no rendered path here), so the wipe steps `endAngle`
 * from the start angle round to a full turn on requestAnimationFrame. The
 * sweep state lives here rather than in `AuraDonut` so a step redraws the
 * arcs and not the legend beside them.
 */
function DonutRing({
  width,
  innerRadius,
  outerRadius,
  chartData,
  hoverIndex,
  onHoverIndex,
  onLeave,
}: {
  width: number;
  innerRadius: number;
  outerRadius: number;
  chartData: DonutRow[];
  hoverIndex: number | undefined;
  onHoverIndex: (index: number) => void;
  onLeave: () => void;
}) {
  const [sweep, setSweep] = useState(0);
  const allSlices = useMemo(() => chartData.map((_, i) => i), [chartData]);
  const restAt = (i: number) => restColorOf(chartData, i);

  // Once per mount, with no dependencies, so a resize mid-sweep can't tear
  // the loop down. StrictMode's mount/unmount/remount simply restarts it.
  useEffect(() => {
    let frame = 0;
    let start = 0;
    const step = (now: number) => {
      if (start === 0) start = now;
      const t = Math.min(1, (now - start) / SWEEP_MS);
      setSweep(1 - Math.pow(1 - t, 3)); // ease-out
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    // A hidden tab gets no frames, and at sweep 0 Recharts draws no path at
    // all — so snap the sweep home once it's clear no frames are coming.
    // Timers still run in a hidden tab; on a visible one this is a no-op.
    const fallback = window.setTimeout(() => {
      cancelAnimationFrame(frame);
      setSweep(1);
    }, SWEEP_MS * 3);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, []);

  return (
    <PieChart width={width} height={width}>
      <Pie
        data={chartData}
        dataKey="share"
        nameKey="category"
        cx="50%"
        cy="50%"
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={START_ANGLE}
        endAngle={START_ANGLE - 360 * sweep}
        // Scaled with the sweep rather than switched on at the end:
        // snapping them to full size on the last step visibly squeezed
        // every sector to make room, then let it spring back.
        minAngle={5 * sweep}
        paddingAngle={(chartData.length > 5 ? 1 : 2) * sweep}
        isAnimationActive={false}
        // Every slice "active", so every slice renders through DonutSlice —
        // see there for why none can be left to Recharts' plain sector.
        activeIndex={allSlices}
        activeShape={(props: unknown) => {
          const sector = props as SectorGeometry;
          const i = chartData.findIndex((r) => r.category === sector.name);
          if (!chartData[i]) return <g />;
          const lit = hoverIndex === i;
          return (
            <DonutSlice
              geom={sector}
              fill={markFill(i, hoverIndex, restAt)}
              bed={pulseBed(restAt(i))}
              lit={lit}
              dimmed={hoverIndex != null && !lit}
            />
          );
        }}
        onMouseEnter={(_, i) => onHoverIndex(i)}
        onMouseLeave={onLeave}
      />
    </PieChart>
  );
}

/**
 * Aura-by-source ring — the same Recharts donut the Aura Sources page uses,
 * so both views share one sweep-in animation and hover treatment.
 */
export function AuraDonut({
  segments,
  totalAuraNumber,
  showShare = true,
  hoverIndex: hoverIndexProp,
  onHoverIndexChange,
}: {
  segments: OverviewDonutSegment[];
  totalAuraNumber: number;
  /** Overview keeps Share so the legend lines up with the tier table under
   * it. Aura sources already has a Category Share chart beside the donut. */
  showShare?: boolean;
  /** Controlled hover — Aura sources shares this with Category Share so a
   * legend row, a bar, or a Y-label all light the same slice. */
  hoverIndex?: number | undefined;
  onHoverIndexChange?: (index: number | undefined) => void;
}) {
  const [localHover, setLocalHover] = useState<number | undefined>(undefined);
  const controlled = onHoverIndexChange != null;
  const hoverIndex = controlled ? hoverIndexProp : localHover;
  const setHoverIndex = controlled ? onHoverIndexChange! : setLocalHover;
  const narrow = useNarrowViewport();

  // Measured off the ROW, not the donut's own box, and against both axes:
  // the ring is square, so whichever runs out first bounds it. Measured
  // rather than handed to ResponsiveContainer because this card can mount
  // while a FLIP swap still has it scaled down, and ResponsiveContainer
  // latches that transformed size; `clientWidth`/`clientHeight` report
  // layout size, which a transform can't skew.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const legendRows = useRef<(HTMLDivElement | null)[]>([]);
  const [avail, setAvail] = useState({ w: 0, h: 0, legendFloor: 0, vw: 0 });

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    // The legend floor moves with the viewport, since the gap between its
    // columns does — so it's read here, alongside the row's own size, rather
    // than baked in as a constant.
    const measure = () =>
      setAvail({
        w: el.clientWidth,
        h: el.clientHeight,
        legendFloor: metricTableMinWidth(window.innerWidth, { share: showShare }),
        vw: window.innerWidth,
      });
    measure();

    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);

    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [showShare]);

  // The row is [inset][ring][gap][legend]; the ring gets whatever width is
  // left once the fixed-width legend, the gap and the row's own left inset
  // are taken out (clientWidth counts padding, so the inset comes out by
  // hand), capped only by the available height.
  const leftover =
    avail.w === 0
      ? 0
      : avail.w -
        avail.legendFloor -
        ROW_GAP -
        METRIC_TABLE_LEAD_INSET -
        CLIP_BLEED -
        ROUNDING_SLACK;
  const stacked = narrow || (avail.w > 0 && leftover < MIN_RING);

  const width =
    avail.w === 0
      ? 0
      : stacked
        ? Math.max(MIN_RING, Math.min(avail.w, STACKED_RING_MAX))
        : Math.max(
          Math.min(MIN_RING, avail.h),
          Math.min(avail.h, leftover)
        );

  const chartData = useMemo<DonutRow[]>(
    () =>
      segments.map((s, i) => ({
        category: s.label,
        share: s.pct,
        points: s.points,
        // Prefer the colour the caller already assigned (primary ramp) so the
        // ring matches its legend / companion chart.
        color: s.color || chartPrimaryRamp(i, segments.length),
      })),
    [segments]
  );

  // A fast mouse-out or an alt-tab away mid-hover can skip the pointer past
  // Recharts' sector boundary without ever firing its onMouseLeave, leaving
  // the active slice highlighted indefinitely.
  useEffect(() => {
    if (hoverIndex === undefined) return;
    const clear = () => setHoverIndex(undefined);
    // Controlled hover is owned by the parent row — don't clear on window
    // blur from here or the Category Share sync drops mid-drag.
    if (controlled) return;
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    document.addEventListener("mouseleave", clear);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      document.removeEventListener("mouseleave", clear);
    };
  }, [hoverIndex, controlled, setHoverIndex]);

  const active = hoverIndex != null ? chartData[hoverIndex] : undefined;
  const restAt = (i: number) => restColorOf(chartData, i);

  // Radii derived from the measured canvas, capped so strokes stay inside it
  // and floored at 0 for the unmeasured first render.
  const outerRadius = Math.max(
    0,
    Math.min(width * RING_OUTER_RATIO, width / 2 - GLOW_HEADROOM)
  );
  const innerRadius = outerRadius * (RING_INNER_RATIO / RING_OUTER_RATIO);
  /** Distance from the canvas's left edge to the ring's — the ring is
   * centred in a square box that is deliberately larger than it. */
  const ringLeftInset = width / 2 - outerRadius;
  // The centre readout scales with the hole it sits in, capped and floored.
  // Grouped ten-digit values run ~5.4× the font size; ~0.19 of the hole
  // keeps ~15% clearance either side.
  const holeDiameter = innerRadius * 2;
  const tightHole = holeDiameter > 0 && holeDiameter < 96;
  const valueFontPx = Math.max(11, Math.min(28, holeDiameter * (tightHole ? 0.22 : 0.19)));
  const captionFontPx = Math.max(8.5, Math.min(11, holeDiameter * 0.055));

  const sourcesLayout = !showShare;
  // Below xl the ring stays capped by the row's height while the card can be
  // much wider, so the legend widens (to a cap) and the pair sits centred
  // instead of leaving a gap. Gated on the slack actually being there, not on
  // the breakpoint alone.
  const spread =
    !stacked &&
    !sourcesLayout &&
    avail.vw > 0 &&
    avail.vw < XL_BREAKPOINT &&
    leftover - width >= SPREAD_MIN_SLACK;

  return (
    <div
      ref={rowRef}
      className={cn(
        // Isolate so card gloss doesn't reconstitute over thin sector strokes;
        // select-none so Android doesn't treat legend taps as copy-text.
        "flex min-h-0 min-w-0 flex-1 select-none [-webkit-touch-callout:none] [isolation:isolate]",
        // overflow-x only — overflow-y:hidden was clipping the ring apex on
        // short mobile panels (the flat top that looked like "textures").
        stacked
          ? "flex-col items-stretch gap-3 overflow-visible"
          : cn(spread ? "justify-center gap-16" : "gap-5", "overflow-x-clip overflow-y-visible"),
        !stacked && (sourcesLayout ? "items-start" : "items-center")
      )}
      style={{
        paddingLeft: stacked || spread ? 0 : METRIC_TABLE_LEAD_INSET,
        paddingRight: stacked ? 0 : CLIP_BLEED,
        marginRight: stacked ? 0 : -CLIP_BLEED,
      }}
      onMouseLeave={() => {
        if (!controlled) setHoverIndex(undefined);
      }}
    >
      {/* Sized from the measurement above. No inline geometry until the row
          has been measured (`width` is 0 on the server and first paint), so
          server and client render the same bare div. */}
      <div
        className={cn("relative shrink-0", stacked && "mx-auto")}
        style={
          width > 0
            ? {
                width,
                height: width,
                marginLeft: stacked ? undefined : -ringLeftInset,
              }
            : undefined
        }
      >
        {/* Mounting is what starts the sweep. */}
        {width > 0 && (
          <DonutRing
            width={width}
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            chartData={chartData}
            hoverIndex={hoverIndex}
            onHoverIndex={setHoverIndex}
            onLeave={() => {
              if (!controlled) setHoverIndex(undefined);
            }}
          />
        )}

        {/* Constrained to the hole rather than the whole canvas, so a long
            value or a long category name is bounded by the space it actually
            has instead of running out over the ring. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div
            className="flex flex-col items-center"
            style={{ width: holeDiameter ? holeDiameter * 0.92 : undefined }}
          >
            <p
              className="font-figure m-0 truncate font-semibold leading-tight"
              style={{
                fontSize: valueFontPx,
                color: active ? CHART_GOLD : "var(--color-text-primary)",
                maxWidth: "100%",
              }}
            >
              {tightHole
                ? compactAura(active ? active.points : totalAuraNumber)
                : Math.round(active ? active.points : totalAuraNumber).toLocaleString("en-US")}
            </p>
            <p
              className={cn(
                "font-label m-0 mt-0.5 leading-tight text-text-muted",
                tightHole ? "whitespace-normal" : "truncate"
              )}
              style={{ fontSize: captionFontPx, maxWidth: "100%" }}
            >
              {active ? active.category : tightHole ? "Aura" : "Total Aura"}
            </p>
          </div>
        </div>
      </div>

      <div
        ref={legendRef}
        className={cn(
          "relative isolate flex min-h-0 min-w-0 flex-col",
          stacked || sourcesLayout
            ? "flex-1 justify-start self-stretch"
            : spread
              ? "flex-1 self-stretch [justify-content:safe_center]"
              : "ml-auto flex-none self-stretch [justify-content:safe_center]"
        )}
        style={
          stacked
            ? { width: "100%", minWidth: 0, maxWidth: "100%", paddingTop: 0 }
            : spread
              ? { minWidth: avail.legendFloor, maxWidth: SPREAD_LEGEND_MAX }
            : sourcesLayout
              ? {
                  minWidth: avail.legendFloor,
                  maxWidth: "100%",
                  // Same constant the Category Share chart uses, so CATEGORY /
                  // AURA sit on the donut apex even when the measured ring
                  // inset drifts with leftover width.
                  paddingTop: donutApexInset(AURA_SOURCES_DONUT_WELL),
                }
              : { width: avail.legendFloor, minWidth: 0, maxWidth: "100%" }
        }
      >
        <MetricTableHeader
          columns={
            showShare ? (["Category", "Aura", "Share"] as const) : (["Category", "Aura"] as const)
          }
          wide={sourcesLayout || stacked || spread}
        />
        <RowHighlight
          containerRef={legendRef}
          target={hoverIndex != null ? (legendRows.current[hoverIndex] ?? null) : null}
        />
        {chartData.map((row, i) => {
          return (
            <MetricTableRow
              key={row.category}
              color={markFill(i, hoverIndex, restAt)}
              restColor={restAt(i)}

              pulseDot={hoverIndex === i}
              name={row.category}
              count={Math.round(row.points).toLocaleString("en-US")}
              share={showShare ? `${Math.round(row.share)}%` : undefined}
              wide={sourcesLayout || stacked || spread}
              active={hoverIndex === i}
              dimmed={hoverIndex !== undefined && hoverIndex !== i}
              isFirst={i === 0}
              rowRef={(el) => {
                legendRows.current[i] = el;
              }}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => {
                if (!controlled) setHoverIndex(undefined);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
