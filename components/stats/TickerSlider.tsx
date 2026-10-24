"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { animate, motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Fisheye: a ticker's size and opacity by its distance from the middle.
 *  Size falls off within about a ticker either side, so only the picked one
 *  reads as magnified; opacity fades over the whole strip, so the far ends
 *  are faint but still there to click. */
const LENS_SCALE = 1.12;
const MIN_SCALE = 0.86;
const SCALE_SPREAD_PX = 46;
const MIN_OPACITY = 0.3;
const OPACITY_SPREAD_PX = 130;
/** Fade at both ends of the strip, over the faintest tickers. */
const EDGE_FADE_PX = 36;
const GAP_PX = 2;
/** The glide to a ticker: soft enough to read as a slide, settled in about
 *  half a second, and retargeted mid-flight without a jolt. */
const GLIDE = { type: "spring", stiffness: 190, damping: 28, mass: 1 } as const;
const LENS_GLIDE = { type: "spring", stiffness: 320, damping: 32 } as const;
/** Wheel travel for one ticker: a mouse notch is about 100px, so one notch is
 *  one step, and a trackpad has to travel a little before the next. */
const WHEEL_STEP_PX = 60;
const WHEEL_GAP_MS = 90;
/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_SLOP_PX = 5;
/** How far a released drag's speed carries it, in seconds of that speed. */
const FLING_S = 0.18;

function fisheye(distance: number): { scale: number; opacity: number } {
  const near = Math.exp(-((distance / SCALE_SPREAD_PX) ** 2));
  const seen = Math.exp(-((distance / OPACITY_SPREAD_PX) ** 2));
  return {
    scale: MIN_SCALE + (LENS_SCALE - MIN_SCALE) * near,
    opacity: MIN_OPACITY + (1 - MIN_OPACITY) * seen,
  };
}

/** `v` folded into one turn of the loop, centred on zero. */
function wrap(v: number, loop: number): number {
  return ((((v + loop / 2) % loop) + loop) % loop) - loop / 2;
}

interface Slot {
  /** Index into `options`. */
  market: number;
  /** Centre along one turn of the strip. */
  center: number;
  width: number;
}

/**
 * The market picker: an endless strip of tickers that glides under a fixed
 * lens, so the picked market always sits in the middle with others either
 * side, never a gap. Tickers shrink and fade with distance and stay
 * clickable; a click, an arrow, a wheel notch or a drag brings one under the
 * lens, where the pill eases to its width.
 *
 * Motion runs on one spring-driven offset that every ticker derives its
 * place, size and opacity from, outside React renders. The market switch it
 * triggers is a transition, so the page re-rendering for the new market
 * yields to the glide instead of stalling it.
 */
