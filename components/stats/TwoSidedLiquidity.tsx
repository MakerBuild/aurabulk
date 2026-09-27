"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";
import { PanelLabel } from "@/components/overview/PanelCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { RowHighlight } from "@/components/ui/RowHighlight";
import { SwapValue } from "@/components/ui/SwapValue";
import { depthWithinBp, sideCosts, type Book } from "@/lib/order-book-math";
import { fmtBp, fmtUsdShort } from "@/components/stats/format";
import { barGradient, barStyle } from "@/components/stats/book-colors";
import { cn } from "@/lib/utils";

/** Distances from mid, in bp, each band cumulative from the touch outward. */
const BANDS = [2, 5, 10, 25, 50, 100];
export const DEFAULT_BAND = 10;
const COST_SIZES = [100_000, 1_000_000];

type Verdict = "balanced" | "skewed" | "one-sided";

/** Bid share of two-sided depth → how even the book is. Bands chosen so a
 *  60/40 book already reads as skewed: at that ratio the thin side runs out
 *  a third sooner than the headline depth suggests. */
function verdict(bidShare: number): Verdict {
  const off = Math.abs(bidShare - 0.5);
  if (off <= 0.07) return "balanced";
  if (off <= 0.2) return "skewed";
  return "one-sided";
}

/** How many times the heavier side outweighs the lighter, rounded to what is
 *  worth reading: two decimals near even, whole numbers once one side dwarfs
 *  the other. Which side is heavier the two depths beside it already say. */
function skewRatio(bid: number, ask: number): string {
  const heavy = Math.max(bid, ask);
  const light = Math.min(bid, ask);
  if (light <= 0) return "one side empty";
  const ratio = heavy / light;
  return `${ratio >= 100 ? ">100" : ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(2)}×`;
}

const VERDICT_META: Record<Verdict, { label: string; className: string; Icon: typeof Scale }> = {
  balanced: { label: "Balanced", className: "text-bid-green", Icon: CheckCircle2 },
  skewed: { label: "Skewed", className: "text-accent", Icon: Scale },
  "one-sided": { label: "One-sided", className: "text-ask-red", Icon: AlertTriangle },
};

/**
 * Bid against ask depth at each distance from mid, mirrored so an even book
 * reads as a symmetric funnel. A tight spread only means something if both
 * sides stand behind it: the headline figures here are the depth *both* sides
 * offer (the smaller one) and the cost on the *thinner* side — never a total
 * or an average that a heavy side can prop up.
 */
