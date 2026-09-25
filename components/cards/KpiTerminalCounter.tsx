"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { usdBoard } from "@/components/overview/spark-format";
import { useInViewOnce } from "@/components/overview/use-in-view-once";

type NumberFormat = "usd-board" | "plain";

function formatValue(n: number, format: NumberFormat): string {
  return format === "usd-board" ? usdBoard(n) : Math.round(n).toLocaleString("en-US");
}

/** Count-up from zero on first view, then a shorter glide per live update. */
const ENTRANCE_MS = 1000;
const UPDATE_MS = 480;

export function KpiTerminalCounter({
  value,
  format = "plain",
}: {
  value: number;
  format?: NumberFormat;
}) {
  // Starts at 0 on the server and the client alike, so first paint matches
  // the markup and the count-up never shows the final figure before it.
  const [displayed, setDisplayed] = useState(0);
  const [counting, setCounting] = useState(false);
  const displayedRef = useRef(0);
  const { ref: hostRef, hasEntered } = useInViewOnce<HTMLSpanElement>(0.35, "0px 0px -8% 0px");

  useEffect(() => {
    if (!hasEntered) return;

    const from = displayedRef.current;
    const to = value;
    const span = from === 0 ? ENTRANCE_MS : UPDATE_MS;
    const start = performance.now();
    let frame = 0;
    setCounting(true);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / span);
      const next = from + (to - from) * (1 - (1 - t) ** 3);
      displayedRef.current = next;
      setDisplayed(next);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setCounting(false);
      }
    };
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [hasEntered, value]);

  return (
    <span ref={hostRef} className={cn("kpi-number", counting && "is-counting")}>
      {formatValue(displayed, format)}
    </span>
  );
}
