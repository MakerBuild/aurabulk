/** Formatters shared by the Overview KPI cards, their sparklines and the
 * Volume chart. */

/** Headline dollars: two decimals at M/B, whole thousands below. */
export function usdBoard(n: number): string {
  if (!(n > 0)) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3).toLocaleString("en-US")}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** 24-hour `HH:mm`, UTC. */
export function formatUtcTime(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

/** `Mon DD`, UTC. */
export function formatUtcDay(t: number): string {
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

/** `+1,234` / `−1,234` with a true minus sign; `format` gets the magnitude. */
export function formatSignedDelta(delta: number, format: (n: number) => string): string {
  return `${delta >= 0 ? "+" : "−"}${format(Math.abs(delta))}`;
}
