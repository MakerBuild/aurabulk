"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Pie, PieChart, Sector } from "recharts";
import type { OverviewDonutSegment } from "@/lib/overview-metrics";
import { CHART_GOLD, chartPrimaryRamp } from "@/lib/overview-metrics";
import {
  CHART_GOLD_PULSE,
  CHART_GOLD_PULSE_TRANSITION,
  CHART_GOLD_PULSE_UNDERLAY,
} from "@/lib/chart-gold-pulse";
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

/** How long a slice takes to hand its colour over. Matches the legend
 * swatches and the bars, so everything lit by one hover moves together. */
const SLICE_EASE = "0.35s cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * One slice, drawn the same way whatever state it's in.
 *
 * The lit slice used to be Recharts' `activeShape` — a different element from
 * the plain sector it replaced, so the gold landed on the new slice and left
 * the old one in a single frame, with nothing to transition between. Every
 * slice now renders through this (the ring marks them all active), so each
 * keeps its own nodes across a hover and the gold eases out of one slice as
 * it eases into the next — the same hand-off as the legend swatches.
 *
 * Two layers: a bed in the slice's resting colour, and the slice itself on
 * top. Lit, the slice turns gold and its opacity breathes, so the pulse reads
 * gold↔bed. A slice that rests gold (the primary) beds on slate instead, or
 * the beat would be gold↔gold. Framer Motion drives the pulse rather than CSS
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
    <g style={{ opacity: dimmed ? 0.5 : 1, transition: `opacity ${SLICE_EASE}` }}>
      <Sector
        {...shape}
        fill={bed}
        stroke="none"
        style={{ opacity: lit ? 1 : 0, transition: `opacity ${SLICE_EASE}` }}
      />
      <motion.g
        initial={false}
        animate={lit ? CHART_GOLD_PULSE : { opacity: 1 }}
        transition={lit ? CHART_GOLD_PULSE_TRANSITION : { duration: 0.3 }}
      >
        <Sector
          {...shape}
          fill={fill}
          stroke="var(--color-bulk-base)"
          strokeWidth={1}
          style={{ transition: `fill ${SLICE_EASE}` }}
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

/**
 * The ring, and the sweep that draws it in.
 *
 * Recharts' own entrance animation stays off: it runs through react-smooth,
 * which was observed leaving sectors with no rendered path at all here. So
 * the wipe is driven from this component instead — `endAngle` stepped from
 * the start angle round to a full turn, with Recharts redrawing the arcs
 * each step.
 *
 * Two things about how that used to be done cost the sweep its smoothness,
 * and both were paid on every one of its ~55 steps.
 *
 * The step ran on `setTimeout(…, 16)`. A timer is not tied to the display,
 * so the real interval was 16ms *plus* the step's own render, and it drifted
 * against the frame boundary — some frames showed the previous arc again,
 * which is the stutter. On requestAnimationFrame the step is measured off
 * the frame's own timestamp and lands on the frame that will show it. It
 * also idles in a background tab instead of burning the sweep down unseen,
 * so the animation is still there when the tab is finally opened.
 *
 * And the counter lived in `AuraDonut`, one level up, so every step also
 * re-rendered the legend beside the ring — a row per slice, each with a
 * Framer Motion colour swatch, none of which the sweep touches. Down here a
 * step redraws the arcs and nothing else.
 */
