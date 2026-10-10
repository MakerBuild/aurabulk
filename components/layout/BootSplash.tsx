"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Covers the first paint until the page hydrates. Before that every KPI sits
 * at the start of its count-up ($0), the donut and charts are still empty, and
 * the page read as broken. It lifts once React runs, so the entrance
 * animations play as it fades; a CSS fallback lifts it after 3s if the scripts
 * never do. Client navigations keep the root layout mounted, so it shows once
 * per page load.
 */
export function BootSplash() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
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
