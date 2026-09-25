"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { LiveFinancialPayload } from "@/lib/live-financial-payload";
import { usePolledJson } from "@/components/live/use-polled-json";

const POLL = { intervalMs: 90_000, minGapMs: 15_000 };

const LiveFinancialContext = createContext<LiveFinancialPayload | null>(null);

export function useLiveFinancials(): LiveFinancialPayload {
  const value = useContext(LiveFinancialContext);
  if (!value) {
    throw new Error("useLiveFinancials must be used within LiveFinancialProvider");
  }
  return value;
}

export function LiveFinancialProvider({
  initial,
  children,
}: {
  initial: LiveFinancialPayload;
  children: ReactNode;
}) {
  const [data, setData] = useState(initial);
  usePolledJson<LiveFinancialPayload>("/api/live-financials", POLL, setData);

  return (
    <LiveFinancialContext.Provider value={data}>{children}</LiveFinancialContext.Provider>
  );
}