function DonutRing({
  width,
  innerRadius,
  outerRadius,
  chartData,
  hoverIndex,
  borrowColor,
  onHoverIndex,
  onLeave,
}: {
  width: number;
  innerRadius: number;
  outerRadius: number;
  chartData: DonutRow[];
  hoverIndex: number | undefined;
  /** Non-null while a secondary slice is lit and has taken the gold: the
   *  primary wears this instead for as long as that lasts. */
  borrowColor: string | null;
  onHoverIndex: (index: number) => void;
  onLeave: () => void;
}) {
  const [sweep, setSweep] = useState(0);
  const allSlices = useMemo(() => chartData.map((_, i) => i), [chartData]);
  // Freeze the box the sweep was measured for. On Overview this ring shares
  // a row with the Volume chart, which lands its own data a beat later and
  // reallocates the row's height mid-wipe — every ResizeObserver tick then
  // handed Recharts a new width and the arcs jumped instead of travelling.
  // Aura's Source Breakdown never sees that: its well has a fixed min-height,
  // so the first measure is the last. Holding the entrance geometry here
  // makes Overview behave the same way for the wipe; after it finishes we
  // follow live size again so a real resize still lands.
  const [geom, setGeom] = useState({ width, innerRadius, outerRadius });
  const sweeping = sweep < 1;

  useEffect(() => {
    if (sweeping) return;
    setGeom({ width, innerRadius, outerRadius });
  }, [width, innerRadius, outerRadius, sweeping]);

  // Runs once, on mount — this component only mounts once the row has been
  // measured, and takes no dependencies, so a resize mid-sweep cannot tear
  // the loop down. It used to: the cleanup cancelled the timer, and the
  // re-run bailed straight back out on a ref that had already latched. The
  // sweep then stayed frozen at whatever it had reached, and at 0 that is an
  // `endAngle` equal to the start angle — sectors of no length at all, so the
  // ring never appeared while the centre readout (a plain HTML overlay)
  // carried on showing the total.
  //
  // That ref is gone rather than moved down here with it. With no
  // dependencies there is nothing left for it to guard, and it actively
  // breaks the one re-run that does still happen: StrictMode mounts, tears
  // down and remounts, so the cleanup cancels both timers and a latched ref
  // sends the second mount straight out again — never scheduling anything,
  // and leaving exactly the empty ring described above. Restarting the sweep
  // on a genuine remount is the correct behaviour anyway.
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

    // A hidden tab gets no frames, and this ring at sweep 0 is not a faint
    // ring — Recharts draws zero-length sectors as no path at all. So rather
    // than leave a backgrounded tab holding an empty box until it is looked
    // at, snap the sweep home once it is clear no frames are coming. Timers
    // do still run there, which is what makes this reachable. On a visible
    // tab the sweep has been done for two seconds by the time this fires and
    // the state is already 1, so it costs nothing.
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
    <PieChart width={geom.width} height={geom.width}>
      <Pie
        data={chartData}
        dataKey="share"
        nameKey="category"
        cx="50%"
        cy="50%"
        // Ratios of the measured box rather than fixed pixels, so the
        // ring can never outgrow its box on a narrow viewport — it
        // stays correctly sized at every width instead of only at the
        // one a hardcoded radius would have been tuned for.
        innerRadius={geom.innerRadius}
        outerRadius={geom.outerRadius}
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
          const row = chartData[i];
          if (!row) return <g />;
          const isPrimary = i === 0;
          const lit = hoverIndex === i;
          // Gold stays on the primary at rest; on a secondary hover it
          // borrows that slice's slate so the gold can move over.
          const rest = isPrimary ? CHART_GOLD : row.color;
          const fill = lit ? CHART_GOLD : isPrimary && borrowColor != null ? borrowColor : rest;
          return (
            <DonutSlice
              geom={sector}
              fill={fill}
              bed={rest === CHART_GOLD ? CHART_GOLD_PULSE_UNDERLAY : rest}
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

  // Measured off the ROW, not the donut's own box, and against both axes.
  // The ring is square, so its size is bounded by whichever of the two runs
  // out first — sizing it from width alone (as this did) drew a 248px ring
  // into whatever height the panel had left, which overflowed the card and
  // pushed the ring up over the countdown line above it. Measured rather
  // than handed to ResponsiveContainer because this card can mount while a
  // FLIP swap still has it scaled down, and ResponsiveContainer latches that
  // transformed size permanently; `clientWidth`/`clientHeight` report layout
  // size, which a transform can't skew.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const legendRows = useRef<(HTMLDivElement | null)[]>([]);
  const [avail, setAvail] = useState({ w: 0, h: 0, legendFloor: 0, vw: 0 });
  // Overview shares a flex row with the Volume chart, which is empty for a
  // beat and then fills in — every pass reallocates this row's height. Aura's
  // Source Breakdown never has that neighbour, so its first measure is final
  // and the wipe reads clean. Waiting out the shuffle before mounting the
  // ring means Overview starts the same wipe on a settled box instead of
  // mid-reflow.
  const [ringMountWidth, setRingMountWidth] = useState(0);
  const ringShownRef = useRef(false);
  const sweepLockUntilRef = useRef(0);
  const widthRef = useRef(0);

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
  // are taken out, capped only by the available height. The inset has to
  // come out by hand: clientWidth counts padding, so without this the ring
  // would be sized as if the inset weren't there.
  //
  // There used to be an additional MAX_RING ceiling (248px) here too, "so the
  // ring stayed in proportion with the legend" even in a tall, wide panel.
  // What that actually did was leave the ring capped well below what this
  // formula already computed for it — 248 against a formula result of 319 at
  // 1920 — while the legend's own box (below) is flex-1 and still stretched
  // to fill the row regardless, so the width the ring gave up did not go to
  // the legend either: it sat as a gap belonging to neither, 105px of it at
  // 1920. Removing the cap is what lets the ring actually claim the width
  // this formula was already handing it.
  const leftover =
    avail.w === 0
      ? 0
      : avail.w - avail.legendFloor - ROW_GAP - METRIC_TABLE_LEAD_INSET - CLIP_BLEED - 1;
  const stacked = narrow || (avail.w > 0 && leftover < MIN_RING);

  const width =
    avail.w === 0
      ? 0
      : stacked
        ? Math.max(MIN_RING, Math.min(avail.w, 242))
        : Math.max(
          Math.min(MIN_RING, avail.h),
          Math.min(avail.h, leftover)
        );
  widthRef.current = width;

  useEffect(() => {
    if (width <= 0) return;
    if (!ringShownRef.current) {
      // Quiet window: as long as `width` keeps moving, this timer resets, so
      // the ring only mounts once the Volume neighbour (or anything else
      // reshaping the row) has stopped. Matches the settled first paint Aura
      // gets from its fixed well.
      let unlock = 0;
      const settle = window.setTimeout(() => {
        ringShownRef.current = true;
        setRingMountWidth(widthRef.current);
        // Hold the box still for the wipe — a Volume load landing mid-sweep
        // used to resize the parent and make the arcs jump.
        sweepLockUntilRef.current = performance.now() + SWEEP_MS + 80;
        unlock = window.setTimeout(() => {
          setRingMountWidth((prev) =>
            prev === widthRef.current ? prev : widthRef.current,
          );
        }, SWEEP_MS + 80);
      }, 120);
      return () => {
        window.clearTimeout(settle);
        window.clearTimeout(unlock);
      };
    }
    if (performance.now() < sweepLockUntilRef.current) return;
    setRingMountWidth((prev) => (prev === width ? prev : width));
  }, [width]);

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
  /** Hovering a non-primary slice: gold leaves the primary mark and that
   * slice takes it — Overview donut transfer. */
  const borrowColor =
    hoverIndex != null && hoverIndex > 0 ? chartData[hoverIndex].color : null;

  // Radii, and everything sized against them, derived from the measured
  // canvas. The cap keeps the hover glow inside the canvas; without it the
  // outermost glow ring would be clipped once the panel got short enough to
  // shrink the donut.
  // Floored at 0: before the row has been measured `width` is 0, and the
  // glow headroom alone would take the radius negative — which then read as
  // an inset the size of the headroom and put a margin on the box while it
  // had no geometry at all.
  // Prefer the settled mount size so the centre readout and the ring agree
  // during the deferred entrance; fall back to the live measure before that.
  const paintWidth = ringMountWidth > 0 ? ringMountWidth : width;
  const outerRadius = Math.max(
    0,
    Math.min(paintWidth * RING_OUTER_RATIO, paintWidth / 2 - GLOW_HEADROOM)
  );
  const innerRadius = outerRadius * (RING_INNER_RATIO / RING_OUTER_RATIO);
  /** Distance from the canvas's left edge to the ring's — the ring is
   * centred in a square box that is deliberately larger than it. */
  const ringLeftInset = paintWidth / 2 - outerRadius;
  // The centre readout scales with the hole it sits in. It used to be a
  // fixed 18px, which fits a full-size donut but runs out over the ring as
  // soon as a shorter viewport shrinks the ring around it. Capped at the
  // top so it doesn't balloon on a tall panel, and floored so it stays
  // legible on a short one.
  const holeDiameter = innerRadius * 2;
  // Grouped ten-digit values run ~5.4× the font size; ~0.19 of the hole
  // keeps ~15% clearance either side. Cap is high enough that the figure
  // actually fills a normal Overview hole (the old 20px ceiling left it
  // stranded in the middle of a ~200px opening).
  const tightHole = holeDiameter > 0 && holeDiameter < 96;
  const valueFontPx = Math.max(11, Math.min(28, holeDiameter * (tightHole ? 0.22 : 0.19)));
  const captionFontPx = Math.max(8.5, Math.min(11, holeDiameter * 0.055));

  const sourcesLayout = !showShare;
  // Below lg the Overview panels stack and this card runs the full page
  // width, while the ring stays capped by the row's height. Pinning the
  // legend to the right edge then left ~500px of nothing between it and the
  // ring, so here the legend widens (to a cap) and the pair sits centred.
  // Gated on the slack actually being there, not on the breakpoint alone:
  // between lg and xl this card is half the page and has none to spare.
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
      {/* Sized from the measurement above rather than by a width class, so
          the ring shrinks to fit a short panel instead of spilling out of
          it. The radii are ratios of this same number, so they follow. */}
      {/* No inline geometry until the row has actually been measured. These
          values all derive from `width`, which is 0 for the server render and
          for the client's first paint, so emitting them early gives React two
          descriptions of the same box to reconcile — a hydration mismatch,
          which it refuses to patch up. Withheld as one unit, both sides
          render the same bare div and the geometry arrives with the measure. */}
      <div
        className={cn("relative shrink-0", stacked && "mx-auto")}
        style={
          paintWidth > 0
            ? {
                width: paintWidth,
                height: paintWidth,
                marginLeft: stacked ? undefined : -ringLeftInset,
              }
            : undefined
        }
      >
        {/* Mounted only once the row has settled, which is also what
            starts the sweep — the ring owns that state, so a step redraws
            the arcs without touching the legend below. */}
        {ringMountWidth > 0 && (
          <DonutRing
            width={ringMountWidth}
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            chartData={chartData}
            hoverIndex={hoverIndex}
            borrowColor={borrowColor}
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
          const legendColor =
            hoverIndex === i
              ? CHART_GOLD
              : i === 0 && borrowColor
                ? borrowColor
                : row.color;
          return (
            <MetricTableRow
              key={row.category}
              color={legendColor}
              restColor={row.color}
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
