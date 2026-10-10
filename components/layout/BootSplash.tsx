"use client";

import Image from "next/image";
import { useEffect } from "react";
import { releaseBoot, settleBoot, useBootReady } from "@/lib/boot-gate";
import { cn } from "@/lib/utils";

/** Longest the splash waits on data after hydrating; past it the page shows
 *  with what it has and fills in as the rest lands. */
const DATA_CAP_MS = 2500;

/**
 * Covers the first paint until the page hydrates and its first data is in
 * (see lib/boot-gate). Before that every KPI sits at the start of its
 * count-up ($0), the donut and charts are still empty, and the page read as
 * broken. The entrance animations wait for it and play as it fades; a CSS
 * fallback lifts it if the scripts never run. Client navigations keep the
 * root layout mounted, so it shows once per page load.
 */
export function BootSplash() {
  const ready = useBootReady();

  useEffect(() => {
    let cancelled = false;
    // A macrotask later, so the rest of the page's effects in this commit
    // have registered their first fetches with holdBoot.
    const timer = window.setTimeout(() => {
      void settleBoot(DATA_CAP_MS).then(() => {
        if (!cancelled) requestAnimationFrame(releaseBoot);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className={cn("boot-splash", ready && "is-ready")} aria-hidden>
      <div className="boot-splash-mark">
        <Image
          src="/logos/bulkx-logo-light.svg"
          alt=""
          width={104}
          height={40}
          priority
          className="logo-ink-light"
        />
        <Image
          src="/logos/bulkx-logo-dark.svg"
          alt=""
          width={104}
          height={40}
          priority
          className="logo-ink-dark"
        />
        <span className="font-sans text-[21px] font-semibold tracking-[-0.02em] text-text-secondary">
          INTELLIGENCE
        </span>
      </div>
      <span className="boot-splash-bar" />
    </div>
  );
}
