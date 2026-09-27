"use client";

import { useRef, useState } from "react";
import { PanelLabel } from "@/components/overview/PanelCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { RowHighlight } from "@/components/ui/RowHighlight";
import { SwapValue } from "@/components/ui/SwapValue";
import { FEE_TIERS, tierRangeLabel } from "@/lib/fee-tiers";
import type { ExecutionCost, OrderType } from "@/lib/order-book-math";
import { fmtUsd } from "@/components/stats/format";
import { cn } from "@/lib/utils";

/** Tier · volume · taker · fee · all-in on a phone; maker, the saving and the
 *  bar join from sm. One template for the header and every row. */
const COLS =
  "grid grid-cols-[44px_minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[56px_minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.8fr)] items-center gap-x-2 sm:gap-x-6";

/**
 * Every tier side by side, priced for the order in the calculator. Spread and
 * slippage do not depend on the tier, so each row is the order's market cost
 * plus that tier's fee — the saving from moving up a tier, in dollars.
 *
 * Laid out like the calculator's FDV scenario matrix: label-row heading on a
 * hairline, 42px rows, mono 13px figures, the chosen row in accent.
 */
export function FeeTierTable({
  selected,
  onSelect,
  walletTier,
  cost,
  orderType,
  rebateBps,
}: {
  selected: number;
  onSelect: (tier: number) => void;
  /** The tier a looked-up wallet sits in, marked in the table. */
  walletTier: number | null;
  cost: ExecutionCost | null;
  orderType: OrderType;
  rebateBps: number;
}) {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef<Record<number, HTMLButtonElement | null>>({});
  const [hovered, setHovered] = useState<number | null>(null);

  const marketUsd = cost ? cost.spreadUsd + cost.slippageUsd : 0;
  const notional = cost?.notionalUsd ?? 0;
  const feeAt = (t: (typeof FEE_TIERS)[number]) =>
    (notional * (orderType === "taker" ? t.takerBps : t.makerBps + rebateBps)) / 1e4;
  const baseline = marketUsd + feeAt(FEE_TIERS[0]);
  // Bars share one scale so the step between tiers is visible; with a rebate
  // an all-in figure can go negative, which draws as no bar.
  const barMax = Math.max(...FEE_TIERS.map((t) => marketUsd + feeAt(t)), 1e-9);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1">
        <PanelLabel>Fee tiers</PanelLabel>
        <InfoTooltip
          floating
          panelClassName="w-64"
          text="Fees by trading volume over the last 14 days. Click a row to price your order at that tier."
        />
      </div>

      <div ref={tableRef} className="relative isolate mt-4">
        <RowHighlight
          containerRef={tableRef}
          target={hovered != null ? (rowEls.current[hovered] ?? null) : null}
        />
        <div className={cn(COLS, "-mx-2.5 border-b border-[var(--color-line)] px-2.5 pb-1.5")}>
          <span className="font-label text-text-muted">Tier</span>
          <span className="font-label text-text-muted">14D volume</span>
          <span className="hidden text-right font-label text-text-muted sm:block">Maker</span>
          <span className="text-right font-label text-text-muted">Taker</span>
          <span className="text-right font-label text-text-muted">Your fee</span>
          <span className="hidden text-right font-label text-text-muted sm:block">vs. Tier 1</span>
          <span className="text-right font-label text-text-muted">All-in</span>
        </div>
        {FEE_TIERS.map((t, i) => {
          const on = t.tier === selected;
          const fee = feeAt(t);
          const allIn = marketUsd + fee;
          const saving = baseline - allIn;
          return (
            <button
              key={t.tier}
              ref={(el) => {
                rowEls.current[t.tier] = el;
              }}
              type="button"
              onClick={() => onSelect(t.tier)}
              onMouseEnter={() => setHovered(t.tier)}
              onMouseLeave={() => setHovered(null)}
              aria-pressed={on}
              className={cn(
                COLS,
                "-mx-2.5 w-[calc(100%+20px)] px-2.5 text-left transition-colors",
                i > 0 && "border-t border-[var(--color-line-soft)]",
                hovered === t.tier && "border-transparent",
              )}
              style={{ height: 42 }}
            >
              <span className={cn("font-data flex items-center gap-2 text-[13px]", on ? "text-accent" : "text-text-primary")}>
                {t.tier}
                {walletTier === t.tier && <span className="font-label text-accent">You</span>}
              </span>
              <span className={cn("font-data truncate text-[13px]", on ? "text-accent" : "text-text-secondary")}>
                {tierRangeLabel(t)}
              </span>
              <span className={cn("font-data hidden text-right text-[13px] sm:block", on ? "text-accent" : "text-text-secondary")}>
                {t.makerBps.toFixed(1)}
              </span>
              <span className={cn("font-data text-right text-[13px]", on ? "text-accent" : "text-text-secondary")}>
                {t.takerBps.toFixed(1)}
              </span>
              <span className={cn("font-data text-right text-[13px]", on ? "text-accent" : "text-text-primary")}>
                <SwapValue>{cost ? fmtUsd(fee) : "—"}</SwapValue>
              </span>
              <span
                className={cn(
                  "font-data hidden text-right text-[13px] font-medium sm:block",
                  on ? "text-accent" : saving > 0.005 ? "text-bid-green" : "text-text-muted",
                )}
              >
                <SwapValue>{cost && saving > 0.005 ? `−${fmtUsd(saving)}` : "—"}</SwapValue>
              </span>
              <span className="flex items-center justify-end gap-3">
                <span className="hidden h-1.5 max-w-[140px] flex-1 overflow-hidden rounded-full bg-[rgb(var(--t-veil-rgb)/0.05)] sm:block">
                  <span
                    className="block h-full rounded-full transition-[width] duration-300"
                    style={{
                      width: `${cost ? Math.max(0, allIn / barMax) * 100 : 0}%`,
                      background: on ? "var(--t-accent)" : "var(--t-ramp-3)",
                    }}
                  />
                </span>
                <span className={cn("font-data text-right text-[13px] font-semibold", on ? "text-accent" : "text-text-primary")}>
                  <SwapValue>{cost ? fmtUsd(allIn) : "—"}</SwapValue>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
