"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SegmentedToggle } from "@/components/overview/SegmentedToggle";
import { PanelLabel } from "@/components/overview/PanelCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import type { Book, ExecutionCost, Level } from "@/lib/order-book-math";
import { fmtPrice, fmtUsdShort, niceStep } from "@/components/stats/format";
import { useElementSize } from "@/components/stats/use-element-width";
import { ASK, ASK_DEEP, BID, BID_DEEP, barGradient } from "@/components/stats/book-colors";

type Zoom = "auto" | "0.1" | "0.5" | "2";

const ZOOM_OPTIONS: { value: Zoom; label: string }[] = [
  { value: "auto", label: "Fit" },
  { value: "0.1", label: "±0.1%" },
  { value: "0.5", label: "±0.5%" },
  { value: "2", label: "±2%" },
];

/** Floor for the plot; it grows to fill a card stretched taller than this. */
const MIN_HEIGHT = 240;
const PAD = { top: 16, right: 12, bottom: 26, left: 54 };
/** One depth sample per this many pixels — fine enough that the book's
 *  steps still read as steps, coarse enough to morph every frame. */
const SAMPLE_PX = 2;
/** Time constant of the morph: each frame closes 1 − e^(−dt/τ) of the gap
 *  to the new book. ~120ms settles in about half a second with no overshoot,
 *  so a refresh reads as the book breathing rather than redrawing. */
const TAU_MS = 120;

const ORDER = "var(--t-accent)";
/** Where the curves start at mid: halfway from the deep tone to the bright
 *  one, so the line stays readable on the dark surface. */
const LINE_MID_BID = `color-mix(in oklab, ${BID} 55%, ${BID_DEEP})`;
const LINE_MID_ASK = `color-mix(in oklab, ${ASK} 55%, ${ASK_DEEP})`;
const GRID = "rgb(var(--t-veil-rgb) / 0.06)";
const AXIS_TEXT = "var(--t-text-muted)";
const MONO = "var(--font-mono)";

/** What the chart is heading towards: the frame, and the order's reach. */
interface Target {
  lo: number;
  hi: number;
  yMax: number;
  yStep: number;
  mid: number;
  filled: number;
  worst: number;
}

/** What is on screen this frame: the same, part-way there, plus the curves. */
interface Frame extends Target {
  bid: Float64Array;
  ask: Float64Array;
}

/** Cumulative USD at each sample price, walking out from the touch. Asks sum
 *  every level at or below the price, bids every level at or above it; each
 *  side is zero on the far side of mid. */
function sampleSide(levels: Level[], isAsk: boolean, lo: number, hi: number, mid: number, out: Float64Array) {
  const n = out.length;
  const at = (i: number) => lo + ((hi - lo) * i) / (n - 1);
  let cum = 0;
  let j = 0;
  if (isAsk) {
    for (let i = 0; i < n; i++) {
      const p = at(i);
      while (j < levels.length && levels[j][0] <= p) {
        cum += levels[j][0] * levels[j][1];
        j++;
      }
      out[i] = p >= mid ? cum : 0;
    }
  } else {
    for (let i = n - 1; i >= 0; i--) {
      const p = at(i);
      while (j < levels.length && levels[j][0] >= p) {
        cum += levels[j][0] * levels[j][1];
        j++;
      }
      out[i] = p <= mid ? cum : 0;
    }
  }
}

function sumWithin(levels: Level[], inRange: (px: number) => boolean): number {
  let sum = 0;
  for (const [px, sz] of levels) {
    if (!inRange(px)) break;
    sum += px * sz;
  }
  return sum;
}

/**
 * Cumulative depth on each side of mid, with the part of the book the
 * calculator's order would eat highlighted.
 *
 * Nothing on it jumps. The frame (price range, height), the curves, the mid
 * line and the order's marker all ease toward each new book, zoom or order
 * size, so a refresh every couple of seconds reads as the book moving.
 */