export function TickerSlider<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(0);
  const [widths, setWidths] = useState<number[] | null>(null);

  // Each ticker's natural width, from an unseen copy of the row: the strip's
  // own tickers are scaled and placed by hand.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const row = measureRef.current;
    if (!track || !row) return;
    const read = () => {
      setTrackW(track.clientWidth);
      const next = [...row.children].map((el) => (el as HTMLElement).offsetWidth);
      setWidths((prev) => (prev && prev.length === next.length && prev.every((w, i) => w === next[i]) ? prev : next));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(track);
    ro.observe(row);
    return () => ro.disconnect();
  }, [options]);

  // The row repeated until one turn is wider than the strip plus a ticker
  // each side, so the seam where the loop closes is always out of sight.
  const { slots, loop } = useMemo(() => {
    if (!widths || widths.length !== options.length || !widths.length) return { slots: [] as Slot[], loop: 1 };
    const turn = widths.reduce((sum, w) => sum + w + GAP_PX, 0);
    const widest = Math.max(...widths);
    const copies = Math.max(1, Math.ceil((trackW + 2 * widest) / turn));
    const out: Slot[] = [];
    let x = 0;
    for (let c = 0; c < copies; c++) {
      widths.forEach((w, market) => {
        out.push({ market, center: x + w / 2, width: w });
        x += w + GAP_PX;
      });
    }
    return { slots: out, loop: x };
  }, [widths, options.length, trackW]);

  const offset = useMotionValue(0);
  const lensW = useMotionValue(0);
  /** The slot under the lens, or heading there. */
  const at = useRef(-1);
  const latest = useRef({ options, value, onChange, slots, loop });
  // A layout effect, and before the one that places the strip below, so
  // that one already reads this render's slots.
  useLayoutEffect(() => {
    latest.current = { options, value, onChange, slots, loop };
  });
  /** The market this strip last showed as picked, ahead of the page. */
  const shown = useRef<T | null>(null);

  /** Glide (or jump) to a slot, the short way round the loop. */
  const goTo = useCallback(
    (slot: number, smooth: boolean) => {
      const { slots: list, loop: turn } = latest.current;
      const s = list[slot];
      if (!s) return;
      at.current = slot;
      const target = offset.get() + wrap(s.center - offset.get(), turn);
      const width = s.width * LENS_SCALE;
      if (smooth) {
        animate(offset, target, GLIDE);
        animate(lensW, width, LENS_GLIDE);
      } else {
        offset.stop();
        offset.set(target);
        lensW.set(width);
      }
    },
    [offset, lensW],
  );

  /** A pick from the strip itself: it moves now, the page follows. */
  const pick = useCallback(
    (slot: number) => {
      const { slots: list, options: opts, onChange: change } = latest.current;
      const s = list[slot];
      if (!s) return;
      goTo(slot, true);
      const next = opts[s.market].value;
      if (next === shown.current) return;
      shown.current = next;
      startTransition(() => change(next));
    },
    [goTo],
  );

  const step = useCallback(
    (dir: -1 | 1) => {
      const n = latest.current.slots.length;
      if (n < 2 || at.current < 0) return;
      pick((((at.current + dir) % n) + n) % n);
    },
    [pick],
  );

  // Follow the page's market: placed outright on first layout and whenever
  // the strip is laid out again (a resize, fonts arriving), glided to when it
  // changes from outside the strip. The page catching up with a pick made
  // here changes nothing: the strip is already on its way.
  const laidOut = useRef<Slot[] | null>(null);
  useLayoutEffect(() => {
    if (!slots.length) return;
    const market = options.findIndex((o) => o.value === value);
    if (market < 0) return;
    const relaid = laidOut.current !== slots;
    laidOut.current = slots;
    const outside = value !== shown.current;
    shown.current = value;
    if (!relaid && !outside) return;
    // The copy of that market nearest where the strip already is.
    let best = -1;
    let bestD = Infinity;
    slots.forEach((s, i) => {
      if (s.market !== market) return;
      const d = Math.abs(wrap(s.center - offset.get(), loop));
      if (d < bestD) [best, bestD] = [i, d];
    });
    goTo(best, !relaid && at.current >= 0);
  }, [slots, loop, options, value, goTo, offset]);

  // The wheel steps one ticker at a time, round and round, anywhere on the
  // strip, arrows included. Bound natively: React's wheel listener is passive
  // and cannot preventDefault. That alone no longer holds the page still:
  // the site's smooth scroll (Lenis) reads the wheel on the window and does
  // not look at defaultPrevented, so the strip carries data-lenis-prevent-wheel
  // for it to skip.
  useEffect(() => {
    const track = rootRef.current;
    if (!track) return;
    let travel = 0;
    let lastStep = 0;
    const onWheel = (e: WheelEvent) => {
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const delta = e.deltaMode === 1 ? raw * 32 : raw;
      if (!delta) return;
      e.preventDefault();
      const dir = delta > 0 ? 1 : -1;
      if (Math.sign(travel) !== dir) travel = 0;
      travel += delta;
      const now = performance.now();
      if (Math.abs(travel) >= WHEEL_STEP_PX && now - lastStep >= WHEEL_GAP_MS) {
        travel = 0;
        lastStep = now;
        step(dir);
      }
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    return () => track.removeEventListener("wheel", onWheel);
  }, [step]);

  // Drag (mouse or touch) moves the strip under the finger; on release it
  // carries on with the finger's speed and settles on the nearest ticker.
  const drag = useRef<{ id: number; x0: number; o0: number; moving: boolean } | null>(null);
  const swallowClick = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !slots.length) return;
    drag.current = { id: e.pointerId, x0: e.clientX, o0: offset.get(), moving: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.moving) {
      if (Math.abs(dx) < DRAG_SLOP_PX) return;
      d.moving = true;
      offset.stop();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is already gone; the drag simply ends with it.
      }
    }
    offset.set(d.o0 - dx);
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moving) return;
    swallowClick.current = true;
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 0);
    const landing = offset.get() + offset.getVelocity() * FLING_S;
    let best = -1;
    let bestD = Infinity;
    slots.forEach((s, i) => {
      const dist = Math.abs(wrap(s.center - landing, loop));
      if (dist < bestD) [best, bestD] = [i, dist];
    });
    pick(best);
  };

  const half = trackW / 2;
  const clip = useTransform(lensW, (w) => `inset(0 ${Math.max(0, half - w / 2)}px round 7px)`);
  const mask = `linear-gradient(to right, transparent 0, #000 ${EDGE_FADE_PX}px, #000 calc(100% - ${EDGE_FADE_PX}px), transparent 100%)`;

  return (
    // `shrink!`: .term-seg holds its width outside the utilities.
    <div ref={rootRef} data-lenis-prevent-wheel className={cn("term-seg w-full min-w-0 shrink!", className)}>
      <ArrowButton dir={-1} onClick={() => step(-1)} disabled={options.length < 2} />
      <div
        ref={trackRef}
        className="relative h-[21px] min-w-0 flex-1 touch-pan-y select-none overflow-hidden"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (swallowClick.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {/* Unseen: measures each ticker at its natural size. */}
        <div ref={measureRef} className="pointer-events-none invisible absolute left-0 top-0 flex" aria-hidden="true">
          {options.map((o) => (
            <span key={o.value} className="ticker-btn" style={{ position: "static" }}>
              {o.label}
            </span>
          ))}
        </div>
        {slots.map((s, i) => (
          <Tick
            key={i}
            label={options[s.market].label}
            slot={s}
            offset={offset}
            loop={loop}
            half={half}
            pressed={options[s.market].value === value}
            // Only the first copy speaks to assistive tech; the rest repeat it.
            hidden={i >= options.length}
            onPick={() => pick(i)}
          />
        ))}
        {/* The lens: the pill, with the strip again in the on-pill colour
            inside it, clipped to the pill. */}
        <motion.div className="ticker-lens" style={{ clipPath: clip }} aria-hidden="true">
          {slots.map((s, i) => (
            <Tick key={i} label={options[s.market].label} slot={s} offset={offset} loop={loop} half={half} ghost />
          ))}
        </motion.div>
      </div>
      <ArrowButton dir={1} onClick={() => step(1)} disabled={options.length < 2} />
    </div>
  );
}

