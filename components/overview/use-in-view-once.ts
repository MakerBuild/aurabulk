"use client";

import { useEffect, useRef, useState } from "react";

/** Flips to true the first time the element scrolls into view, then stops
 * observing. Without IntersectionObserver it reports in view straight away. */
export function useInViewOnce<T extends HTMLElement>(
  threshold = 0.25,
  rootMargin = "0px 0px -10% 0px"
) {
  const ref = useRef<T | null>(null);
  const [hasEntered, setHasEntered] = useState(false);

  useEffect(() => {
    if (hasEntered) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setHasEntered(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setHasEntered(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasEntered, threshold, rootMargin]);

  return { ref, hasEntered };
}
