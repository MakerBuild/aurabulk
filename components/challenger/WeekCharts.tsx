"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CHART_GOLD } from "@/lib/overview-metrics";
import { formatUtcTime } from "@/components/overview/spark-format";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** The least a plot is drawn at. It takes whatever height its card gives
 *  it beyond that, so both cards' charts grow alike to fill them. */
const PLOT_H = 54;
const PAD_TOP = 6;
/** The curve's own margins inside its plot: room above for the projection's
 *  end marker and to its right for the marker's radius, so neither the line
 *  nor the marker runs past the plot into the card's header. */
const CURVE_TOP = 12;
const CURVE_RIGHT = 6;

/** Campaign days open at the Saturday 12:00 snapshot. */
const DAY_LABELS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** The plot is drawn in real pixels, not a stretched viewBox, so the dot
 *  stays round and the dashes keep their length at any card width. */
function useBox<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (width: number, height: number) =>
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    // Read now as well: the observer's first report waits for a painted frame.
    const rect = el.getBoundingClientRect();
    read(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => read(entry.contentRect.width, entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, box];
}

/** `Tue 13:00`, UTC, as the Overview sparks read their times. */
function formatWhen(t: number): string {
  const day = new Date(t).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${day} ${formatUtcTime(t)}`;
}

/** Readout at the top of a plot, styled as the Overview spark tooltip. Near
 *  either edge it hangs inward so it is never clipped by the card. */
export function Tip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const transform = x > width - 90 ? "translate(-100%, 0)" : x < 90 ? "none" : "translate(-50%, 0)";
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-1.5 py-1 shadow-[var(--t-shadow-pop)]"
      style={{ left: x, transform }}
    >
      {children}
    </div>
  );
}

export function TipLine({ label, value }: { label: string; value: string }) {
  return (
    <>
      <p className="m-0 font-mono text-[9.5px] leading-none text-text-muted tabular-nums">{label}</p>
      <p className="m-0 mt-0.5 font-mono text-[10.5px] leading-none text-text-primary tabular-nums">{value}</p>
    </>
  );
}

/** Sat to Fri under a plot, the current day picked out. */
function DayAxis({ today, active }: { today: number; active?: number | null }) {
  return (
    <div className="mt-1.5 grid grid-cols-7">
      {DAY_LABELS.map((day, i) => (
        <span
          key={day}
          className={cn(
            "font-data text-center !text-[10px] leading-none transition-colors",
            i === active ? "text-text-primary" : i === today ? "text-accent" : "text-text-muted",
          )}
        >
          {day}
        </span>
      ))}
    </div>
  );
}

function dayIndex(weekStart: number, t: number): number {
  return Math.min(6, Math.max(0, Math.floor((t - weekStart) / DAY_MS)));
}

/** Gold wash plus the diamond mesh the Overview sparks fill with. */
export function SparkFill({
  gradId,
  meshId,
  color = CHART_GOLD,
}: {
  gradId: string;
  meshId: string;
  /** The wash and mesh colour; gold unless a chart paints by league. */
  color?: string;
}) {
  return (
    <defs>
      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
        <stop offset="100%" stopColor={color} stopOpacity="0.03" />
      </linearGradient>
      <pattern id={meshId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <circle cx="1" cy="1" r="0.55" fill={color} fillOpacity="0.4" />
      </pattern>
    </defs>
  );
}

/**
 * The prize pool through the week: how it has built up from the Saturday
 * snapshot to now, and a dashed run to where this pace ends it next Saturday.
 * Hovering reads the pool at any hour, recorded behind now, projected ahead.
 */
export function PoolCurve({
  weekStart,
  now,
  points,
  projectedUsd,
  emphasis = "current",
  format,
}: {
  weekStart: number;
  now: number;
  /** Cumulative pool, oldest first, ending at `now`. */
  points: { t: number; usd: number }[];
  projectedUsd: number;
  /** Which end the card's figure is reading: now, or Saturday's projection. */
  emphasis?: "current" | "projected";
  format: (n: number) => string;
}) {
  const projected = emphasis === "projected";
  const [ref, { width, height }] = useBox<HTMLDivElement>();
  const plotH = Math.max(PLOT_H, height);
  const gradId = useId();
  const meshId = useId();
  const [hoverT, setHoverT] = useState<number | null>(null);
  const last = points[points.length - 1];
  const top = Math.max(projectedUsd, last?.usd ?? 0) || 1;
  const plotW = Math.max(0, width - CURVE_RIGHT);
  const x = (t: number) => ((t - weekStart) / WEEK_MS) * plotW;
  const y = (usd: number) => plotH - (usd / top) * (plotH - CURVE_TOP);

  let line = "";
  let area = "";
  if (width > 0 && points.length > 1) {
    line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.usd).toFixed(1)}`).join(" ");
    area = `${line} L${x(last.t).toFixed(1)},${plotH} L0,${plotH} Z`;
  }

  // The hovered moment: the nearest recorded point behind now, or a point on
  // the projection ahead of it.
  let hover: { t: number; usd: number; projected: boolean } | null = null;
  if (hoverT != null && last) {
    if (hoverT >= last.t) {
      const share = (hoverT - last.t) / Math.max(1, weekStart + WEEK_MS - last.t);
      hover = { t: hoverT, usd: last.usd + (projectedUsd - last.usd) * share, projected: hoverT > last.t + 60_000 };
    } else {
      let best = points[0];
      for (const p of points) if (Math.abs(p.t - hoverT) < Math.abs(best.t - hoverT)) best = p;
      hover = { ...best, projected: false };
    }
  }

  function pick(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    // Against the curve's own width, so the pointer sits on the point it reads.
    const share = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width - CURVE_RIGHT)));
    setHoverT(weekStart + share * WEEK_MS);
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={ref}
        className="relative flex-1 cursor-crosshair touch-none"
        style={{ minHeight: PLOT_H }}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHoverT(null)}
      >
        {width > 0 && last && (
          <svg width={width} height={plotH} className="spark-reveal absolute inset-0" aria-hidden>
            <SparkFill gradId={gradId} meshId={meshId} />
            {/* Day boundaries, so the curve reads against the axis below. */}
            {Array.from({ length: 6 }, (_, i) => (
              <line
                key={i}
                x1={((i + 1) / 7) * plotW}
                x2={((i + 1) / 7) * plotW}
                y1={0}
                y2={plotH}
                stroke="var(--color-line)"
                strokeDasharray="2 4"
              />
            ))}
            <line x1={0} x2={width} y1={plotH - 0.5} y2={plotH - 0.5} stroke="var(--color-line-strong)" />
            <path d={area} fill={`url(#${gradId})`} />
            <path d={area} fill={`url(#${meshId})`} />
            <path d={line} fill="none" stroke="var(--t-spark-line)" strokeWidth="1.75" strokeLinejoin="round" />
            <line
              x1={x(last.t)}
              y1={y(last.usd)}
              x2={plotW}
              y2={y(projectedUsd)}
              stroke={CHART_GOLD}
              strokeWidth={projected ? 2 : 1.5}
              strokeDasharray="4 4"
              strokeOpacity={projected ? 1 : 0.8}
              className="transition-[stroke-width,stroke-opacity] duration-300"
            />
            <circle
              cx={plotW}
              cy={y(projectedUsd)}
              r={projected ? 3.5 : 3}
              fill={projected ? CHART_GOLD : "var(--color-bg-primary)"}
              stroke={CHART_GOLD}
              strokeWidth="1.5"
            />
            {hover && (
              <>
                <line x1={x(hover.t)} x2={x(hover.t)} y1={0} y2={plotH} stroke="var(--color-line-strong)" />
                <circle
                  cx={x(hover.t)}
                  cy={y(hover.usd)}
                  r="3.5"
                  fill={hover.projected ? "var(--color-bg-primary)" : CHART_GOLD}
                  stroke={CHART_GOLD}
                  strokeWidth="1.5"
                />
              </>
            )}
          </svg>
        )}
        {width > 0 && last && !hover && (
          // HTML, not SVG, so the pulse can use the site's ping animation.
          <span
            className="pointer-events-none absolute flex size-2.5 -translate-x-1/2 -translate-y-1/2"
            style={{ left: x(now), top: y(last.usd) }}
            aria-hidden
          >
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
          </span>
        )}
        {hover && (
          <Tip x={x(hover.t)} width={width}>
            <TipLine
              label={hover.projected ? `${formatWhen(hover.t)} · projected` : formatWhen(hover.t)}
              value={format(hover.usd)}
            />
          </Tip>
        )}
      </div>
      <DayAxis today={dayIndex(weekStart, now)} active={hover ? dayIndex(weekStart, hover.t) : null} />
    </div>
  );
}

