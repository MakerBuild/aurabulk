"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { GLIDE_SPRING } from "@/components/ui/RowHighlight";

/** Vertical-tick track + pill thumb. Ticks are integer device-pixel rects —
 *  a CSS repeating mask aliases into broken strokes and uneven gaps.
 *
 *  Shared by the airdrop estimator's Allocation field and the Stats page's
 *  position size, so every slider on the site is this one.
 *
 *  The thumb and the fill ride a spring — the row highlight's — toward the
 *  pointer itself, not toward the snapped value. Snapping still decides what
 *  `onChange` reports; it just never shows up as the thumb jumping from step
 *  to step. A key press, a preset or a typed value glides the same way. */
export function TickSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  keyStep = step,
  label,
  valueText,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** Values snap to this. */
  step?: number;
  /** How far one arrow key moves; defaults to `step`. */
  keyStep?: number;
  label: string;
  valueText?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const draggingRef = useRef(false);
  const uid = useId().replace(/:/g, "");
  const [trackW, setTrackW] = useState(0);
  const clamped = Math.min(max, Math.max(min, value));
  const ratio = max > min ? (clamped - min) / (max - min) : 0;
  const padX = 10;
  const innerW = Math.max(0, trackW - padX * 2);

  // Where the thumb is headed (0–1), and where it is on the way there.
  const target = useMotionValue(ratio);
  const pos = useSpring(target, GLIDE_SPRING);

  // Follow the value unless a drag is steering: mid-drag the pointer leads
  // and the snapped value trails it, so syncing here would drag the thumb
  // back to the last step on every move.
  useEffect(() => {
    if (!draggingRef.current) target.set(ratio);
  }, [ratio, target]);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const next = el.clientWidth;
      setTrackW((prev) => (prev === next ? prev : next));
    };
    update();
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const ticks = useMemo(() => {
    const devW = Math.max(0, Math.round(innerW * dpr));
    const tick = Math.max(1, Math.round(dpr));
    const gap = Math.max(2, Math.round(3 * dpr));
    const n = Math.max(1, Math.floor((devW + gap) / (tick + gap)));
    const used = n * tick + (n - 1) * gap;
    const origin = Math.floor((devW - used) / 2);
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(origin + i * (tick + gap));
    return { devW, tick, xs };
  }, [innerW, dpr]);

  // A percentage of the viewBox rather than pixels: the transform keeps the
  // closure it was made with, and the track measures 0 wide on first render.
  const fillWidth = useTransform(pos, (r) => `${Math.min(1, Math.max(0, r)) * 100}%`);
  const thumbLeft = useTransform(
    pos,
    (r) => `calc(${padX}px + (100% - ${padX * 2}px) * ${Math.min(1, Math.max(0, r))})`,
  );

  const commit = (next: number) => {
    const snapped = Math.min(max, Math.max(min, Math.round(next / step) * step));
    if (snapped === valueRef.current) return;
    onChange(snapped);
  };

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const inner = rect.width - padX * 2;
    if (inner <= 0) return;
    const r = Math.min(1, Math.max(0, (clientX - rect.left - padX) / inner));
    target.set(r);
    commit(min + r * (max - min));
  };

  const endDrag = () => {
    draggingRef.current = false;
    // Settle onto the step the value landed on — a hair's glide at most.
    const v = Math.min(max, Math.max(min, valueRef.current));
    target.set(max > min ? (v - min) / (max - min) : 0);
  };

  const maskId = `${uid}-ticks`;
  const gradId = `${uid}-glow`;
  const svgH = Math.max(8, Math.round(14 * dpr));

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      tabIndex={0}
      className="relative h-8 min-w-0 cursor-pointer touch-none overflow-hidden rounded-full border border-[var(--color-line-strong)] bg-[rgb(var(--t-veil-rgb)/0.035)] outline-none select-none focus-visible:ring-1 focus-visible:ring-accent/50"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setFromClientX(e.clientX);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          commit(clamped - keyStep);
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          commit(clamped + keyStep);
        } else if (e.key === "Home") {
          e.preventDefault();
          commit(min);
        } else if (e.key === "End") {
          e.preventDefault();
          commit(max);
        }
      }}
    >
      <div className="pointer-events-none absolute inset-[7px_10px] min-w-0 overflow-hidden">
        {ticks.devW > 0 && (
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${ticks.devW} ${svgH}`}
            preserveAspectRatio="none"
            className="block h-full w-full"
            style={{ minWidth: 0, overflow: "hidden" }}
            shapeRendering="crispEdges"
          >
            <defs>
              <mask id={maskId} maskUnits="userSpaceOnUse">
                {ticks.xs.map((x) => (
                  <rect
                    key={x}
                    x={x}
                    y={0}
                    width={ticks.tick}
                    height={svgH}
                    /* Mask channel, not a colour: white = opaque. Must not
                       be themed or the tick mask stops masking. */
                    fill="#fff"
                  />
                ))}
              </mask>
              {/* Faded at the start of the fill, full accent at the thumb.
                  Bounding-box units, so the ramp spans the filled run
                  whatever its length, and it takes each theme's own accent. */}
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--t-accent)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--t-accent)" stopOpacity={1} />
              </linearGradient>
            </defs>
            <rect
              x="0"
              y="0"
              width={ticks.devW}
              height={svgH}
              fill="rgb(var(--t-veil-rgb)/0.16)"
              mask={`url(#${maskId})`}
            />
            <motion.rect
              x="0"
              y="0"
              width={fillWidth}
              height={svgH}
              fill={`url(#${gradId})`}
              mask={`url(#${maskId})`}
            />
          </svg>
        )}
      </div>
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 h-[18px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_1px_6px_rgba(0,0,0,0.45)]"
        style={{ left: thumbLeft }}
      />
    </div>
  );
}
