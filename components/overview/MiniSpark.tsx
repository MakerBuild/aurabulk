"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CHART_GOLD } from "@/lib/overview-metrics";

export type SparkRow = { t: number; value: number };

type SparkPt = SparkRow & { x: number; y: number };

const VW = 300;
const VH = 56;
const PAD_X = 10;
const PAD_TOP = 8;
const PAD_BOT = 4;
/** Fixed sample count so 24H ↔ Total morphs the same path commands. */
const SAMPLES = 48;
const MORPH_MS = 420;
/** viewBox x past which the hover tooltip hangs inward instead of centring. */
const TIP_FLIP_LEFT = 40;
const TIP_FLIP_RIGHT = 220;


function sampleSeries(rows: SparkRow[], n: number): SparkRow[] {
  if (!rows.length) return [];
  const source =
    rows.length === 1 ? [{ t: rows[0].t - 60_000, value: rows[0].value }, rows[0]] : rows;
  const last = source.length - 1;
  const out: SparkRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const pos = last * (n === 1 ? 0 : i / (n - 1));
    const lo = Math.floor(pos);
    const hi = Math.min(last, lo + 1);
    const f = pos - lo;
    out.push({
      t: source[lo].t + (source[hi].t - source[lo].t) * f,
      value: source[lo].value + (source[hi].value - source[lo].value) * f,
    });
  }
  return out;
}

