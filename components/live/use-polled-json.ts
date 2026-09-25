"use client";

import { useEffect, useRef } from "react";

/**
 * Fetches `url` on mount and every `intervalMs` while the tab is visible,
 * handing each successful JSON body to `onData`. Returning to the tab
 * refreshes at once unless the last success is under `minGapMs` old. Failed
 * polls are dropped, so consumers keep the last good payload.
 */
export function usePolledJson<T>(
  url: string,
  { intervalMs, minGapMs }: { intervalMs: number; minGapMs: number },
  onData: (data: T) => void
) {
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  });

  useEffect(() => {
    const controller = new AbortController();
    let inflight = false;
    let lastSuccessAt = 0;

    const refresh = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as T;
        lastSuccessAt = Date.now();
        onDataRef.current(data);
      } catch {
        // Keep the last good payload.
      } finally {
        inflight = false;
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - lastSuccessAt >= minGapMs) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [url, intervalMs, minGapMs]);
}
