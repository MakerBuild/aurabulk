import type { Transition, Variants } from "framer-motion";

/** The site's glide curve: quick off the mark, long soft landing — the same
 *  feel as the row highlight, the slider and the value swaps. */
const GLIDE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Gap between one row starting down the stairs and the next. */
const STEP_S = 0.028;
/** Past this many rows the rest arrive together: a long list (twenty weeks)
 *  would otherwise still be arriving after the eye has moved on, and the
 *  rows it is waiting on are scrolled out of sight anyway. */
const MAX_STEPS = 10;

/**
 * How every dropdown on the site opens and closes. The panel fades in while
 * drifting a few pixels into place from the edge it hangs off, and its rows
 * follow one after another, each stepping down into place a beat after the
 * one above it, like walking down a flight of stairs. Closing is one quick
 * fade back the way it came.
 *
 * No clip-path unroll: a clip cuts the panel's shadow off with it, leaving a
 * hard edge where the shadow should fade. No scale either: the row highlight
 * measures rows on screen, and squashed text reads as a glitch.
 *
 * Returns variants named `open` and `closed`, so a panel that stays mounted
 * can switch between them, and one mounted by AnimatePresence can use them
 * as initial / animate / exit. Rows use `dropdownRow` with their index as
 * `custom`, and inherit the state from the panel.
 */
export function dropdownMotion(opensUpward = false) {
  const shift = opensUpward ? 6 : -6;
  const variants: Variants = {
    open: {
      opacity: 1,
      y: 0,
      transition: {
        y: { duration: 0.34, ease: GLIDE_EASE },
        opacity: { duration: 0.2, ease: "easeOut" },
      } satisfies Transition,
    },
    closed: {
      opacity: 0,
      y: shift,
      transition: {
        y: { duration: 0.2, ease: GLIDE_EASE },
        opacity: { duration: 0.16, ease: "easeIn" },
      } satisfies Transition,
    },
  };
  return { variants, initial: "closed", animate: "open", exit: "closed" } as const;
}

/**
 * One row of a dropdown: steps down into place `index` beats after the
 * first. Put it on the row's content, not on anything the row highlight
 * measures, so the highlight lands where the row will be, not where it is
 * mid-step.
 */
export function dropdownRow(opensUpward = false): Variants {
  const from = opensUpward ? 8 : -8;
  return {
    open: (index: number = 0) => {
      // Per-value transitions do not inherit a shared delay; each carries it.
      const delay = 0.04 + Math.min(index, MAX_STEPS) * STEP_S;
      return {
        opacity: 1,
        y: 0,
        transition: {
          y: { delay, duration: 0.36, ease: GLIDE_EASE },
          opacity: { delay, duration: 0.24, ease: "easeOut" },
        },
      };
    },
    // Out together with the panel; stepping back up would only hold the
    // page up.
    closed: { opacity: 0, y: from / 2, transition: { duration: 0.12, ease: "easeIn" } },
  };
}