export function DepthChart({
  market,
  book,
  mid,
  cost,
  decimals,
}: {
  /** A new market is a different book: it rises in rather than morphing
   *  from the last one's shape. */
  market: string;
  book: Book;
  mid: number | null;
  cost: ExecutionCost | null;
  decimals: number;
}) {
  const [zoom, setZoom] = useState<Zoom>("auto");
  const [wrapRef, { width, height: boxHeight }] = useElementSize<HTMLDivElement>();
  const chartH = Math.max(MIN_HEIGHT, boxHeight);
  const [hoverX, setHoverX] = useState<number | null>(null);
  // The loop's working copy lives in a ref; each frame it publishes a
  // snapshot to state, which is all the render reads.
  const frameRef = useRef<Frame | null>(null);
  const marketRef = useRef(market);
  const [frame, setFrame] = useState<Frame | null>(null);

  const fill = cost?.fill ?? null;
  const side = cost?.side ?? "buy";
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = Math.max(0, chartH - PAD.top - PAD.bottom);
  const samples = Math.max(40, Math.min(900, Math.floor(plotW / SAMPLE_PX)));

  const target = useMemo<Target | null>(() => {
    if (mid == null || plotW < 60) return null;
    let half: number;
    if (zoom === "auto") {
      const reach = fill ? Math.abs(fill.worstPx - mid) / mid : 0;
      // Room past the worst fill so the order's edge is not on the frame,
      // and a floor so a tiny order still shows the book around it.
      half = Math.min(0.2, Math.max(0.0015, reach * 1.6));
    } else {
      half = Number(zoom) / 100;
    }
    const lo = mid * (1 - half);
    const hi = mid * (1 + half);
    const bookPeak = Math.max(
      sumWithin(book.bids, (px) => px >= lo),
      sumWithin(book.asks, (px) => px <= hi),
    );
    // Fit frames the order, not the whole book: against millions resting
    // near the touch a $100K order is a sliver on the floor of the chart.
    // The book beyond that height runs off the top, clipped.
    const peak =
      zoom === "auto" && fill
        ? Math.min(bookPeak, fill.filledUsd * 2.5) || fill.filledUsd * 1.15
        : Math.max(bookPeak, fill ? fill.filledUsd * 1.15 : 0);
    const yStep = niceStep(peak || 1, 4);
    const yMax = Math.max(yStep, Math.ceil(peak / yStep) * yStep);
    return {
      lo,
      hi,
      yMax,
      yStep,
      mid,
      filled: fill?.filledUsd ?? 0,
      worst: fill?.worstPx ?? mid,
    };
  }, [book, mid, plotW, zoom, fill]);

  // The morph loop. Runs while anything is still travelling, then stops; a
  // new book, zoom, order or size restarts it. A fresh chart — first load, a
  // new market, a resize — starts from empty curves, so the book rises in.
  useEffect(() => {
    if (marketRef.current !== market) {
      marketRef.current = market;
      frameRef.current = null;
    }
    if (!target) return;
    const tBid = new Float64Array(samples);
    const tAsk = new Float64Array(samples);
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const k = 1 - Math.exp(-dt / TAU_MS);
      let f = frameRef.current;
      if (!f || f.bid.length !== samples) {
        f = { ...target, bid: new Float64Array(samples), ask: new Float64Array(samples) };
        frameRef.current = f;
      }
      const ease = (from: number, to: number) => from + (to - from) * k;
      f.lo = ease(f.lo, target.lo);
      f.hi = ease(f.hi, target.hi);
      f.yMax = ease(f.yMax, target.yMax);
      f.mid = ease(f.mid, target.mid);
      f.filled = ease(f.filled, target.filled);
      f.worst = ease(f.worst, target.worst);

      // Curves are sampled across the frame as it stands this instant, so a
      // zoom slides the book under a moving window rather than stretching it.
      sampleSide(book.bids, false, f.lo, f.hi, f.mid, tBid);
      sampleSide(book.asks, true, f.lo, f.hi, f.mid, tAsk);
      let gap = 0;
      for (let i = 0; i < samples; i++) {
        f.bid[i] += (tBid[i] - f.bid[i]) * k;
        f.ask[i] += (tAsk[i] - f.ask[i]) * k;
        gap = Math.max(gap, Math.abs(tBid[i] - f.bid[i]), Math.abs(tAsk[i] - f.ask[i]));
      }
      const span = target.hi - target.lo;
      const settled =
        gap < target.yMax * 5e-4 &&
        Math.abs(f.lo - target.lo) < span * 1e-4 &&
        Math.abs(f.hi - target.hi) < span * 1e-4 &&
        Math.abs(f.yMax - target.yMax) < target.yMax * 1e-3 &&
        Math.abs(f.worst - target.worst) < span * 1e-4 &&
        Math.abs(f.filled - target.filled) < target.yMax * 1e-3;

      setFrame({ ...f, bid: Float64Array.from(f.bid), ask: Float64Array.from(f.ask) });
      if (!settled) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [market, target, book, samples]);

  // Loading, or a market switch still waiting on its first book.
  const f = target && frame && frame.bid.length === samples && plotW > 0 ? frame : null;

  const geo = (() => {
    if (!f || !target) return null;
    const x = (p: number) => PAD.left + ((p - f.lo) / (f.hi - f.lo)) * plotW;
    const xi = (i: number) => PAD.left + (i / (samples - 1)) * plotW;
    const priceAt = (i: number) => f.lo + ((f.hi - f.lo) * i) / (samples - 1);
    const y = (v: number) => PAD.top + plotH - (Math.min(v, f.yMax * 1.04) / f.yMax) * plotH;
    const base = y(0);

    // Bids run from the left edge up to mid, asks from mid to the right edge.
    const midIndex = Math.max(0, Math.min(samples - 1, Math.floor(((f.mid - f.lo) / (f.hi - f.lo)) * (samples - 1))));
    const line = (vals: Float64Array, from: number, to: number) => {
      let d = "";
      for (let i = from; i <= to; i++) d += `${i === from ? "M" : "L"}${xi(i).toFixed(1)},${y(vals[i]).toFixed(1)}`;
      return d;
    };
    const bidLine = line(f.bid, 0, midIndex);
    const askLine = line(f.ask, Math.min(samples - 1, midIndex + 1), samples - 1);
    const bidArea = `${bidLine}L${xi(midIndex).toFixed(1)},${base}L${xi(0).toFixed(1)},${base}Z`;
    const askStart = Math.min(samples - 1, midIndex + 1);
    const askArea = `${askLine}L${xi(samples - 1).toFixed(1)},${base}L${xi(askStart).toFixed(1)},${base}Z`;

    // The order's bite: from the touch out to its worst price, capped at
    // what it fills.
    let orderArea: string | null = null;
    if (f.filled > 0) {
      const vals = side === "buy" ? f.ask : f.bid;
      const pts: string[] = [];
      for (let i = 0; i < samples; i++) {
        const p = priceAt(i);
        const inside = side === "buy" ? p >= f.mid && p <= f.worst : p <= f.mid && p >= f.worst;
        if (inside) pts.push(`${xi(i).toFixed(1)},${y(Math.min(vals[i], f.filled)).toFixed(1)}`);
      }
      if (pts.length > 1) {
        const first = pts[0].split(",")[0];
        const lastX = pts[pts.length - 1].split(",")[0];
        orderArea = `M${first},${base}L${pts.join("L")}L${lastX},${base}Z`;
      }
    }

    const xStep = niceStep(target.hi - target.lo, width < 480 ? 3 : 5);
    // Tick values come from where the frame is headed, so the set of labels
    // is stable; only their positions ride the animated frame. Labels the
    // moving frame has not reached yet are left off.
    const xTicks: number[] = [];
    for (let t = Math.ceil(target.lo / xStep) * xStep; t <= target.hi; t += xStep) {
      if (t >= f.lo && t <= f.hi) xTicks.push(t);
    }
    const tickDecimals = Math.min(decimals, Math.max(0, -Math.floor(Math.log10(xStep))));
    const yTicks: number[] = [];
    for (let v = 0; v <= target.yMax * 1.001; v += target.yStep) {
      if (v <= f.yMax * 1.04) yTicks.push(v);
    }

    return { x, y, base, bidLine, askLine, bidArea, askArea, orderArea, xTicks, yTicks, tickDecimals };
  })();

  const hover = useMemo(() => {
    if (!f || !geo || hoverX == null || mid == null) return null;
    const px = f.lo + ((hoverX - PAD.left) / plotW) * (f.hi - f.lo);
    if (px < f.lo || px > f.hi) return null;
    const isAsk = px >= mid;
    const levels = isAsk ? book.asks : book.bids;
    let depth = 0;
    for (const [lpx, sz] of levels) {
      if (isAsk ? lpx > px : lpx < px) break;
      depth += lpx * sz;
    }
    return { px, isAsk, depth, bp: ((px - mid) / mid) * 1e4 };
  }, [f, geo, hoverX, mid, book, plotW]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <PanelLabel>Order book depth</PanelLabel>
          <InfoTooltip
            floating
            panelClassName="w-64"
            text="USD resting on each side of mid. The highlighted part is what your order would fill."
          />
        </div>
        <SegmentedToggle options={ZOOM_OPTIONS} value={zoom} onChange={setZoom} layoutId="stats-depth-zoom" />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-[7px]">
          <span className="h-2 w-3.5 rounded-[1px]" style={{ backgroundImage: barGradient("bid") }} /> Bids
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span className="h-2 w-3.5 rounded-[1px]" style={{ backgroundImage: barGradient("ask") }} /> Asks
        </span>
        {fill && (
          <span className="inline-flex items-center gap-[7px]">
            <span className="h-2 w-2 rounded-[1px]" style={{ background: ORDER }} /> Your order
          </span>
        )}
      </div>

      <div
        ref={wrapRef}
        className="relative w-full flex-1 touch-none select-none"
        style={{ minHeight: MIN_HEIGHT }}
        onPointerMove={(e) => setHoverX(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onPointerLeave={() => setHoverX(null)}
      >
        {!geo || !f ? (
          <p className="font-data m-0 pt-24 text-center text-text-dim">Loading order book…</p>
        ) : (
          <svg width={width} height={chartH} className="absolute left-0 top-0 block overflow-visible">
            <defs>
              <clipPath id="depth-plot">
                <rect x={PAD.left} y={PAD.top - 2} width={plotW} height={plotH + 2} />
              </clipPath>
              {/* Each side runs from its deep tone at mid to its bright colour
                  at the edge of the frame — the way the liquidity bars run —
                  pinned to the moving frame so the ramp always spans the
                  visible book. */}
              <linearGradient id="depth-bid" gradientUnits="userSpaceOnUse" x1={geo.x(f.mid)} x2={geo.x(f.lo)} y1={0} y2={0}>
                <stop offset="0%" stopColor={BID_DEEP} />
                <stop offset="100%" stopColor={BID} />
              </linearGradient>
              <linearGradient id="depth-ask" gradientUnits="userSpaceOnUse" x1={geo.x(f.mid)} x2={geo.x(f.hi)} y1={0} y2={0}>
                <stop offset="0%" stopColor={ASK_DEEP} />
                <stop offset="100%" stopColor={ASK} />
              </linearGradient>
              {/* The lines start a step brighter at mid than the fills: the
                  deep tones alone sank into the dark surface right where the
                  book matters most. */}
              <linearGradient id="depth-bid-line" gradientUnits="userSpaceOnUse" x1={geo.x(f.mid)} x2={geo.x(f.lo)} y1={0} y2={0}>
                <stop offset="0%" stopColor={LINE_MID_BID} />
                <stop offset="100%" stopColor={BID} />
              </linearGradient>
              <linearGradient id="depth-ask-line" gradientUnits="userSpaceOnUse" x1={geo.x(f.mid)} x2={geo.x(f.hi)} y1={0} y2={0}>
                <stop offset="0%" stopColor={LINE_MID_ASK} />
                <stop offset="100%" stopColor={ASK} />
              </linearGradient>
            </defs>

            {geo.yTicks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} stroke={GRID} />
                <text x={PAD.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" fontFamily={MONO} fontSize={12} fill={AXIS_TEXT}>
                  {fmtUsdShort(t)}
                </text>
              </g>
            ))}
            {geo.xTicks.map((t) => (
              <text key={t} x={geo.x(t)} y={chartH - 6} textAnchor="middle" fontFamily={MONO} fontSize={12} fill={AXIS_TEXT}>
                {t.toLocaleString("en-US", {
                  minimumFractionDigits: geo.tickDecimals,
                  maximumFractionDigits: geo.tickDecimals,
                })}
              </text>
            ))}

            <g clipPath="url(#depth-plot)">
              <path d={geo.bidArea} fill="url(#depth-bid)" fillOpacity={0.3} />
              <path d={geo.askArea} fill="url(#depth-ask)" fillOpacity={0.3} />
              <path d={geo.bidLine} fill="none" stroke="url(#depth-bid-line)" strokeWidth={2} strokeLinejoin="round" />
              <path d={geo.askLine} fill="none" stroke="url(#depth-ask-line)" strokeWidth={2} strokeLinejoin="round" />
              {geo.orderArea && (
                <path d={geo.orderArea} fill={ORDER} fillOpacity={0.32} stroke={ORDER} strokeWidth={1.5} strokeLinejoin="round" />
              )}
              <line
                x1={geo.x(f.mid)}
                x2={geo.x(f.mid)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke={AXIS_TEXT}
                strokeDasharray="3 4"
              />
              {hover && (
                <line
                  x1={geo.x(hover.px)}
                  x2={geo.x(hover.px)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="var(--t-text-secondary)"
                  strokeOpacity={0.5}
                />
              )}
            </g>

            <text x={geo.x(f.mid)} y={PAD.top - 4} textAnchor="middle" fontFamily={MONO} fontSize={12} fill={AXIS_TEXT}>
              mid
            </text>

            {fill && f.worst >= f.lo && f.worst <= f.hi && (
              <g>
                <circle
                  cx={geo.x(f.worst)}
                  cy={geo.y(f.filled)}
                  r={5}
                  fill={ORDER}
                  stroke="var(--t-bg-primary)"
                  strokeWidth={2}
                />
                <text
                  x={geo.x(f.worst) + (side === "buy" ? -9 : 9)}
                  y={geo.y(f.filled) - 9}
                  textAnchor={side === "buy" ? "end" : "start"}
                  fontFamily={MONO}
                  fontSize={12}
                  fill="var(--t-text-primary)"
                >
                  {fmtUsdShort(fill.filledUsd)} → {fmtPrice(fill.worstPx, decimals)}
                </text>
              </g>
            )}
          </svg>
        )}

        {hover && geo && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-2.5 py-2 text-[11px] shadow-[var(--t-shadow-pop)]"
            style={
              geo.x(hover.px) > width / 2
                ? { right: width - geo.x(hover.px) + 10 }
                : { left: geo.x(hover.px) + 10 }
            }
          >
            <p className="font-data m-0 text-text-primary">{fmtPrice(hover.px, decimals)}</p>
            <p className="font-data m-0 text-text-muted">
              {hover.bp >= 0 ? "+" : "−"}
              {Math.abs(hover.bp).toFixed(1)} bp from mid
            </p>
            <p className="m-0 mt-1 flex justify-between gap-4 text-text-secondary">
              <span>{hover.isAsk ? "Asks up to here" : "Bids down to here"}</span>
              <span className="font-data" style={{ color: hover.isAsk ? ASK : BID }}>
                {fmtUsdShort(hover.depth)}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
