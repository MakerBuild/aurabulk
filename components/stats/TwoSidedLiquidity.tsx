"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";
import { PanelLabel } from "@/components/overview/PanelCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { Select } from "@/components/ui/Select";
import { RowHighlight } from "@/components/ui/RowHighlight";
import { SwapValue } from "@/components/ui/SwapValue";
import { bookTop, depthWithinBp, sideCosts, type Book } from "@/lib/order-book-math";
import { fmtBp, fmtPrice, fmtUsdShort } from "@/components/stats/format";
import { barGradient, barStyle } from "@/components/stats/book-colors";
import { cn } from "@/lib/utils";

/** Distances from mid, in bp, each band cumulative from the touch outward.
 *  The ones under 2 bp show the touch itself, where a book that looks even a
 *  few bp out is often heavily one-sided. */
const BANDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];
/** The row under every band: just the best bid and best ask, the floor any
 *  band is built on whatever the market's price step. Keyed 0 alongside the
 *  bands' distances. */
export const TOP = 0;
export const DEFAULT_BAND = 10;
/** Every row the table can show, in order: the top of book, then the bands.
 *  All shown until the viewer turns some off. */
export const LEVELS = [TOP, ...BANDS];
const LEVEL_OPTIONS = LEVELS.map((bp) => ({ value: String(bp), label: bp === TOP ? "Top of book" : `±${bp} bp` }));
const COST_SIZES = [10_000, 100_000, 1_000_000];

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
  decimals,
  tickSize,
  shown,
  onShownChange,
}: {
  book: Book;
  mid: number | null;
  /** The market's price decimals, for the best bid and ask. */
  decimals: number;
  /** The market's price step. A band narrower than two steps either side
   *  of mid cannot hold a price of its own, so it is shown as unavailable
   *  there rather than repeating the touch. */
  tickSize: number | null;
  /** The band picked in the table. Held by the page, so switching market —
   *  which remounts this panel for its slide — keeps the choice. */
  focus: number;
  onFocus: (bp: number) => void;
  /** The levels the viewer keeps in the table, held by the page for the same
   *  reason as `focus`. */
  shown: number[];
  onShownChange: (levels: number[]) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  // Row elements in state, not a ref: the chosen band's highlight has to find
  // its row on the render the rows first appear, not one data refresh later.
  const [rowEls, setRowEls] = useState<Record<number, HTMLButtonElement>>({});

  const top = bookTop(book);
  const rows = useMemo(
    () =>
      mid == null
        ? []
        : LEVELS.filter((bp) => shown.includes(bp)).map((bp) => {
            const touch = ([px, sz]: [number, number] | undefined = [0, 0]) => px * sz;
            const bid = bp === TOP ? touch(book.bids[0]) : depthWithinBp(book.bids, mid, bp);
            const ask = bp === TOP ? touch(book.asks[0]) : depthWithinBp(book.asks, mid, bp);
            const total = bid + ask;
            const available = bp === TOP || bp >= 1 || tickSize == null || (2 * tickSize * 1e4) / mid <= bp;
            // Empty where the price step is wider than the band (a market
            // ticking in 1 bp steps has nothing inside ±0.5 bp): no split to
            // show there, rather than an even 50/50 made of nothing.
            return { bp, bid, ask, bidShare: total > 0 ? bid / total : 0.5, empty: !available || total === 0, available };
          }),
    [book, mid, tickSize, shown],
  );
  const costs = useMemo(() => COST_SIZES.map((usd) => ({ usd, ...sideCosts(book, usd) })), [book]);

  const scale = Math.max(1, ...rows.flatMap((r) => [r.bid, r.ask]));
  const focused = rows.find((r) => r.bp === focus) ?? null;
  const focusVerdict = focused && !focused.empty ? verdict(focused.bidShare) : null;
  const meta = focusVerdict ? VERDICT_META[focusVerdict] : null;
  // Beside the table the figure takes whatever rows the table has beyond the
  // six below it, so the rows still line up. Down to a single row, where the
  // figure and its label sit side by side instead of stacked.
  const figureRows = Math.max(1, shown.length - 6);

  function changeLevels(values: string[]) {
    const next = values.map(Number);
    // The last level stays: an empty table has nothing to focus.
    if (!next.length) return;
    onShownChange(next);
    // Turning off the focused band hands the focus to the nearest one left.
    if (!next.includes(focus)) {
      onFocus([...next].sort((a, b) => Math.abs(a - focus) - Math.abs(b - focus))[0]);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex h-4 items-center gap-1">
            <PanelLabel>Two-sided liquidity</PanelLabel>
            <InfoTooltip floating panelClassName="w-64" text="Bid and ask depth within each distance from mid. Top is what sits on the best bid and ask, with the spread between them. Click a band to focus it." />
          </div>
          {/* Which levels the table shows. Centred on the heading's own
              16px line and spilling past it, so the table below still
              starts level with the depth panel beside it. A setting, not
              data, so Snapshot leaves it out. */}
          <div className="flex h-4 items-center" data-snapshot-skip>
            <Select
              multiple
              compact
              className="w-[132px]"
              options={LEVEL_OPTIONS}
              values={shown.map(String)}
              onChange={changeLevels}
              summary={shown.length === LEVELS.length ? "All levels" : `${shown.length} levels`}
            />
          </div>
        </div>

        {/* From sm: one 36px line per band — value, bar, band, bar, value,
            split. On a phone that is six columns in 330px and the bars shrink
            to stubs, so each side stacks its bar over its value instead, the
            bars take the full half width, and the split moves under the band
            in the centre. */}
        <div
          ref={tableRef}
          className="relative isolate grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)] items-center gap-x-2 sm:grid-cols-[minmax(0,1fr)_108px_minmax(0,1fr)_56px]"
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
          <span className="font-label hidden pb-1.5 text-right text-text-muted sm:block">Bid/Ask</span>
          {/* One hairline under the whole heading — a border per cell broke
              at every column gap. */}
          <span className="col-span-full h-px bg-[var(--color-line)]" aria-hidden />

          {rows.length === 0
            ? shown.map((bp) => <div key={bp} className="col-span-full h-12 sm:h-9" />)
            : rows.map((r) => {
                const on = r.bp === focus;
                const v = verdict(r.bidShare);
                const split = r.empty ? "—" : `${Math.round(r.bidShare * 100)}/${100 - Math.round(r.bidShare * 100)}`;
                const splitTone =
                  r.empty ? "text-text-muted" : v === "balanced" ? "text-text-secondary" : VERDICT_META[v].className;
                return (
                  <button
                    key={r.bp}
                    ref={(el) => {
                      // Only a new element is stored; the detach call (null)
                      // and a re-attach of the same node change nothing.
                      if (el) setRowEls((m) => (m[r.bp] === el ? m : { ...m, [r.bp]: el }));
                    }}
                    type="button"
                    disabled={!r.available}
                    onClick={() => onFocus(r.bp)}
                    onMouseEnter={() => setHovered(r.bp)}
                    onMouseLeave={() => setHovered(null)}
                    aria-pressed={on}
                    className="col-span-full grid h-12 grid-cols-subgrid items-center disabled:cursor-default sm:h-9"
                  >
                    {/* Value then bar in the DOM: a row from sm, reversed into
                        bar-over-value on a phone. */}
                    <span className="flex min-w-0 flex-col-reverse items-end gap-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
                      <span className="font-data shrink-0 text-[11px] leading-none text-text-secondary sm:text-[13px] sm:leading-normal">
                        <SwapValue>{r.available ? fmtUsdShort(r.bid) : "—"}</SwapValue>
                      </span>
                      <span className="flex h-2.5 w-full min-w-0 justify-end sm:h-4 sm:w-auto sm:flex-1">
                        <span
                          className="h-full rounded-l-[4px] transition-[width] duration-500"
                          style={{ ...barStyle("bid", r.available ? r.bid / scale : 0), opacity: on ? 1 : 0.7 }}
                        />
                      </span>
                    </span>
                    <span className="flex flex-col items-center gap-1">
                      <span
                        className={cn(
                          "font-data whitespace-nowrap text-center text-[12px] leading-none sm:text-[13px] sm:leading-normal",
                          on ? "text-accent" : r.available ? "text-text-muted" : "text-text-dim",
                        )}
                      >
                        {r.bp === TOP ? (
                          // The top of book's own figure: the spread between
                          // the best bid and ask, in bp of mid.
                          <SwapValue>{`Top (${fmtBp(top.spreadBp)})`}</SwapValue>
                        ) : (
                          `±${r.bp} bp`
                        )}
                      </span>
                      <span className={cn("font-data text-[11px] font-medium leading-none sm:hidden", splitTone)}>
                        <SwapValue>{split}</SwapValue>
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <span className="flex h-2.5 w-full min-w-0 sm:h-4 sm:w-auto sm:flex-1">
                        <span
                          className="h-full rounded-r-[4px] transition-[width] duration-500"
                          style={{ ...barStyle("ask", r.available ? r.ask / scale : 0), opacity: on ? 1 : 0.7 }}
                        />
                      </span>
                      <span className="font-data shrink-0 text-[11px] leading-none text-text-secondary sm:text-[13px] sm:leading-normal">
                        <SwapValue>{r.available ? fmtUsdShort(r.ask) : "—"}</SwapValue>
                      </span>
                    </span>
                    <span className={cn("font-data hidden text-right text-[13px] font-medium sm:block", splitTone)}>
                      <SwapValue>{split}</SwapValue>
                    </span>
                  </button>
                );
              })}
        </div>
      </div>

      {/* Summary for the focused band, mirrored like the table beside it:
          bids down the left column, asks down the right, what belongs to
          both on the centre axis. It is built from the same parts as that
          table — a label heading on a hairline, then 36px rows — so
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
          <span className="font-label pb-1.5 text-center text-accent">
            {focus === TOP ? "Top of book" : `±${focus} bp`}
          </span>
          <span className="font-label pb-1.5 text-right text-text-muted">Asks</span>
          <span className="col-span-3 h-px bg-[var(--color-line)]" aria-hidden />

          {/* The figure both sides stand behind. Beside the table it spans
              as many rows as the table has left over (figureRows); stacked
              under it on narrower screens, three. */}
          <div
            className={cn(
              "col-span-3 flex h-[108px] flex-col items-center justify-center gap-1.5 lg:h-[var(--figure-h)]",
              figureRows === 1 && "lg:flex-row lg:gap-2.5",
            )}
            style={{ "--figure-h": `${figureRows * 36}px` } as CSSProperties}
          >
            <span className="font-figure whitespace-nowrap text-[26px] font-semibold leading-none tracking-[-0.02em] text-text-primary sm:text-[28px] xl:text-[30px]">
              <SwapValue>{focused?.available ? fmtUsdShort(Math.min(focused.bid, focused.ask)) : "—"}</SwapValue>
            </span>
            <span className="font-label leading-none text-text-muted">Both sides</span>
          </div>

          {/* Row 6: each side's depth, the verdict between them. */}
          <div className="col-span-3 grid h-9 grid-cols-subgrid items-center">
            <span className="font-data truncate text-bid-green">
              <SwapValue>{focused?.available ? fmtUsdShort(focused.bid) : "—"}</SwapValue>
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
              <SwapValue>{focused?.available ? fmtUsdShort(focused.ask) : "—"}</SwapValue>
            </span>
          </div>

          {/* Row 7: the split, bright where the sides meet. */}
          <div className="col-span-3 flex h-9 items-center">
            {focused && !focused.empty && (
              <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full">
                <span
                  className="h-full rounded-l-full transition-[width] duration-500"
                  style={{ width: `${focused.bidShare * 100}%`, backgroundImage: barGradient("bid") }}
                />
                <span className="h-full flex-1 rounded-r-full" style={{ backgroundImage: barGradient("ask") }} />
              </div>
            )}
          </div>

          {/* Row 8: the touch itself, best bid and best ask with the spread
              between them. */}
          <div className="col-span-3 grid h-9 grid-cols-subgrid items-center border-t border-[var(--color-line)]">
            <span className="font-data truncate text-bid-green">
              <SwapValue>{fmtPrice(top.bestBid, decimals)}</SwapValue>
            </span>
            <span className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="font-data text-text-primary">
                <SwapValue>{fmtBp(top.spreadBp)}</SwapValue>
              </span>
              <span className="font-label text-text-muted">Spread</span>
            </span>
            <span className="font-data truncate text-right text-ask-red">
              <SwapValue>{fmtPrice(top.bestAsk, decimals)}</SwapValue>
            </span>
          </div>

          {/* Rows 9–11: a market order's cost on each side, size on the axis. */}
          {costs.map((c) => {
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
                className="col-span-3 grid h-9 grid-cols-subgrid items-center border-t border-[var(--color-line-soft)]"
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
