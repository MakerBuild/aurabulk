"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SparkFill, Tip, TipLine } from "@/components/challenger/WeekCharts";
import { SwapValue } from "@/components/ui/SwapValue";
import { CHART_GOLD } from "@/lib/overview-metrics";
import { cn, truncateWallet } from "@/lib/utils";

export interface CurvePoint {
  wallet: string;
  position: number;
  tradingAura: number;
  /** In the upper league. Taken from the league, not the AURA: in the lower
   *  leagues the first one out can tie the last one in. */
  inside: boolean;
}

/** Room for the axis labels: AURA on the left, ranks under the plot. */
const PAD_LEFT = 38;
const PAD_RIGHT = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
/** The least room between two rank labels: about one "#1185" and a gap. */
const MIN_TICK_GAP = 40;

/** Each side of the line wears its league's colour, the site's rank tokens
 *  (taken from the badges, set per theme). */
const leagueColor = (league: string) => `var(--t-rank-${league.toLowerCase()})`;

const aura = (n: number) => Math.round(n).toLocaleString("en-US");
/** `20K`, `5.4K` up top; under 1,000 the plain figure, which a K would
 *  round to the same `0.6K` on every line of a low league. */
const auraTick = (n: number) =>
  n >= 1000
    ? `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })}K`
    : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
/** The zone names glide along with the line as it moves, on SwapValue's curve. */
const LABEL_GLIDE = "left 340ms cubic-bezier(0.22, 1, 0.36, 1), right 340ms cubic-bezier(0.22, 1, 0.36, 1)";

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
 * Trading AURA down the ranks either side of the line between two leagues,
 * drawn as the Overview sparks are: a wash and mesh under a white line. The
 * upper league's stretch is lit, the lower one's past the cut is dimmed, and
 * the cut stands at the last one in, so the reader sees where it falls and
 * how steep the climb is either side of it.
 */
