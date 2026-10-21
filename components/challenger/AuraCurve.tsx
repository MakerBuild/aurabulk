"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SparkFill, Tip, TipLine } from "@/components/challenger/WeekCharts";
import { CHART_GOLD } from "@/lib/overview-metrics";
import { cn, truncateWallet } from "@/lib/utils";

export interface CurvePoint {
  wallet: string;
  position: number;
  tradingAura: number;
}

/** Room for the axis labels: AURA on the left, ranks under the plot. */
const PAD_LEFT = 38;
const PAD_RIGHT = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;

/** League colours, taken from the badges: each side of the line wears the
 *  league its traders are in. */
const CHALLENGER = "#8b5cf6";
const DIAMOND = "#22b8a0";

const aura = (n: number) => Math.round(n).toLocaleString("en-US");
const auraTick = (n: number) => `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}K`;

/** The box's size in px, read on mount and kept on resize. Read straight
 *  away too: the observer's first report waits for a painted frame. */
function useSize(): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (w: number, h: number) =>
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    const rect = el.getBoundingClientRect();
    read(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => read(entry.contentRect.width, entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/** Round steps for the AURA axis, about four across the span. */
function auraTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  return ticks;
}

/**
 * Trading AURA down the ranks either side of the Challenger line, drawn as
 * the Overview sparks are: gold wash and mesh under a white line. The
 * Challengers' stretch is lit, the Diamonds' after the cut is dimmed, and the
 * line itself runs across at 25th place's AURA, so the reader sees where the
 * cut falls and how steep the climb is either side of it.
 */
export function AuraCurve({ points, line }: { points: CurvePoint[]; line: number }) {
  const [ref, { w, h }] = useSize();
  const gradIn = useId();
  const meshIn = useId();
  const gradOut = useId();
  const meshOut = useId();
  const clipIn = useId();
  const clipOut = useId();
  const [hover, setHover] = useState<number | null>(null);

  const plotW = Math.max(0, w - PAD_LEFT - PAD_RIGHT);
  const plotH = Math.max(0, h - PAD_TOP - PAD_BOTTOM);
  const ranks = points.map((p) => p.position);
  const first = Math.min(...ranks);
  const last = Math.max(...ranks);
  const auras = points.map((p) => p.tradingAura);
  const span = Math.max(1, Math.max(...auras) - Math.min(...auras));
  const lo = Math.min(...auras) - span * 0.08;
  const hi = Math.max(...auras) + span * 0.08;

  // Best rank on the right, so the curve climbs left to right toward the
  // top of the board.
  const x = (rank: number) => PAD_LEFT + ((last - rank) / Math.max(1, last - first)) * plotW;
  const y = (value: number) => PAD_TOP + (1 - (value - lo) / (hi - lo)) * plotH;
  // The cut falls between 25th and 26th place.
  const lastIn = points.filter((p) => p.tradingAura >= line).reduce((m, p) => Math.max(m, p.position), first);
  const cutX = x(lastIn + 0.5);

  const sorted = [...points].sort((a, b) => a.position - b.position);
  const line_ = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.position).toFixed(1)},${y(p.tradingAura).toFixed(1)}`).join(" ");
  const base = PAD_TOP + plotH;
  const area = sorted.length
    ? `${line_} L${x(sorted[sorted.length - 1].position).toFixed(1)},${base} L${x(sorted[0].position).toFixed(1)},${base} Z`
    : "";

  const hovered = hover != null ? sorted.find((p) => p.position === hover) : undefined;

  function pick(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const share = (event.clientX - rect.left - PAD_LEFT) / Math.max(1, plotW);
    const rank = Math.round(last - Math.min(1, Math.max(0, share)) * (last - first));
    setHover(rank);
  }

  const xTicks = sorted.filter((p) => p.position % 5 === 0 || p.position === lastIn + 1).map((p) => p.position);

  return (
    <div
      ref={ref}
      className="relative min-h-[220px] flex-1 cursor-crosshair touch-none"
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={() => setHover(null)}
    >
      {w > 0 && h > 0 && sorted.length > 1 && (
        <svg width={w} height={h} className="absolute inset-0" aria-hidden>
          <SparkFill gradId={gradIn} meshId={meshIn} color={CHALLENGER} />
          <SparkFill gradId={gradOut} meshId={meshOut} color={DIAMOND} />
          <defs>
            {/* Challengers stand right of the cut, Diamonds left of it. */}
            <clipPath id={clipIn}>
              <rect x={cutX} y={0} width={Math.max(0, w - cutX)} height={h} />
            </clipPath>
            <clipPath id={clipOut}>
              <rect x={0} y={0} width={cutX} height={h} />
            </clipPath>
          </defs>

          {/* AURA gridlines and their labels. */}
          {auraTicks(lo, hi).map((t) => (
            <g key={t}>
              <line x1={PAD_LEFT} x2={w - PAD_RIGHT} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
              <text x={PAD_LEFT - 8} y={y(t) + 3} textAnchor="end" className="fill-[var(--t-text-muted)] font-mono text-[10px]">
                {auraTick(t)}
              </text>
            </g>
          ))}

          {/* Lit where the Challengers stand, dimmed past the cut. The fill
              rises from the baseline while the line draws over it. */}
          <g className="curve-rise">
            <g clipPath={`url(#${clipIn})`}>
              <path d={area} fill={`url(#${gradIn})`} />
              <path d={area} fill={`url(#${meshIn})`} />
            </g>
            <g clipPath={`url(#${clipOut})`} opacity={0.75}>
              <path d={area} fill={`url(#${gradOut})`} />
              <path d={area} fill={`url(#${meshOut})`} />
            </g>
          </g>
          <path
            d={line_}
            pathLength={1}
            fill="none"
            stroke="var(--t-spark-line)"
            strokeWidth="1.75"
            strokeLinejoin="round"
            className="curve-draw"
          />

          {/* The Challenger line: the cut between 25th and 26th place, standing
              up through the chart and flowing upward. Drawn from the baseline
              so the dashes run toward the top. */}
          <line
            x1={cutX}
            x2={cutX}
            y1={base}
            y2={PAD_TOP}
            stroke={CHART_GOLD}
            strokeWidth="1.25"
            strokeDasharray="5 4"
            className="dash-flow"
          />

          {/* Rank labels. */}
          {xTicks.map((rank) => (
            <text
              key={rank}
              x={x(rank)}
              y={h - 6}
              // The end labels hang inward so neither is cut by the card.
              textAnchor={x(rank) > w - PAD_RIGHT - 14 ? "end" : x(rank) < PAD_LEFT + 14 ? "start" : "middle"}
              className="font-mono text-[10px]"
              // The first one out takes the Diamond colour, the rest stay muted.
              fill={rank === lastIn + 1 ? DIAMOND : "var(--t-text-muted)"}
            >
              #{rank}
            </text>
          ))}

          {hovered && (
            <>
              <line x1={x(hovered.position)} x2={x(hovered.position)} y1={PAD_TOP} y2={base} stroke="var(--color-line-strong)" />
              <circle cx={x(hovered.position)} cy={y(hovered.tradingAura)} r="4" fill={CHART_GOLD} />
            </>
          )}
        </svg>
      )}

      {/* The zones named where they meet, at the top of the line: Diamonds
          to its left, Challengers to its right. That reads as the line's key
          and explains the dim and lit fills, with no legend to look up. */}
      {w > 0 && (
        <>
          <span
            className="font-label pointer-events-none absolute whitespace-nowrap"
            style={{ right: w - cutX + 8, top: 0, color: DIAMOND }}
          >
            Diamonds ◂
          </span>
          <span
            className="font-label pointer-events-none absolute whitespace-nowrap"
            style={{ left: cutX + 8, top: 0, color: CHALLENGER }}
          >
            ▸ Challengers
          </span>
        </>
      )}

      {/* The last one in and the first one out, pulsing like the live dot on
          the prize pool chart: the race is still on. HTML rather than SVG so
          they can use the site's ping. They land once the line reaches them. */}
      {w > 0 &&
        h > 0 &&
        sorted
          .filter((p) => p.position === lastIn || p.position === lastIn + 1)
          .map((p) => {
            const inside = p.position === lastIn;
            return (
              <span
                key={p.position}
                className="curve-pop pointer-events-none absolute flex size-2.5 -translate-x-1/2 -translate-y-1/2"
                style={{ left: x(p.position), top: y(p.tradingAura) }}
                aria-hidden
              >
                <span
                  className={cn(
                    "absolute inline-flex size-full animate-ping rounded-full",
                    inside ? "opacity-60" : "border opacity-50",
                  )}
                  style={inside ? { backgroundColor: CHALLENGER } : { borderColor: DIAMOND }}
                />
                <span
                  className={cn(
                    "relative inline-flex size-2.5 rounded-full",
                    !inside && "border-[1.5px] bg-[var(--color-bg-primary)]",
                  )}
                  style={inside ? { backgroundColor: CHALLENGER } : { borderColor: DIAMOND }}
                />
              </span>
            );
          })}


      {hovered && w > 0 && (
        <Tip x={x(hovered.position)} width={w}>
          <TipLine
            label={`#${hovered.position} · ${truncateWallet(hovered.wallet, 4)}`}
            value={`${aura(hovered.tradingAura)} AURA  ${
              hovered.tradingAura === line
                ? "on the line"
                : `${hovered.tradingAura > line ? "+" : "−"}${aura(Math.abs(hovered.tradingAura - line))}`
            }`}
          />
        </Tip>
      )}
    </div>
  );
}
