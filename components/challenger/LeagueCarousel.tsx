"use client";

import { Children, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** How far apart neighbouring cards sit, as a share of one card's width. */
const STEP = 0.8;
/** Settling pace: the gap to the resting card closes by ~63% every this many ms. */
const SETTLE_MS = 110;
/** How far a press has to travel before it is a swipe rather than a tap. */
const DRAG_PX = 6;
/** A flick carries on as far as this many ms more at its release speed. */
const FLING_MS = 220;

/** Where a card sits from the centre, in cards, on a loop: -n/2 up to n/2. */
function wrap(offset: number, n: number): number {
  return ((((offset + n / 2) % n) + n) % n) - n / 2;
}

/**
 * A card `offset` cards from the centre. The centre card is full size and the
 * rest shrink and fade as they move off it, like a fisheye; `--focus` (1 at
 * the centre, 0 one card out) lets a card's contents swell on top of that.
 * Translation is in percent of the card's own width, so nothing is measured.
 */
function place(offset: number) {
  const d = Math.min(Math.abs(offset), 2);
  return {
    transform: `translateX(${offset * STEP * 100}%) scale(${1 - 0.2 * d})`,
    opacity: Math.max(0, 1 - 0.55 * d),
    zIndex: 10 - Math.round(d * 4),
    focus: Math.max(0, 1 - d),
  };
}

/**
 * An endless ribbon of cards for narrow screens: one centred, its neighbours
 * peeking in small and faded at either edge. Swipe or flick it, tap a
 * neighbour to bring it in, or use the arrow keys. Past the last card it runs
 * straight on into the first. `onPick` hears which card it is heading for the
 * moment a swipe lets go, not once it has come to rest, so what the card
 * drives can answer straight away.
 *
 * Frames are written straight to the cards, out of React, so a drag keeps up
 * with the finger; React only draws the resting position.
 */
export function LeagueCarousel({
  children,
  label,
  className,
  onPick,
}: {
  children: React.ReactNode;
  label: string;
  className?: string;
  /** The card the ribbon is now heading for, and which way it went to get
   *  there: 1 on to the next card, −1 back to the one before. */
  onPick?: (index: number, step: 1 | -1) => void;
}) {
  const slides = Children.toArray(children);
  const n = slides.length;
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const [rest, setRest] = useState(0);
  // `pos` is where the ribbon is now, in cards; `target` where it is heading.
  const pos = useRef(0);
  const target = useRef(0);
  const frame = useRef(0);
  const swiped = useRef(false);
  // The card last reported to onPick, so a tap on the one already centred
  // or a settle back to where it started reports nothing.
  const picked = useRef(0);
  const drag = useRef<{
    id: number;
    x: number;
    from: number;
    moved: boolean;
    samples: { t: number; x: number }[];
  } | null>(null);

  const draw = useCallback(() => {
    cards.current.forEach((el, i) => {
      if (!el) return;
      const p = place(wrap(i - pos.current, n));
      el.style.transform = p.transform;
      el.style.opacity = String(p.opacity);
      el.style.zIndex = String(p.zIndex);
      el.style.setProperty("--focus", String(p.focus));
    });
  }, [n]);

  const settle = useCallback(() => {
    cancelAnimationFrame(frame.current);
    let last = performance.now();
    const tick = (t: number) => {
      const k = 1 - Math.exp(-Math.max(0, t - last) / SETTLE_MS);
      last = t;
      pos.current += (target.current - pos.current) * k;
      if (Math.abs(target.current - pos.current) < 0.0005) {
        // Fold back into 0..n so the count never runs away.
        const home = ((target.current % n) + n) % n;
        pos.current = target.current = home;
        draw();
        setRest(home);
        return;
      }
      draw();
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [draw, n]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Head for a card: report it, then glide there.
  const aim = (next: number) => {
    target.current = next;
    const index = ((next % n) + n) % n;
    if (index !== picked.current) {
      const step = wrap(index - picked.current, n) > 0 ? 1 : -1;
      picked.current = index;
      onPick?.(index, step);
    }
    settle();
  };

  const go = (by: number) => aim(Math.round(target.current) + by);

  const stepPx = () => (cards.current[0]?.offsetWidth ?? 1) * STEP;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    swiped.current = false;
    cancelAnimationFrame(frame.current);
    target.current = pos.current;
    drag.current = { id: e.pointerId, x: e.clientX, from: pos.current, moved: false, samples: [{ t: e.timeStamp, x: e.clientX }] };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_PX) return;
      d.moved = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is already gone; the release that follows settles it.
      }
    }
    pos.current = d.from - dx / stepPx();
    draw();
    d.samples.push({ t: e.timeStamp, x: e.clientX });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) {
      // A tap on a neighbour brings it to the centre.
      const slide = (e.target as HTMLElement).closest<HTMLElement>("[data-slide]");
      const i = slide ? Number(slide.dataset.slide) : NaN;
      aim(Math.round(pos.current + (Number.isNaN(i) ? 0 : wrap(i - pos.current, n))));
      return;
    }
    swiped.current = true;
    const first = d.samples[0];
    const span = e.timeStamp - first.t;
    const speed = span > 0 ? (e.clientX - first.x) / span : 0;
    const flung = pos.current - (speed * FLING_MS) / stepPx();
    // A flick goes one card on past where the finger let go, never a spin.
    const near = Math.round(pos.current);
    aim(Math.min(near + 1, Math.max(near - 1, Math.round(flung))));
  };

  const onPointerCancel = () => {
    drag.current = null;
    aim(Math.round(pos.current));
  };

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "ArrowRight") go(1);
        else return;
        e.preventDefault();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      // A swipe ends over a card too; only a tap should press it.
      onClickCapture={(e) => {
        if (!swiped.current) return;
        swiped.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      className={cn(
        "grid cursor-grab touch-pan-y select-none overflow-hidden py-1 outline-none active:cursor-grabbing",
        "[mask-image:linear-gradient(90deg,transparent,#000_20%,#000_80%,transparent)]",
        className
      )}
    >
      {slides.map((slide, i) => {
        const p = place(wrap(i - rest, n));
        const centred = wrap(i - rest, n) === 0;
        return (
          <div
            key={i}
            ref={(el) => {
              cards.current[i] = el;
            }}
            data-slide={i}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${n}`}
            aria-hidden={!centred || undefined}
            className="carousel-slide flex w-[62%] max-w-[260px] justify-self-center [grid-area:1/1] will-change-transform *:flex-1"
            style={
              {
                transform: p.transform,
                opacity: p.opacity,
                zIndex: p.zIndex,
                "--focus": p.focus,
              } as React.CSSProperties
            }
          >
            {slide}
          </div>
        );
      })}
    </div>
  );
}
