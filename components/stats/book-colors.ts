import type { CSSProperties } from "react";

/** Bids and asks: each side's bright colour, and the deeper tone it pairs
 *  with in gradients. */
export const BID = "var(--t-green)";
export const BID_DEEP = "var(--t-green-deep)";
export const ASK = "var(--t-red)";
export const ASK_DEEP = "var(--t-red-deep)";

/**
 * A bar that grows out from mid: deep where it starts at mid, brightening
 * toward its far end, and that far end dissolving rather than stopping at a
 * hard cap. Each bar carries the whole ramp over its own length, so every
 * row reads dark-inside, light-outside however short it is.
 */
export function barStyle(side: "bid" | "ask", share: number): CSSProperties {
  const w = Math.max(0, Math.min(1, share));
  return { width: `${w * 100}%`, backgroundImage: barGradient(side), ...outerFade(side) };
}

/** Deep at the mid end, bright at the outer end — the liquidity bars, the
 *  balance bar and the depth chart all run this way. */
export function barGradient(side: "bid" | "ask"): string {
  return side === "bid"
    ? `linear-gradient(to left, ${BID_DEEP}, ${BID})`
    : `linear-gradient(to right, ${ASK_DEEP}, ${ASK})`;
}

/** The outer end melts over the last ~45% of the bar on an eased curve —
 *  a few stepped stops rather than one straight ramp, so there is no visible
 *  line where the fade begins. */
function outerFade(side: "bid" | "ask"): CSSProperties {
  const toward = side === "bid" ? "to left" : "to right";
  const mask =
    `linear-gradient(${toward}, #000 55%, rgb(0 0 0 / 0.86) 65%, rgb(0 0 0 / 0.62) 75%, ` +
    `rgb(0 0 0 / 0.34) 85%, rgb(0 0 0 / 0.12) 94%, transparent)`;
  return { maskImage: mask, WebkitMaskImage: mask };
}
