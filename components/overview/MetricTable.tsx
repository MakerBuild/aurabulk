"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { pulseBed, pulseMotion } from "@/lib/chart-gold-pulse";

/** Category / tier names — Familjen 13 medium. Shared by the donut legend
 * and the Category Share Y-axis so the two panels read as one list. */
export const CATEGORY_NAME =
  "font-sans text-[13px] font-medium leading-none";

/** SVG twin of CATEGORY_NAME for Recharts axis ticks. */
export const CATEGORY_NAME_SVG = {
  fontFamily: "var(--font-sans), system-ui, sans-serif",
  fontSize: 13,
  fontWeight: 500,
} as const;

/** Fixed widths for the label / count / share columns, hung off the table's
 * right edge. Each is the widest thing the column holds, measured in the
 * browser: 96 for the label ("Pre-Deposits" with its dot, 93.1); 72 for the
 * count heading (70.2); 42 for the share ("53.4%", 39.8). */
const LABEL_W = 96;
const COUNT_W = 72;
const SHARE_W = 42;
/** The gap is fluid, not a fixed 36. At 36 flat, the columns plus this
 * panel's ring want more than a 1024-wide layout gives the panel, and the
 * ring — the one thing sized from what's left over — collapsed to 42px to
 * pay for it. Fluid, the gap only reaches its full 36 where there's room. */
// Written out literally, not built from the constants below: Tailwind scans
// source text for class names, so a class assembled at runtime generates no
// CSS at all and the gap silently falls back to zero. Keep the two in sync.
const GRID = "grid [column-gap:clamp(16px,2.5vw,36px)]";
const GAP_MIN = 16;
const GAP_MAX = 36;
const GAP_VW = 2.5;

function gapAt(viewportWidth: number): number {
  return Math.min(GAP_MAX, Math.max(GAP_MIN, (GAP_VW / 100) * viewportWidth));
}

/** How far the donut sits in from its card's edge. AuraDonut also subtracts
 * it before sizing the ring, because a row's clientWidth counts its own
 * padding and would otherwise hand the ring width that isn't there. */
export const METRIC_TABLE_LEAD_INSET = 20;

// minmax rather than bare lengths: a narrow viewport can leave the panel
// thinner than the columns together, and rigid columns would push their
// content out through the card's edge. Letting the label column give way
// first hands its own `truncate` the job it's there for.
const TRAILING_COLS = `minmax(0, ${LABEL_W}px) ${COUNT_W}px ${SHARE_W}px`;
const TWO_TRAILING = `minmax(0, ${LABEL_W}px) ${COUNT_W}px`;

/** With no leading column, the trailing columns have to be pushed to the
 * right edge explicitly; with one, its 1fr does the pushing. */
const TWO_COL = { template: TWO_TRAILING, justify: "justify-end" };
const TWO_COL_WIDE = { template: "minmax(0, 1fr) max-content", justify: "" };
const THREE_COL = { template: TRAILING_COLS, justify: "justify-end" };
/** Equal thirds, not `1fr max-content max-content`: every row is its own
 * grid, so max-content sized the Aura column to each row's own number and a
 * long figure ended further left than a short one. Equal shares keep one
 * width for every row and space the three headings evenly across the table.
 * The label third is floored at LABEL_W so a narrow legend truncates the
 * figures' slack before it truncates a name. */
const THREE_COL_WIDE = {
  template: `minmax(${LABEL_W}px, 1fr) minmax(0, 1fr) minmax(0, 1fr)`,
  justify: "",
};

/** Header and rows must get the same template — each row is its own grid. */
function shapeFor(columnCount: number, wide: boolean | undefined) {
  if (columnCount === 2) return wide ? TWO_COL_WIDE : TWO_COL;
  return wide ? THREE_COL_WIDE : THREE_COL;
}

/** Bullet width plus its gap to the name. Every cell in a label column is
 * indented by it — the ones holding a dot so the heading lines up with the
 * text rather than the dot, and the ones without so their text still starts
 * at the same x as the text in the label column above them. */
const BULLET_INSET = "pl-[17px]";

/** Fixed row height, paired with shrink-0 on the row: rows sit in a flex
 * column, so without both a short panel would squeeze them. */
const ROW_H = 30;

/** The narrowest the label/count/share block can render without its label
 * column collapsing — for callers that have to reserve room for one before
 * it exists. Takes the viewport width because the gap between the columns
 * depends on it. */
export function metricTableMinWidth(
  viewportWidth: number,
  { share = true }: { share?: boolean } = {}
): number {
  if (!share) return LABEL_W + COUNT_W + gapAt(viewportWidth);
  return LABEL_W + COUNT_W + SHARE_W + gapAt(viewportWidth) * 2;
}

const HEADING = "font-label text-text-muted";

