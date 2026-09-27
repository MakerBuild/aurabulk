/** Formatters shared by the Stats page's panels and charts. */

export function fmtPrice(n: number | null | undefined, decimals: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Basis points; anything that rounds to zero is shown unsigned, since
 *  "-0.00 bp" reads as a direction the figure does not have. */
export function fmtBp(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const zero = Math.abs(n) < 0.5 * 10 ** -digits;
  return `${zero ? (0).toFixed(digits) : n.toFixed(digits)} bp`;
}

export function fmtSignedBp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.005) return "0.00 bp";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} bp`;
}

/** Dollars to the cent below $10K, then whole dollars. */
export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: abs < 10_000 ? 2 : 0,
    maximumFractionDigits: abs < 10_000 ? 2 : 0,
  })}`;
}

/** Compact dollars for axes and chips: $950, $12K, $2.5M. */
export function fmtUsdShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${+(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${+(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${+(n / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

/** Parses "250000", "250,000", "250k", "1.5m", "$2M". */
export function parseUsdInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/[$,\s]/g, "");
  const m = s.match(/^(\d*\.?\d+)([kmb])?$/);
  if (!m) return null;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Nice round step for about `count` ticks across `span`. */
export function niceStep(span: number, count: number): number {
  const rough = span / Math.max(1, count);
  if (!(rough > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}
