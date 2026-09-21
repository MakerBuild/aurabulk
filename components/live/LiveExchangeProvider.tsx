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

  const refresh = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;

    const run = (async () => {
      try {
        const response = await fetch("/api/live-exchange");
        if (!response.ok) return;
        const next: LiveExchangePayload = await response.json();
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

  return <LiveExchangeContext.Provider value={data}>{children}</LiveExchangeContext.Provider>;
}
