"use client";

import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";

type Box = { x: number; y: number; w: number; h: number };

/** Tuned to glide rather than bounce: it has to keep up with a cursor
 * sweeping down a table without trailing a row behind it. */
const SLIDE = { type: "spring", stiffness: 520, damping: 44, mass: 0.7 } as const;
const FADE = { duration: 0.18, ease: "easeOut" } as const;

/**
 * The row highlight every table on the site uses — the Overview legends, the
 * tier table, the calculator's FDV table, the leaderboard.
 *
 * One box per table rather than a background on each row. A background per
 * row can only blink off in one place and on in the next; a single box can
 * travel, so moving down the table slides the highlight from row to row
 * instead of redrawing it. Being one element also means one shape everywhere:
 * the same radius on both ends, whatever the row's own markup is (a grid, a
 * <tr> whose corners had to be faked on its first and last cells).
 *
 * It measures `target` against `containerRef` and positions itself in the
 * container's coordinates, so the container has to be the box's containing
 * block and its own stacking context — `relative isolate` — which is what
 * lets the -z-10 here sit behind the row's text but still inside the card.
 *
 * Appearing from nothing it fades in where it lands rather than sliding in
 * from wherever it was last seen; only a move between two rows slides.
 */
export function RowHighlight({
  containerRef,
  target,
  pulse,
}: {
  containerRef: RefObject<HTMLElement | null>;
  /** The row to sit on, or null to fade out where it is. */
  target: HTMLElement | null;
  /** Breathe instead of holding still — for a highlight that came from
   * somewhere else on the page (a chart) rather than the cursor on the row. */
  pulse?: boolean;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const shown = target != null && box != null;
  // Whether the box was visible on the previous commit. Read during render to
  // decide between a slide (it was) and a jump (it's appearing).
  const wasShown = useRef(false);
  useEffect(() => {
    wasShown.current = shown;
  }, [shown]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!target || !container) return;
    const measure = () => {
      const c = container.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      setBox({
        // Padding-box coordinates, and in scrolled content for a container
        // that scrolls (the leaderboard's overflow-x wrapper).
        x: r.left - c.left - container.clientLeft + container.scrollLeft,
        y: r.top - c.top - container.clientTop + container.scrollTop,
        w: r.width,
        h: r.height,
      });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(container);
    observer?.observe(target);
    return () => observer?.disconnect();
  }, [target, containerRef]);

  const jump = !wasShown.current;

  return (
    <motion.div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-0 top-0 -z-10 rounded-md",
        pulse ? "tier-row-pulse" : "bg-[rgb(var(--t-veil-rgb)/0.045)]"
      )}
      initial={false}
      animate={
        box
          ? { x: box.x, y: box.y, width: box.w, height: box.h, opacity: shown ? 1 : 0 }
          : { opacity: 0 }
      }
      transition={{ default: jump ? { duration: 0 } : SLIDE, opacity: FADE }}
    />
  );
}
