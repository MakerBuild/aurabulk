"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LiveExchangePayload } from "@/lib/live-exchange-payload";

const POLL_MS = 20_000;

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
  const inflightRef = useRef<Promise<void> | null>(null);
  // TPS is measured here and nowhere else. Server-side it paired whatever two
  // readings an instance held, and a cached /metrics response put a day
  // between them — 11,547/s reported against an actual 109/s. Two polls here
  // are two distinct readings of a counter, timed by the payload itself.
  const sampleRef = useRef<{ total: number; at: number } | null>(null);
  const [clientTps, setClientTps] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;

    const run = (async () => {
      try {
        const response = await fetch("/api/live-exchange");
        if (!response.ok) return;
        const next: LiveExchangePayload = await response.json();

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
        // Skip the write when nothing moved. Every consumer under this
        // provider — KPI cards, sparklines, the header — re-renders on
        // setData, and the poll lands every 20s whether the numbers changed
        // or not. On Overview that also restarts the spark morphs for no
        // reason, which on a desktop full of charts is the "page feels a
        // bit sticky" tax between real updates.
        setData((prev) =>
          prev.updatedAt === next.updatedAt &&
          prev.volume24hUsd === next.volume24hUsd &&
          prev.volumeTotalUsd === next.volumeTotalUsd &&
          prev.openInterestUsd === next.openInterestUsd &&
          prev.activeTraders === next.activeTraders &&
          prev.submissionsTotal === next.submissionsTotal &&
          prev.tps === next.tps &&
          prev.totalAccounts === next.totalAccounts &&
          prev.oiHistory.length === next.oiHistory.length &&
          prev.tradersHistory.length === next.tradersHistory.length
            ? prev
            : next,
        );
      } catch {
        // Keep the last good payload.
      } finally {
        inflightRef.current = null;
      }
    })();

    inflightRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  return (
    <LiveExchangeContext.Provider value={data}>
      <LiveTpsContext.Provider value={clientTps}>{children}</LiveTpsContext.Provider>
    </LiveExchangeContext.Provider>
  );
}