export function TwoSidedLiquidity({
  book,
  mid,
  focus,
  onFocus,
}: {
  book: Book;
  mid: number | null;
  /** The band picked in the table. Held by the page, so switching market —
   *  which remounts this panel for its slide — keeps the choice. */
  focus: number;
  onFocus: (bp: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  // Row elements in state, not a ref: the chosen band's highlight has to find
  // its row on the render the rows first appear, not one data refresh later.
  const [rowEls, setRowEls] = useState<Record<number, HTMLButtonElement>>({});

  const rows = useMemo(
    () =>
      mid == null
        ? []
        : BANDS.map((bp) => {
            const bid = depthWithinBp(book.bids, mid, bp);
            const ask = depthWithinBp(book.asks, mid, bp);
            const total = bid + ask;
            return { bp, bid, ask, bidShare: total > 0 ? bid / total : 0.5 };
          }),
    [book, mid],
  );
  const costs = useMemo(() => COST_SIZES.map((usd) => ({ usd, ...sideCosts(book, usd) })), [book]);

  const scale = Math.max(1, ...rows.flatMap((r) => [r.bid, r.ask]));
  const focused = rows.find((r) => r.bp === focus) ?? null;
  const focusVerdict = focused ? verdict(focused.bidShare) : null;
  const meta = focusVerdict ? VERDICT_META[focusVerdict] : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex h-4 items-center gap-1">
          <PanelLabel>Two-sided liquidity</PanelLabel>
          <InfoTooltip floating panelClassName="w-64" text="Bid and ask depth within each distance from mid. An even book looks symmetric. Click a band to focus it." />
        </div>

        <div
          ref={tableRef}
          className="relative isolate grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)_56px] items-center gap-x-2"
        >
          {/* Two gliding boxes, the dropdown's and every table's: the chosen
              band in the accent, and the hover in the neutral veil. Each rides
              the same spring from row to row instead of blinking on and off. */}
          <RowHighlight
            containerRef={tableRef}
            target={rowEls[focus] ?? null}
            className="bg-[rgb(var(--t-accent-rgb)/0.08)]"
          />
          <RowHighlight
            containerRef={tableRef}
            target={hovered != null && hovered !== focus ? (rowEls[hovered] ?? null) : null}
          />
          <span className="font-label pb-1.5 text-right text-text-muted">Bids</span>
          <span className="font-label pb-1.5 text-center text-text-muted">From mid</span>
          <span className="font-label pb-1.5 text-text-muted">Asks</span>
          <span className="font-label pb-1.5 text-right text-text-muted">Bid/Ask</span>
          {/* One hairline under the whole heading — a border per cell broke
              at every column gap. */}
          <span className="col-span-4 h-px bg-[var(--color-line)]" aria-hidden />

          {rows.length === 0
            ? BANDS.map((bp) => (
                <div key={bp} className="col-span-4 h-9" />
              ))
            : rows.map((r) => {
                const on = r.bp === focus;
                const v = verdict(r.bidShare);
                return (
                  <button
                    key={r.bp}
                    ref={(el) => {
                      // Only a new element is stored; the detach call (null)
                      // and a re-attach of the same node change nothing.
                      if (el) setRowEls((m) => (m[r.bp] === el ? m : { ...m, [r.bp]: el }));
                    }}
                    type="button"
                    onClick={() => onFocus(r.bp)}
                    onMouseEnter={() => setHovered(r.bp)}
                    onMouseLeave={() => setHovered(null)}
                    aria-pressed={on}
                    className="col-span-4 grid h-9 grid-cols-subgrid items-center"
                  >
                    <span className="flex min-w-0 items-center justify-end gap-2">
                      <span className="font-data shrink-0 text-[12px] text-text-secondary sm:text-[13px]">
                        <SwapValue>{fmtUsdShort(r.bid)}</SwapValue>
                      </span>
                      <span className="flex h-4 min-w-0 flex-1 justify-end">
                        <span
                          className="h-full rounded-l-[4px] transition-[width] duration-500"
                          style={{ ...barStyle("bid", r.bid / scale), opacity: on ? 1 : 0.7 }}
                        />
                      </span>
                    </span>
                    <span className={cn("font-data text-center text-[12px] sm:text-[13px]", on ? "text-accent" : "text-text-muted")}>
                      ±{r.bp} bp
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex h-4 min-w-0 flex-1">
                        <span
                          className="h-full rounded-r-[4px] transition-[width] duration-500"
                          style={{ ...barStyle("ask", r.ask / scale), opacity: on ? 1 : 0.7 }}
                        />
                      </span>
                      <span className="font-data shrink-0 text-[12px] text-text-secondary sm:text-[13px]">
                        <SwapValue>{fmtUsdShort(r.ask)}</SwapValue>
                      </span>
                    </span>
                    <span
                      className={cn(
                        "font-data text-right text-[12px] font-medium sm:text-[13px]",
                        v === "balanced" ? "text-text-secondary" : VERDICT_META[v].className,
                      )}
                    >
                      <SwapValue>
                        {Math.round(r.bidShare * 100)}/{100 - Math.round(r.bidShare * 100)}
                      </SwapValue>
                    </span>
                  </button>
                );
              })}
        </div>
      </div>

      {/* Summary for the focused band, mirrored like the table beside it:
          bids down the left column, asks down the right, what belongs to
          both on the centre axis. It is built from the same parts as that
          table — a label heading on a hairline, then six 36px rows — so
          every level lines up across the two halves by construction. */}
      <div className="flex min-w-0 flex-col gap-3 lg:border-l lg:border-[var(--color-line)] lg:pl-5">
        <div className="flex h-4 items-center gap-1">
          <PanelLabel>Two-sided depth</PanelLabel>
          <InfoTooltip
            floating
            panelClassName="w-64"
            text="The smaller side within the band, and what a market order costs on each side before fees."
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2">
          <span className="font-label pb-1.5 text-text-muted">Bids</span>
          <span className="font-label pb-1.5 text-center text-accent">±{focus} bp</span>
          <span className="font-label pb-1.5 text-right text-text-muted">Asks</span>
          <span className="col-span-3 h-px bg-[var(--color-line)]" aria-hidden />

          {/* Rows 1–2: the figure both sides stand behind. */}
          <div className="col-span-3 flex h-[72px] flex-col items-center justify-center gap-1.5">
            <span className="font-figure whitespace-nowrap text-[26px] font-semibold leading-none tracking-[-0.02em] text-text-primary sm:text-[28px] xl:text-[30px]">
              <SwapValue>{focused ? fmtUsdShort(Math.min(focused.bid, focused.ask)) : "—"}</SwapValue>
            </span>
            <span className="font-label leading-none text-text-muted">Both sides</span>
          </div>

          {/* Row 3: each side's depth, the verdict between them. */}
          <div className="col-span-3 grid h-9 grid-cols-subgrid items-center">
            <span className="font-data truncate text-bid-green">
              <SwapValue>{focused ? fmtUsdShort(focused.bid) : "—"}</SwapValue>
            </span>
            {focused && meta ? (
              <span className={cn("font-data whitespace-nowrap", meta.className)}>
                <SwapValue innerClassName="flex items-center gap-1.5">
                  <meta.Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
                  {meta.label} · {skewRatio(focused.bid, focused.ask)}
                </SwapValue>
              </span>
            ) : (
              <span />
            )}
            <span className="font-data truncate text-right text-ask-red">
              <SwapValue>{focused ? fmtUsdShort(focused.ask) : "—"}</SwapValue>
            </span>
          </div>

          {/* Row 4: the split, bright where the sides meet. */}
          <div className="col-span-3 flex h-9 items-center">
            {focused && (
              <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full">
                <span
                  className="h-full rounded-l-full transition-[width] duration-500"
                  style={{ width: `${focused.bidShare * 100}%`, backgroundImage: barGradient("bid") }}
                />
                <span className="h-full flex-1 rounded-r-full" style={{ backgroundImage: barGradient("ask") }} />
              </div>
            )}
          </div>

          {/* Rows 5–6: a market order's cost on each side, size on the axis. */}
          {costs.map((c, i) => {
            const worse = c.buyBp == null || c.sellBp == null ? null : c.buyBp >= c.sellBp ? "buy" : "sell";
            const cell = (side: "buy" | "sell", align: string) => {
              const bp = side === "buy" ? c.buyBp : c.sellBp;
              return (
                <span
                  className={cn(
                    "font-data",
                    align,
                    worse == null || worse === side ? "font-semibold text-text-primary" : "text-text-muted",
                  )}
                >
                  <SwapValue>{bp != null ? fmtBp(bp) : "—"}</SwapValue>
                </span>
              );
            };
            return (
              <div
                key={c.usd}
                className={cn(
                  "col-span-3 grid h-9 grid-cols-subgrid items-center border-t",
                  i === 0 ? "border-[var(--color-line)]" : "border-[var(--color-line-soft)]",
                )}
              >
                {cell("sell", "text-left")}
                <span className="font-label whitespace-nowrap text-center text-text-muted">
                  {fmtUsdShort(c.usd)} order
                </span>
                {cell("buy", "text-right")}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
