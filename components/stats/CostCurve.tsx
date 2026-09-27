"use client";

import { useId, useMemo, useState } from "react";
import { PanelLabel } from "@/components/overview/PanelCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { executionCost, logSizes, sideDepthUsd, type Book, type Side } from "@/lib/order-book-math";
import { fmtBp, fmtUsd, fmtUsdShort, niceStep } from "@/components/stats/format";
import { useElementSize } from "@/components/stats/use-element-width";
import { SwapValue } from "@/components/ui/SwapValue";

/** Floor for the plot; it grows to fill a card stretched taller than this. */
const MIN_HEIGHT = 180;
const PAD = { top: 12, right: 16, bottom: 26, left: 44 };
const MIN_SIZE = 1_000;
const MAX_SIZE = 5_000_000;
const SAMPLES = 140;

const SIDE_META: Record<Side, { label: string; color: string }> = {
  buy: { label: "Buy", color: "var(--t-green)" },
  sell: { label: "Sell", color: "var(--t-red)" },
};
const GRID = "rgb(var(--t-veil-rgb) / 0.06)";
const AXIS_TEXT = "var(--t-text-muted)";
const MONO = "var(--font-mono)";

/** How the cost of a size splits, for the hover readout. */
const PARTS = [
  { key: "fee", label: "Fee" },
  { key: "spread", label: "Spread" },
  { key: "slippage", label: "Slippage" },
] as const;

interface Sample {
  size: number;
  fee: number;
  spread: number;
  slippage: number;
  total: number;
  totalUsd: number;
}

/** Every size up to what the side can fill, priced against the live book. */
function sampleSide(book: Book, side: Side, takerBps: number, sizes: number[]): Sample[] {
  const out: Sample[] = [];
  for (const size of sizes) {
    const c = executionCost(book, side, size, takerBps, "taker");
    if (!c?.fill?.complete) break;
    out.push({
      size,
      fee: c.feeBp,
      spread: c.spreadBp,
      slippage: c.slippageBp,
      total: c.totalBp,
      totalUsd: c.totalUsd,
    });
  }
  return out;
}

/**
 * What a market order costs at every size, in bp of notional. The fee is a
 * flat floor every size pays; the curve is the all-in cost of the side set in
 * the calculator, and the shade between the two is what the book adds on top
 * — spread and slippage. The other side is a dashed line to compare against.
 */
