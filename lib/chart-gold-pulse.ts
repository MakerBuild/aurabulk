import type { Transition } from "framer-motion";
import { CHART_GOLD, chartSlateRamp } from "@/lib/overview-metrics";

/** Shared beat for gold selection pulse — Framer Motion, not CSS.
 * CSS opacity/filter animations on SVG cancel in Chromium while Safari
 * (phones) still runs them; driving opacity from motion keeps both in sync.
 * Not `as const`: Framer's animate prop rejects readonly keyframe tuples. */
export const CHART_GOLD_PULSE = {
  opacity: [1, 0.38, 1],
};

export const CHART_GOLD_PULSE_TRANSITION: Transition = {
  duration: 1.15,
  repeat: Infinity,
  ease: "easeInOut",
};

/** Slate bed under a pulsing primary mark. Idle primary is already gold, so
 * without this the phases read gold→gold and the beat disappears; secondaries
 * keep their own slate as the bed. */
export const CHART_GOLD_PULSE_UNDERLAY = chartSlateRamp(0, 3);

/** CSS transition timing for a mark handing its colour / dimming over, shared
 * by every Overview mark (slices, bars, legend swatches) so one hover moves
 * them all together. */
export const MARK_EASE = "0.3s cubic-bezier(0.4, 0, 0.2, 1)";

/** Motion props for a mark's top layer: pulses while lit, otherwise settles
 * at `restOpacity`. Spread onto a `motion.*` element. */
export function pulseMotion(lit: boolean, restOpacity = 1) {
  return {
    initial: false,
    animate: lit ? CHART_GOLD_PULSE : { opacity: restOpacity },
    transition: lit ? CHART_GOLD_PULSE_TRANSITION : { duration: 0.3 },
  } as const;
}

/** What a pulsing mark breathes over: its own resting colour, or slate for a
 * mark that rests gold (gold over gold would not show). */
export function pulseBed(restColor: string): string {
  return restColor === CHART_GOLD ? CHART_GOLD_PULSE_UNDERLAY : restColor;
}

/** A mark's colour while it is not the lit one. Gold rests on the primary
 * (index 0); while a secondary is lit and holds the gold, the primary wears
 * that secondary's resting colour instead. */
export function heldFill(
  index: number,
  litIndex: number | null | undefined,
  restAt: (i: number) => string
): string {
  if (index === 0 && litIndex != null && litIndex > 0) return restAt(litIndex);
  return restAt(index);
}

/** A mark's colour: gold when lit, otherwise `heldFill`. */
export function markFill(
  index: number,
  litIndex: number | null | undefined,
  restAt: (i: number) => string
): string {
  return litIndex === index ? CHART_GOLD : heldFill(index, litIndex, restAt);
}