export function AuraCurve({
  points,
  line,
  upper,
  lower,
}: {
  points: CurvePoint[];
  /** Trading AURA of the upper league's last trader. */
  line: number;
  /** The leagues either side of the line, upper to the right. */
  upper: string;
  lower: string;
}) {
  const inColor = leagueColor(upper);
  const outColor = leagueColor(lower);
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
  // The cut falls between the last one in and the first one out.
  const lastIn = points.filter((p) => p.inside).reduce((m, p) => Math.max(m, p.position), first);
  const firstOut = points.filter((p) => !p.inside).reduce((m, p) => Math.min(m, p.position), last);
  const cutX = x((lastIn + firstOut) / 2);

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

  // Every fifth rank and the first one out, minus any that would crowd
  // another: on a phone #1185 and #1186 printed over each other. The first
  // one out is placed first, so it is never the one dropped.
  const xTicks: number[] = [];
  for (const rank of [firstOut, ...sorted.map((p) => p.position).filter((r) => r % 5 === 0 && r !== firstOut)]) {
    if (xTicks.every((kept) => Math.abs(x(kept) - x(rank)) >= MIN_TICK_GAP)) xTicks.push(rank);
  }

  return (
    <div
      ref={ref}
      className="relative min-h-[220px] flex-1 cursor-crosshair touch-none"
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={() => setHover(null)}
    >
      {/* Three layers: the axis behind, the curve in the middle, the cut and
          the hover on top. Only the curve is revealed, and by moving two
          boxes rather than redrawing the SVG: a window slides open from the
          left while the curve inside slides back by as much, so it holds still
          and comes into view left to right. Both are transforms, which the
          compositor runs without repainting the fill's mesh every frame; the
          old dash draw and scaled rise repainted it and stuttered. */}
      {w > 0 && h > 0 && sorted.length > 1 && (
        // Keyed by the line: switching leagues fades the new axis in.
        <svg key={`axis-${upper}`} width={w} height={h} className="curve-fade absolute inset-0" aria-hidden>
          {auraTicks(lo, hi).map((t) => (
            <g key={t}>
              <line x1={PAD_LEFT} x2={w - PAD_RIGHT} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
              <text x={PAD_LEFT - 8} y={y(t) + 3} textAnchor="end" className="fill-[var(--t-text-muted)] font-mono text-[10px]">
                {auraTick(t)}
              </text>
            </g>
          ))}
        </svg>
      )}

      {w > 0 && h > 0 && sorted.length > 1 && (
        // Keyed by the line, so each league's curve is revealed afresh.
        <div key={`curve-${upper}`} className="curve-reveal pointer-events-none absolute inset-0 overflow-hidden">
          <div className="curve-reveal-inner absolute inset-0">
            <svg width={w} height={h} className="absolute inset-0" aria-hidden>
              <SparkFill gradId={gradIn} meshId={meshIn} color={inColor} />
              <SparkFill gradId={gradOut} meshId={meshOut} color={outColor} />
              <defs>
                {/* The upper league stands right of the cut, the lower left of it. */}
                <clipPath id={clipIn}>
                  <rect x={cutX} y={0} width={Math.max(0, w - cutX)} height={h} />
                </clipPath>
                <clipPath id={clipOut}>
                  <rect x={0} y={0} width={cutX} height={h} />
                </clipPath>
              </defs>
              {/* Lit where the upper league stands, dimmed past the cut. */}
              <g clipPath={`url(#${clipIn})`}>
                <path d={area} fill={`url(#${gradIn})`} />
                <path d={area} fill={`url(#${meshIn})`} />
              </g>
              <g clipPath={`url(#${clipOut})`} opacity={0.75}>
                <path d={area} fill={`url(#${gradOut})`} />
                <path d={area} fill={`url(#${meshOut})`} />
              </g>
              <path d={line_} fill="none" stroke="var(--t-spark-line)" strokeWidth="1.75" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}

      {w > 0 && h > 0 && sorted.length > 1 && (
        <svg width={w} height={h} className="absolute inset-0" aria-hidden>
          {/* The league line: the cut between the last one in and the first one
              out, standing up through the chart and flowing upward. Drawn from
              the baseline so the dashes run toward the top. */}
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
              // The first one out takes the lower league's colour, the rest stay muted.
              fill={rank === firstOut ? outColor : "var(--t-text-muted)"}
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

      {/* The zones named where they meet, at the top of the line: the lower
          league to its left, the upper to its right. That reads as the line's key
          and explains the dim and lit fills, with no legend to look up. */}
      {w > 0 && (
        <>
          <span
            className="font-label pointer-events-none absolute whitespace-nowrap"
            style={{ right: w - cutX + 8, top: 0, transition: LABEL_GLIDE }}
          >
            {/* The colour rides inside, so the outgoing name leaves in its own. */}
            <SwapValue>
              <span style={{ color: outColor }}>{lower} ◂</span>
            </SwapValue>
          </span>
          <span
            className="font-label pointer-events-none absolute whitespace-nowrap"
            style={{ left: cutX + 8, top: 0, transition: LABEL_GLIDE }}
          >
            <SwapValue>
              <span style={{ color: inColor }}>▸ {upper}</span>
            </SwapValue>
          </span>
        </>
      )}

      {/* The last one in and the first one out, pulsing like the live dot on
          the prize pool chart: the race is still on. HTML rather than SVG so
          they can use the site's ping. They land once the line reaches them. */}
      {w > 0 &&
        h > 0 &&
        sorted
          .filter((p) => p.position === lastIn || p.position === firstOut)
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
                  style={inside ? { backgroundColor: inColor } : { borderColor: outColor }}
                />
                <span
                  className={cn(
                    "relative inline-flex size-2.5 rounded-full",
                    !inside && "border-[1.5px] bg-[var(--color-bg-primary)]",
                  )}
                  style={inside ? { backgroundColor: inColor } : { borderColor: outColor }}
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