export function CostCurve({
  book,
  side,
  takerBps,
  sizeUsd,
  onPickSize,
}: {
  book: Book;
  side: Side;
  takerBps: number;
  sizeUsd: number;
  onPickSize: (usd: number) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const [wrapRef, { width, height: boxHeight }] = useElementSize<HTMLDivElement>();
  const chartH = Math.max(MIN_HEIGHT, boxHeight);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const other: Side = side === "buy" ? "sell" : "buy";

  // Each side's whole depth: the largest order it can fill at all.
  const limits = useMemo(() => ({ buy: sideDepthUsd(book.asks), sell: sideDepthUsd(book.bids) }), [book]);
  // The axis stops where the deeper side runs out rather than at a fixed
  // $5M, so the plot is never half empty past the end of the book.
  const xMax = Math.max(MIN_SIZE * 10, Math.min(MAX_SIZE, Math.max(limits.buy, limits.sell)));

  const raw = useMemo(() => {
    const sizesFor = (s: Side) => logSizes(MIN_SIZE, Math.min(xMax, limits[s] * 0.999), SAMPLES);
    return {
      main: sampleSide(book, side, takerBps, sizesFor(side)),
      other: sampleSide(book, other, takerBps, sizesFor(other)),
    };
  }, [book, side, other, takerBps, xMax, limits]);

  const model = useMemo(() => {
    if (width < 160 || !raw.main.length) return null;
    // The height fits the whole curve with room above it, so nothing runs
    // into the top of the frame. Only when the last levels of the book spike
    // far past everything before them is the scale set by the working range
    // instead — and then the curves end where they reach the top rather than
    // being sliced off flat.
    const all = [...raw.main, ...raw.other].map((p) => p.total);
    const focusCut = Math.min(Math.max(sizeUsd * 2, 1_000_000), 0.9 * Math.max(limits.buy, limits.sell));
    const focus = [...raw.main, ...raw.other].filter((p) => p.size <= focusCut).map((p) => p.total);
    const fullPeak = Math.max(takerBps * 1.5, ...all);
    const focusPeak = Math.max(takerBps * 1.5, ...focus);
    const peak = fullPeak > focusPeak * 3 ? focusPeak : fullPeak;
    const yStep = niceStep(peak * 1.12, 4);
    const yMax = Math.max(yStep, Math.ceil((peak * 1.12) / yStep) * yStep);

    const plotW = width - PAD.left - PAD.right;
    const plotH = chartH - PAD.top - PAD.bottom;
    const lx0 = Math.log10(MIN_SIZE);
    const lx1 = Math.log10(xMax);
    const x = (s: number) =>
      PAD.left + ((Math.log10(Math.min(Math.max(s, MIN_SIZE), xMax)) - lx0) / (lx1 - lx0)) * plotW;
    const sizeAt = (px: number) => 10 ** (lx0 + ((px - PAD.left) / plotW) * (lx1 - lx0));
    const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
    const yTicks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, i) => i * yStep);
    const xTicks = [1e3, 1e4, 1e5, 1e6].filter((t) => t < xMax * 0.6);
    const within = (pts: Sample[]) => {
      const cut = pts.findIndex((p) => p.total > yMax);
      return cut === -1 ? pts : pts.slice(0, cut);
    };
    return { x, y, sizeAt, plotW, plotH, yMax, yTicks, xTicks, main: within(raw.main), other: within(raw.other) };
  }, [width, chartH, raw, takerBps, sizeUsd, limits, xMax]);

  const path = (pts: Sample[]) =>
    model ? pts.map((p, j) => `${j ? "L" : "M"}${model.x(p.size).toFixed(1)},${model.y(p.total).toFixed(1)}`).join("") : "";

  // The shade between the fee floor and the curve: what the book adds.
  const addedArea = useMemo(() => {
    if (!model || model.main.length < 2) return "";
    const pts = model.main;
    const top = pts.map((p, j) => `${j ? "L" : "M"}${model.x(p.size).toFixed(1)},${model.y(p.total).toFixed(1)}`).join("");
    const floor = [...pts]
      .reverse()
      .map((p) => `L${model.x(p.size).toFixed(1)},${model.y(p.fee).toFixed(1)}`)
      .join("");
    return `${top}${floor}Z`;
  }, [model]);

  const current = useMemo(() => {
    const c = executionCost(book, side, sizeUsd, takerBps, "taker");
    return c?.fill?.complete ? c : null;
  }, [book, side, sizeUsd, takerBps]);

  // Hover reads the sample nearest the pointer on each side.
  const hover = useMemo(() => {
    if (!model || hoverX == null) return null;
    const size = model.sizeAt(hoverX);
    if (size < MIN_SIZE * 0.98 || size > xMax * 1.02) return null;
    const nearest = (pts: Sample[]) =>
      pts.length && size <= pts[pts.length - 1].size * 1.02
        ? pts.reduce((a, b) => (Math.abs(Math.log(b.size / size)) < Math.abs(Math.log(a.size / size)) ? b : a))
        : null;
    return { size, main: nearest(raw.main), other: nearest(raw.other) };
  }, [model, hoverX, raw, xMax]);

  const mainMeta = SIDE_META[side];
  const otherMeta = SIDE_META[other];
  const markerX = model ? model.x(sizeUsd) : 0;
  const markerY = model && current ? model.y(Math.min(current.totalBp, model.yMax)) : null;
  const gradId = `${uid}-added`;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <PanelLabel>Market order cost by size</PanelLabel>
          <InfoTooltip
            floating
            panelClassName="w-64"
            text="Cost of a market order at every size, in bp. The dashed line is the fee, the shade above it is spread and slippage. Click to price a size."
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-[7px]">
            <span className="h-[2px] w-3.5 rounded-full" style={{ background: mainMeta.color }} />
            {mainMeta.label}
          </span>
          <span className="inline-flex items-center gap-[7px]">
            <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: otherMeta.color }} />
            {otherMeta.label}
          </span>
          <span className="inline-flex items-center gap-[7px]">
            <span className="w-3.5 border-t border-dashed border-[var(--t-text-muted)]" />
            Fee
          </span>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="relative w-full flex-1 cursor-crosshair touch-none select-none"
        style={{ minHeight: MIN_HEIGHT }}
        onPointerMove={(e) => setHoverX(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onPointerLeave={() => setHoverX(null)}
        onClick={() => {
          if (!hover) return;
          // Snap to two significant figures: a clicked $143,915 is a $140K order.
          const mag = 10 ** (Math.floor(Math.log10(hover.size)) - 1);
          onPickSize(Math.round(hover.size / mag) * mag);
        }}
      >
        {!model ? (
          <p className="font-data m-0 pt-16 text-center text-text-dim">Loading order book…</p>
        ) : (
          <svg width={width} height={chartH} className="absolute left-0 top-0 block overflow-visible">
            <defs>
              {/* The added cost fades down toward the fee floor. */}
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={mainMeta.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={mainMeta.color} stopOpacity={0.04} />
              </linearGradient>
            </defs>

            {model.yTicks.map((t, i) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={model.y(t)} y2={model.y(t)} stroke={GRID} />
                <text x={PAD.left - 8} y={model.y(t)} dy="0.32em" textAnchor="end" fontFamily={MONO} fontSize={12} fill={AXIS_TEXT}>
                  {/* The unit once, on the top tick. */}
                  {+t.toFixed(2)}
                  {i === model.yTicks.length - 1 ? " bp" : ""}
                </text>
              </g>
            ))}
            {[...model.xTicks, xMax].map((t, i, all) => (
              <text
                key={t}
                x={model.x(t)}
                y={chartH - 6}
                textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"}
                fontFamily={MONO}
                fontSize={12}
                fill={AXIS_TEXT}
              >
                {fmtUsdShort(t)}
              </text>
            ))}

            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={model.y(takerBps)}
              y2={model.y(takerBps)}
              stroke={AXIS_TEXT}
              strokeDasharray="3 4"
            />
            <path d={addedArea} fill={`url(#${gradId})`} />
            <path
              d={path(model.other)}
              fill="none"
              stroke={otherMeta.color}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              strokeOpacity={0.8}
            />
            <path
              d={path(model.main)}
              fill="none"
              stroke={mainMeta.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* The calculator's size. */}
            <line
              x1={markerX}
              x2={markerX}
              y1={PAD.top}
              y2={PAD.top + model.plotH}
              stroke="var(--t-accent)"
              strokeWidth={1}
              strokeOpacity={current ? 0.7 : 0.35}
              strokeDasharray={current ? undefined : "3 4"}
            />
            {markerY != null && (
              <circle cx={markerX} cy={markerY} r={4.5} fill={mainMeta.color} stroke="var(--t-bg-primary)" strokeWidth={2} />
            )}

            {hover && (
              <line
                x1={model.x(hover.size)}
                x2={model.x(hover.size)}
                y1={PAD.top}
                y2={PAD.top + model.plotH}
                stroke="var(--t-text-secondary)"
                strokeOpacity={0.4}
              />
            )}
          </svg>
        )}

        {/* The marker's readout as a small label beside its dot, hidden while
            the hover readout is up so the two never overlap. */}
        {model && !hover && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-2 py-1 text-[11px] shadow-[0_6px_16px_rgba(0,0,0,.25)]"
            style={{
              top: Math.max(0, (markerY ?? PAD.top + 8) - 34),
              ...(markerX > width - 140
                ? { right: Math.max(4, width - markerX - 12) }
                : { left: Math.max(PAD.left, markerX - 12) }),
            }}
          >
            <span className="font-data text-text-primary">{fmtUsdShort(sizeUsd)}</span>
            <span className="font-data text-text-muted">
              {" · "}
              <SwapValue>{current ? fmtBp(current.totalBp) : "exceeds book"}</SwapValue>
            </span>
          </div>
        )}

        {hover && model && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[190px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-2.5 py-2 text-[11px] shadow-[0_14px_36px_rgba(0,0,0,.55)]"
            style={
              model.x(hover.size) > width / 2
                ? { right: width - model.x(hover.size) + 10 }
                : { left: model.x(hover.size) + 10 }
            }
          >
            <p className="font-data m-0 mb-1.5 text-text-muted">{fmtUsdShort(hover.size)} market order</p>
            {hover.main ? (
              <>
                {PARTS.map((part) => (
                  <p key={part.key} className="m-0 flex items-center justify-between gap-4 text-text-secondary">
                    <span>{part.label}</span>
                    <span className="font-data text-text-primary">{fmtBp(hover.main![part.key])}</span>
                  </p>
                ))}
                <p className="m-0 mt-1 flex items-center justify-between gap-4 border-t border-[var(--color-line)] pt-1 text-text-secondary">
                  <span>{mainMeta.label} total</span>
                  <span className="font-data text-text-primary">
                    {fmtBp(hover.main.total)} · {fmtUsd(hover.main.totalUsd)}
                  </span>
                </p>
              </>
            ) : (
              <p className="m-0 text-text-secondary">{mainMeta.label}: exceeds book</p>
            )}
            <p className="m-0 flex items-center justify-between gap-4 text-text-muted">
              <span>{otherMeta.label} total</span>
              <span className="font-data">{hover.other ? fmtBp(hover.other.total) : "exceeds book"}</span>
            </p>
            <p className="m-0 mt-1 text-[11px] text-text-dim">Click to price this size</p>
          </div>
        )}
      </div>
    </div>
  );
}