function Tick({
  label,
  slot,
  offset,
  loop,
  half,
  ghost,
  pressed,
  hidden,
  onPick,
}: {
  label: string;
  slot: Slot;
  offset: MotionValue<number>;
  loop: number;
  half: number;
  ghost?: boolean;
  pressed?: boolean;
  hidden?: boolean;
  onPick?: () => void;
}) {
  const d = useTransform(offset, (o) => wrap(slot.center - o, loop));
  const x = useTransform(d, (v) => half + v - slot.width / 2);
  const scale = useTransform(d, (v) => fisheye(Math.abs(v)).scale);
  const opacity = useTransform(d, (v) => fisheye(Math.abs(v)).opacity);

  if (ghost) {
    return (
      <motion.span className="ticker-btn" style={{ x, scale }}>
        {label}
      </motion.span>
    );
  }
  return (
    <motion.button
      type="button"
      className="ticker-btn"
      style={{ x, scale, opacity }}
      onClick={onPick}
      aria-pressed={pressed}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
    >
      {label}
    </motion.button>
  );
}

function ArrowButton({ dir, disabled, onClick }: { dir: -1 | 1; disabled: boolean; onClick: () => void }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir < 0 ? "Previous market" : "Next market"}
      className={cn(
        "term-seg-btn is-off relative z-10 flex-none! px-1.5!",
        disabled && "pointer-events-none opacity-30",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
