/** Formatters shared by the Overview KPI cards, their sparklines and the
 * Volume chart. */

/** Headline dollars: two decimals at M/B, whole thousands below. */
export function usdBoard(n: number): string {
  if (!(n > 0)) return "$0";
  // Units are picked after rounding, so $999,996,000 reads $1.00B rather than
  // $1000.00M, and $999,600 reads $1.00M rather than $1,000K.
  const m = (n / 1e6).toFixed(2);
  if (n >= 1e9 || m === "1000.00") return `$${(n / 1e9).toFixed(2)}B`;
  const k = Math.round(n / 1e3);
  if (n >= 1e6 || k >= 1000) return `$${m}M`;
  if (Math.round(n) >= 1e3) return `$${k.toLocaleString("en-US")}K`;
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

/** `Mon YYYY`, UTC. */
export function formatUtcMonth(t: number): string {
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `+1,234` / `−1,234` with a true minus sign; `format` gets the magnitude. */
export function formatSignedDelta(delta: number, format: (n: number) => string): string {
  return `${delta >= 0 ? "+" : "−"}${format(Math.abs(delta))}`;
}
