"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Glides the page on a mouse wheel instead of jumping a notch at a time.
 * Chromium on Windows drops its own smooth wheel scrolling when "Animation
 * effects" is off, which is also why this ignores prefers-reduced-motion
 * (Lenis honours it by default): that switch is what makes the page step.
 *
 * Wheel only. Touch and trackpads keep the browser's own scrolling, and a
 * scrollable box inside the page (a dropdown list) still scrolls itself.
 */
export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.12,
      allowNestedScroll: true,
      stopInertiaOnNavigate: true,
      respectReducedMotion: false,
    });
    return () => lenis.destroy();
  }, []);

  return null;
}
