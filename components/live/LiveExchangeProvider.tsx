"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { LiveExchangePayload } from "@/lib/live-exchange-payload";
import { usePolledJson } from "@/components/live/use-polled-json";

const POLL = { intervalMs: 20_000, minGapMs: 15_000 };

const LiveExchangeContext = createContext<LiveExchangePayload | null>(null);
/** Separate from the payload on purpose: TPS changes on every poll, and
 *  folding it into the payload object would give every consumer a new
 *  identity each time — the re-render the skip-write below exists to avoid. */
const LiveTpsContext = createContext<number | null>(null);

export function useLiveTps(): number | null {
  return useContext(LiveTpsContext);
}

export function useLiveExchange(): LiveExchangePayload {
  const value = useContext(LiveExchangeContext);
  if (!value) {
    throw new Error("useLiveExchange must be used within LiveExchangeProvider");
  }
  return value;
}

export function LiveExchangeProvider({
  initial,
  children,
}: {
  initial: LiveExchangePayload;
  children: ReactNode;
}) {
  const [data, setData] = useState(initial);
  // TPS is measured here and nowhere else. Server-side it paired whatever two
  // readings an instance held, and a cached /metrics response put a day
  // between them — 11,547/s reported against an actual 109/s. Two polls here
  // are two distinct readings of a counter, timed by the payload itself.
  const sampleRef = useRef<{ total: number; at: number } | null>(null);
  const [clientTps, setClientTps] = useState<number | null>(null);

  usePolledJson<LiveExchangePayload>("/api/live-exchange", POLL, (next) => {
    // Timed by the payload's own `updatedAt`, not the browser clock: the
    // route is CDN-cached for 15s, so two polls can return one reading,
    // and dividing by wall time would report that as a drop to zero. A
    // counter that went backwards means the node restarted — start over
    // rather than publish a negative rate.
    const at = Date.parse(next.updatedAt);
    const prevSample = sampleRef.current;
    if (Number.isFinite(at) && next.submissionsTotal > 0) {
      if (prevSample && at > prevSample.at) {
        const seconds = (at - prevSample.at) / 1000;
        const delta = next.submissionsTotal - prevSample.total;
        if (delta >= 0 && seconds >= 1) setClientTps(delta / seconds);
        else if (delta < 0) setClientTps(null);
      }
      if (!prevSample || at > prevSample.at) {
        sampleRef.current = { total: next.submissionsTotal, at };
      }
    }
    // Every payload is stamped when it is built, so an unchanged `updatedAt`
    // is the same cached reading — skip the write and the re-render of every
    // consumer (and the spark morphs it would restart).
    setData((prev) => (prev.updatedAt === next.updatedAt ? prev : next));
  });

  return (
    <LiveExchangeContext.Provider value={data}>
      <LiveTpsContext.Provider value={clientTps}>{children}</LiveTpsContext.Provider>
    </LiveExchangeContext.Provider>
  );
}
