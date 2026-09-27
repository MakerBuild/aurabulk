import type { Transition } from "framer-motion";

/** The site's glide curve: quick off the mark, long soft landing — the same
 *  feel as the row highlight, the slider and the value swaps. */
const GLIDE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * How every dropdown on the site opens and closes: it unrolls from the edge
 * it hangs off while drifting a few pixels into place and fading in, then
 * rolls back up the same way.
 *
 * Unrolled with a clip-path, not a scale: a scaled list throws the row
 * highlight's measurements off, and squashed text reads as a glitch. The
 * open inset is negative so the menu's drop shadow is not clipped with it.
 */
export function dropdownMotion(opensUpward = false) {
  const closedClip = opensUpward
    ? "inset(100% -12% -25% -12% round 12px)"
    : "inset(-10% -12% 100% -12% round 12px)";
  const openClip = "inset(-10% -12% -25% -12% round 12px)";
  const shift = opensUpward ? 6 : -6;
  const transition: Transition = {
    clipPath: { duration: 0.36, ease: GLIDE_EASE },
    y: { duration: 0.36, ease: GLIDE_EASE },
    opacity: { duration: 0.2, ease: "easeOut" },
  };
  return {
    initial: { opacity: 0, y: shift, clipPath: closedClip },
    animate: { opacity: 1, y: 0, clipPath: openClip, transition },
    exit: {
      opacity: 0,
      y: shift,
      clipPath: closedClip,
      transition: {
        clipPath: { duration: 0.24, ease: GLIDE_EASE },
        y: { duration: 0.24, ease: GLIDE_EASE },
        opacity: { duration: 0.18, ease: "easeIn" },
      } satisfies Transition,
    },
  };
}