function ysFromValues(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const h = VH - PAD_TOP - PAD_BOT;
  return values.map((value) => PAD_TOP + (1 - (value - min) / span) * h);
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** Flatten the first segment mid-morph so 24H↔Total start-Y does not lash. */
function morphYs(fromYs: number[], toYs: number[], u: number): number[] {
  const raw = fromYs.map((y, i) => lerp(y, toYs[i], u));
  const pull = Math.sin(Math.PI * u) * 0.62;
  if (pull <= 0 || raw.length < 4) return raw;
  const out = raw.slice();
  for (let i = 0; i < 3; i += 1) {
    out[i] += (raw[i + 1] - out[i]) * pull * (1 - i / 3);
  }
  return out;
}

function pathFromYs(ys: number[]): { line: string; area: string; xs: number[] } {
  const lastI = Math.max(1, ys.length - 1);
  const xs = ys.map((_, i) => PAD_X + (i / lastI) * (VW - PAD_X * 2));
  const line = ys
    .map((y, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  return {
    line,
    area: `${line} L${xs[xs.length - 1].toFixed(1)},${VH} L${xs[0].toFixed(1)},${VH} Z`,
    xs,
  };
}

/** Content key for the series: callers may hand over a fresh array each
 * render, so the morph keys off every point rather than the array identity. */
function seriesSig(rows: SparkRow[]): string {
  return rows.map((r) => `${r.t}:${r.value}`).join(",");
}

function useMorphedSpark(rows: SparkRow[]): { pts: SparkPt[]; line: string; area: string } | null {
  const [frame, setFrame] = useState<{ meta: SparkRow[]; ys: number[] } | null>(() => {
    const target = sampleSeries(rows, SAMPLES);
    if (!target.length) return null;
    return { meta: target, ys: ysFromValues(target.map((r) => r.value)) };
  });
  const frameRef = useRef(frame);
  const rowsRef = useRef(rows);
  const rafRef = useRef(0);
  const sig = seriesSig(rows);
  rowsRef.current = rows;

  useEffect(() => {
    const target = sampleSeries(rowsRef.current, SAMPLES);
    if (!target.length) {
      frameRef.current = null;
      setFrame(null);
      return;
    }
    const toYs = ysFromValues(target.map((r) => r.value));
    const from = frameRef.current;
    if (!from || from.ys.length !== toYs.length) {
      const next = { meta: target, ys: toYs };
      frameRef.current = next;
      setFrame(next);
      return;
    }
    const fromYs = from.ys;
    const fromMeta = from.meta;
    const started = performance.now();
    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const u = easeOutCubic(Math.min(1, (now - started) / MORPH_MS));
      const ys = morphYs(fromYs, toYs, u);
      const meta = fromMeta.map((row, i) => ({
        t: lerp(row.t, target[i].t, u),
        value: lerp(row.value, target[i].value, u),
      }));
      const next = { meta, ys };
      frameRef.current = next;
      setFrame(next);
      if (u < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [sig]);

  if (!frame) return null;
  const { line, area, xs } = pathFromYs(frame.ys);
  return {
    line,
    area,
    pts: frame.meta.map((row, i) => ({ ...row, x: xs[i], y: frame.ys[i] })),
  };
}

export function MiniSpark({
  rows,
  formatValue,
  formatTime,
}: {
  rows: SparkRow[];
  formatValue: (n: number) => string;
  formatTime: (t: number) => string;
}) {
  const gradId = useId();
  const meshId = useId();
  const fadeId = useId();
  const maskId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const geo = useMorphedSpark(rows);
  const active = hover != null && geo ? geo.pts[hover] : null;

  function pick(clientX: number, target: HTMLElement) {
    if (!geo) return;
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * VW;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < geo.pts.length; i += 1) {
      const d = Math.abs(geo.pts[i].x - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  }

  if (!geo) return <div className="min-h-[64px] min-w-0 flex-1" />;

  const last = geo.pts[geo.pts.length - 1];

  return (
    <div className="flex min-h-[56px] min-w-0 flex-1 flex-col justify-end">

      <div
        className="relative min-h-[44px] w-full flex-1 cursor-crosshair overflow-hidden"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        {active && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] px-1.5 py-1 shadow-[0_10px_24px_rgba(0,0,0,.5)]"
            style={{
              left: `${(active.x / VW) * 100}%`,
              top: 0,
              // Near either end the tooltip hangs inward so it isn't clipped.
              transform:
                active.x > TIP_FLIP_RIGHT
                  ? "translate(-100%, 0)"
                  : active.x < TIP_FLIP_LEFT
                    ? "none"
                    : "translate(-50%, 0)",
            }}
          >
            <p className="m-0 font-mono text-[9.5px] leading-none text-text-muted tabular-nums">
              {formatTime(active.t)}
            </p>
            <p className="m-0 mt-0.5 font-mono text-[10.5px] leading-none text-text-primary tabular-nums">
              {formatValue(active.value)}
            </p>
          </div>
        )}
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="none"
          className="absolute inset-0 block h-full w-full"
          aria-hidden
        >
          <defs>
            {/* Flat wash under the mesh, so the fill still reads as solid
                colour where the mesh dots leave gaps. */}
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_GOLD} stopOpacity="0.3" />
              <stop offset="100%" stopColor={CHART_GOLD} stopOpacity="0.04" />
            </linearGradient>
            {/* Mosaic: a dot lattice turned 45 degrees so it reads as a fine
                diamond mesh rather than as rows. The viewBox is drawn with
                preserveAspectRatio="none", so the tile stretches with the
                card — intended, it keeps the mesh density constant. */}
            <pattern
              id={meshId}
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <circle cx="1" cy="1" r="0.55" fill={CHART_GOLD} fillOpacity="0.55" />
            </pattern>
            {/* Depth fade for the mesh. White here is a mask channel, not a
                colour: it must stay white in both themes. */}
            <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0.1" />
            </linearGradient>
            <mask id={maskId}>
              <rect x="0" y="0" width={VW} height={VH} fill={`url(#${fadeId})`} />
            </mask>
          </defs>
          <path d={geo.area} fill={`url(#${gradId})`} />
          <path d={geo.area} fill={`url(#${meshId})`} mask={`url(#${maskId})`} />
          <path
            d={geo.line}
            fill="none"
            stroke="var(--t-spark-line)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={last.x} cy={last.y} r="2.6" fill={CHART_GOLD} />
          {active && (
            <line
              x1={active.x}
              x2={active.x}
              y1="0"
              y2={VH}
              stroke="rgb(var(--t-veil-rgb)/0.22)"
              strokeWidth="1"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