export function MetricTableHeader({
  columns,
  wide,
}: {
  /** Two headings hide the share column (Aura sources — shares live on the
   * bar chart beside it). Three is the plain legend. */
  columns: readonly [string, string] | readonly [string, string, string];
  /** Stretch the label column across leftover width. Aura sources sits the
   * legend next to a height-capped ring, so without this the two-col grid
   * stays 168px wide and the rest of the box is a gap. */
  wide?: boolean;
}) {
  const shape = shapeFor(columns.length, wide);
  return (
    <div
      className={cn(
        GRID,
        shape.justify,
        // Same horizontal inset as the body rows so columns stay aligned when
        // a row's highlight pads past the bullets.
        "-mx-2.5 shrink-0 border-b border-[var(--color-line)] px-2.5 pb-1.5 select-none [-webkit-touch-callout:none]"
      )}
      style={{ gridTemplateColumns: shape.template }}
    >
      {/* Each heading sits the same way its column's values do, so it always
          reads as belonging to the column beneath it: the first column holds
          the dotted names and is left-aligned (indented past the dots so the
          heading meets the text rather than the dot), every other column is
          flush right. */}
      {columns.map((label, i) => (
        <span
          key={label}
          className={cn(HEADING, i === 0 ? cn("text-left", BULLET_INSET) : "text-right")}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export function MetricTableRow({
  color,
  name,
  count,
  share,
  active,
  dimmed,
  pulseDot,
  isFirst,
  wide,
  rowRef,
  restColor,
  onMouseEnter,
  onMouseLeave,
}: {
  color: string;
  name: string;
  count: string;
  /** Omit on two-column legends — the Aura sources donut drops share because
   * the Category Share chart next to it already shows it. */
  share?: string;
  active: boolean;
  dimmed: boolean;
  /** Pulse the colour swatch (gold primary marks). */
  pulseDot?: boolean;
  /** No divider above the first row — the header's own border-b already
   * draws that line, so a border-t here would double it up. */
  isFirst: boolean;
  /** Match `MetricTableHeader`'s wide two-col template. */
  wide?: boolean;
  /** Hands the row to the table's RowHighlight, which draws the active fill
   * as one box sliding between rows — the row itself paints
   * no background. */
  rowRef?: (el: HTMLDivElement | null) => void;
  /** The swatch's own colour when nothing is hovered — the bed its gold
   * pulse breathes over. Defaults to `color`. */
  restColor?: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const textColor = dimmed ? "var(--t-text-dim)" : "var(--t-text-primary)";
  const shape = shapeFor(share != null ? 3 : 2, wide);
  return (
    <div
      ref={rowRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        GRID,
        shape.justify,
        // px/mx always on so the highlight box, which takes this row's
        // bounds, reaches 10px past the bullets and the last column alike.
        "-mx-2.5 shrink-0 items-center px-2.5 transition-colors select-none [-webkit-touch-callout:none]",
        !isFirst && "border-t border-[var(--color-line-soft)]",
        active && !isFirst && "border-transparent"
      )}
      style={{ gridTemplateColumns: shape.template, height: ROW_H }}
    >
      {/* justify-start, not centred: centring the dot and name together as one
          group shifts the dot by half of whatever the name's width is, so a
          column of rows with names of different lengths gets a column of dots
          at as many different x positions. Anchoring the group left puts every
          dot on one vertical line and every name at one starting x. */}
      <span className={cn("flex min-w-0 items-center gap-2", CATEGORY_NAME)} style={{ color: textColor }}>
        <LegendDot
          color={color}
          restColor={restColor ?? color}
          active={active}
          pulse={!!pulseDot}
          dimmed={dimmed}
        />
        <span className="truncate">{name}</span>
      </span>

      {/* Flush right, along with every column except the names. Digits line up
          by place value that way — the thousands column under the thousands
          column — which is the whole reason these are tabular figures. */}
      <span className="font-data text-right" style={{ color: textColor }}>
        {count}
      </span>
      {share != null && (
        <span className="font-data text-right font-semibold" style={{ color: textColor }}>
          {share}
        </span>
      )}
    </div>
  );
}

/** A legend swatch. One fixed structure whatever state it's in, so the colour
 * and scale ease across with CSS transitions (the colours are CSS variables,
 * which only the browser can interpolate) and the gold hands over from swatch
 * to swatch. Lit, it pulses over `pulseBed(restColor)`. */
export function LegendDot({
  color,
  restColor,
  active,
  pulse,
  dimmed,
}: {
  color: string;
  restColor: string;
  active: boolean;
  pulse: boolean;
  dimmed: boolean;
}) {
  const bed = pulseBed(restColor);
  return (
    <span
      className="relative h-[9px] w-[9px] shrink-0 transition-transform duration-300 ease-out"
      style={{ transform: active ? "scale(1.25)" : "scale(1)" }}
    >
      <span
        className="absolute inset-0 rounded-full transition-opacity duration-300 ease-out"
        style={{ backgroundColor: bed, opacity: pulse ? 1 : 0 }}
      />
      <motion.span
        className="absolute inset-0 rounded-full transition-[background-color] duration-300 ease-out"
        {...pulseMotion(pulse, dimmed ? 0.4 : 1)}
        style
={{ backgroundColor: color }}
      />
    </span>
  );
}