/**
 * Taker volume for each day of the week: past days settled, today still
 * filling, days ahead drawn as empty slots so the week keeps all seven.
 * Hovering a day reads its volume and its share of the week.
 */
export function DayBars({
  weekStart,
  now,
  days,
  format,
}: {
  weekStart: number;
  now: number;
  /** Seven values, Saturday first; days ahead are 0. */
  days: number[];
  format: (n: number) => string;
}) {
  const [ref, { width, height }] = useBox<HTMLDivElement>();
  const plotH = Math.max(PLOT_H, height);
  const [active, setActive] = useState<number | null>(null);
  const today = dayIndex(weekStart, now);
  const top = Math.max(...days) || 1;
  const total = days.reduce((sum, v) => sum + v, 0);

  function pickDay(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const share = (event.clientX - rect.left) / Math.max(1, rect.width);
    setActive(Math.min(6, Math.max(0, Math.floor(share * 7))));
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={ref}
        className="relative grid cursor-pointer touch-none grid-cols-7 items-end gap-1.5 border-b border-[var(--color-line-strong)] sm:gap-2"
        style={{ minHeight: PLOT_H }}
        // The day comes from the pointer's x over the whole plot, so the gaps
        // between bars and a finger dragging across them both pick a day.
        onPointerMove={pickDay}
        onPointerDown={pickDay}
        onPointerLeave={() => setActive(null)}
      >
        {days.map((usd, i) => {
          const ahead = i > today;
          return (
            <div key={DAY_LABELS[i]} className="flex h-full flex-col justify-end">
              {ahead ? (
                <div
                  className={cn(
                    "h-1.5 rounded-t-[3px] border border-b-0 border-dashed border-[var(--color-line-strong)] transition-opacity",
                    active != null && active !== i && "opacity-40",
                  )}
                />
              ) : (
                <div
                  className={cn(
                    "rounded-t-[3px] duration-300",
                    i === today || i === active ? "bg-accent" : "bg-[rgb(var(--t-accent-rgb)/0.35)]",
                    active != null && active !== i && "opacity-50",
                    // Today is still filling, so it breathes on the site's
                    // gold beat, and rests while another day is being read.
                    // No opacity transition on it: one cancels the pulse in
                    // Chromium.
                    i === today
                      ? cn("transition-[height,background-color]", (active == null || active === i) && "apr-week-pulse")
                      : "transition-[height,opacity,background-color]",
                  )}
                  style={{ height: `${Math.max(3, (usd / top) * (plotH - PAD_TOP))}px` }}
                />
              )}
            </div>
          );
        })}
        {active != null && width > 0 && (
          <Tip x={((active + 0.5) / 7) * width} width={width}>
            {active > today ? (
              <TipLine label={DAY_LABELS[active]} value="Not started" />
            ) : (
              <TipLine
                label={`${DAY_LABELS[active]}${active === today ? " · so far" : ""} · ${total > 0 ? Math.round((days[active] / total) * 100) : 0}% of week`}
                value={format(days[active])}
              />
            )}
          </Tip>
        )}
      </div>
      <DayAxis today={today} active={active} />
    </div>
  );
}
