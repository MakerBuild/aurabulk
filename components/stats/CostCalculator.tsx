"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PanelLabel } from "@/components/overview/PanelCard";
import { SegmentedToggle } from "@/components/overview/SegmentedToggle";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Select } from "@/components/ui/Select";
import { TickSlider } from "@/components/ui/TickSlider";
import { WalletSearchField } from "@/components/ui/WalletSearchField";
import { SwapValue } from "@/components/ui/SwapValue";
import { useElementSize } from "@/components/stats/use-element-width";
import { FEE_TIERS, MAKER_REBATES, tierForVolume, tierRangeLabel, volumeLabel } from "@/lib/fee-tiers";
import type { BookTop, ExecutionCost, OrderType, Side } from "@/lib/order-book-math";
import {
  fmtBp,
  fmtPrice,
  fmtUsd,
  fmtUsdShort,
  parseUsdInput,
} from "@/components/stats/format";
import { cn } from "@/lib/utils";

export const SIZE_PRESETS = [1_000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const SLIDER_MIN = 100;
const SLIDER_MAX = 5_000_000;
const SLIDER_STEPS = 1000;

/** Cost components, in stacking order. Fee takes the accent: it is the one
 *  part the trader controls, through their tier. */
const PARTS = [
  { key: "spreadUsd", label: "Spread", color: "var(--t-cost-spread)" },
  { key: "slippageUsd", label: "Slippage", color: "var(--t-cost-slippage)" },
  { key: "feeUsd", label: "Fee", color: "var(--t-accent)" },
] as const;

/** The estimator's figure-input type, so both calculators on the site set
 *  their numbers alike. */
const FIGURE_FIELD = "font-figure text-[18px] leading-none tracking-[-0.03em]";

const SIDE_OPTIONS = [
  { value: "buy" as const, label: "Buy / Long" },
  { value: "sell" as const, label: "Sell / Short" },
];
const TYPE_OPTIONS = [
  { value: "taker" as const, label: "Market" },
  { value: "maker" as const, label: "Limit (maker)" },
];

function toSlider(usd: number): number {
  const t = (Math.log10(usd) - Math.log10(SLIDER_MIN)) / (Math.log10(SLIDER_MAX) - Math.log10(SLIDER_MIN));
  return Math.round(Math.max(0, Math.min(1, t)) * SLIDER_STEPS);
}

function fromSlider(v: number): number {
  const exp = Math.log10(SLIDER_MIN) + (v / SLIDER_STEPS) * (Math.log10(SLIDER_MAX) - Math.log10(SLIDER_MIN));
  const raw = 10 ** exp;
  // Two significant figures, so the slider lands on sizes people type.
  const mag = 10 ** (Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

/** A footer cell, as on the Overview KPI cards: a dim label over a value. */
function FooterCell({
  label,
  value,
  swatch,
  tone,
}: {
  label: string;
  value: string;
  swatch?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-label m-0 flex items-center gap-1.5 text-text-dim">
        {swatch && <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ background: swatch }} />}
        {label}
      </p>
      <p className={cn("font-data m-0 mt-1.5 truncate-safe leading-none text-text-primary", tone)}>
        <SwapValue>{value}</SwapValue>
      </p>
    </div>
  );
}

export function CostCalculator({
  base,
  decimals,
  top,
  side,
  onSide,
  orderType,
  onOrderType,
  sizeUsd,
  onSize,
  tier,
  onTier,
  rebateId,
  onRebate,
  onWalletTier,
  cost,
  marketCost,
}: {
  base: string;
  decimals: number;
  top: BookTop;
  side: Side;
  onSide: (s: Side) => void;
  orderType: OrderType;
  onOrderType: (t: OrderType) => void;
  sizeUsd: number;
  onSize: (usd: number) => void;
  tier: number;
  onTier: (tier: number) => void;
  rebateId: number;
  onRebate: (id: number) => void;
  onWalletTier: (tier: number | null) => void;
  cost: ExecutionCost | null;
  /** The same order as a market order, shown beside a limit order's cost. */
  marketCost: ExecutionCost | null;
}) {
  const [text, setText] = useState(() => sizeUsd.toLocaleString("en-US"));
  const [wallet, setWallet] = useState("");
  const [walletState, setWalletState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ok"; volumeUsd: number; tier: number }
  >({ status: "idle" });
  // Only the newest lookup may write; an older one finishing late is dropped.
  const walletRequest = useRef(0);

  // Follow a size set from elsewhere — a preset, the slider, a click on the
  // cost curve — unless the box already holds that value in another spelling.
  useEffect(() => {
    setText((prev) => (parseUsdInput(prev) === sizeUsd ? prev : sizeUsd.toLocaleString("en-US")));
  }, [sizeUsd]);

  async function detectTier() {
    const address = wallet.trim();
    if (!address) return;
    const id = ++walletRequest.current;
    setWalletState({ status: "loading" });
    onWalletTier(null);
    try {
      const res = await fetch(`/api/fee-tier?address=${encodeURIComponent(address)}`);
      const body = (await res.json().catch(() => ({}))) as { volumeUsd?: number; error?: string };
      if (id !== walletRequest.current) return;
      if (!res.ok || body.volumeUsd == null) {
        setWalletState({ status: "error", message: body.error ?? "Lookup failed" });
        return;
      }
      const found = tierForVolume(body.volumeUsd).tier;
      setWalletState({ status: "ok", volumeUsd: body.volumeUsd, tier: found });
      onTier(found);
      onWalletTier(found);
    } catch {
      if (id === walletRequest.current) setWalletState({ status: "error", message: "Lookup failed" });
    }
  }

  function clearWallet() {
    walletRequest.current += 1;
    setWallet("");
    setWalletState({ status: "idle" });
    onWalletTier(null);
  }

  const maker = orderType === "maker";
  // The rebate list's final width — half the row less the gap — so it can
  // hold that width while its column is still growing into it.
  const [selectRowRef, { width: selectRowWidth }] = useElementSize<HTMLDivElement>();
  const halfWidth = Math.max(0, (selectRowWidth - 8) / 2);

  const fill = cost?.fill ?? null;
  const partial = fill != null && !fill.complete;
  const positiveTotal = cost ? Math.max(0, cost.spreadUsd) + Math.max(0, cost.slippageUsd) + Math.max(0, cost.feeUsd) : 0;
  const earns = cost != null && cost.totalUsd < 0;
  const makerPrice = side === "buy" ? top.bestBid : top.bestAsk;
  // What the size buys: walked through the book for a market order, at the
  // price it rests at for a limit one, which walks nothing.
  const qty = fill ? fill.qty : makerPrice ? sizeUsd / makerPrice : null;
  const fmtQty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const feeFactor = cost ? cost.feeBp / 1e4 : 0;
  const effective = fill
    ? side === "buy"
      ? fill.vwap * (1 + feeFactor)
      : fill.vwap * (1 - feeFactor)
    : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1">
        <PanelLabel>Execution cost calculator</PanelLabel>
        <InfoTooltip
          floating
          panelClassName="w-64"
          text="What your order costs on the live book. Market orders pay spread, slippage and the taker fee. Limit orders pay only the maker fee."
        />
      </div>

      <div className="mt-4 flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SegmentedToggle options={SIDE_OPTIONS} value={side} onChange={onSide} layoutId="stats-calc-side" />
          <SegmentedToggle options={TYPE_OPTIONS} value={orderType} onChange={onOrderType} layoutId="stats-calc-type" />
        </div>

        {/* Position size — the estimator's hero-field treatment: tinted
            block, accent label, figure input, preset chips, then the slider. */}
        <div className="rounded-[12px] border border-[rgb(var(--t-accent-rgb)/0.22)] bg-[rgb(var(--t-accent-rgb)/0.03)] px-3.5 py-3">
          <FieldLabel label="Position size" accent htmlFor="stats-size" />
          <div className="mt-2 flex h-11 items-center gap-2 rounded-[10px] border border-accent/50 bg-[var(--color-bulk-base)] px-3.5">
            <span className={cn(FIGURE_FIELD, "text-text-muted")}>$</span>
            <input
              id="stats-size"
              inputMode="decimal"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const n = parseUsdInput(e.target.value);
                if (n != null) onSize(n);
              }}
              onBlur={() => setText(sizeUsd.toLocaleString("en-US"))}
              className={cn(FIGURE_FIELD, "min-w-0 flex-1 bg-transparent text-text-primary outline-none")}
            />
            <span className="font-data shrink-0 text-[12px] text-text-muted">
              <SwapValue>
                {qty != null ? `≈ ${fmtQty(qty)} ${base}` : base}
              </SwapValue>
            </span>
          </div>
          <div className="mt-2 grid w-full grid-cols-4 gap-1.5 sm:grid-cols-7">
            {SIZE_PRESETS.map((p) => {
              const on = p === sizeUsd;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onSize(p)}
                  aria-pressed={on}
                  className={cn(
                    "h-7 min-w-0 rounded-[8px] border px-1 text-center text-[11px] font-medium tabular-nums transition-colors",
                    on
                      ? "border-[rgb(var(--t-veil-rgb)/0.16)] bg-[rgb(var(--t-veil-rgb)/0.08)] text-text-primary"
                      : "border-[var(--color-line-strong)] bg-[var(--color-bulk-base)] text-text-muted hover:border-[rgb(var(--t-veil-rgb)/0.14)] hover:text-text-secondary",
                  )}
                >
                  {fmtUsdShort(p)}
                </button>
              );
            })}
          </div>
          <div className="mt-3">
            <TickSlider
              value={toSlider(sizeUsd)}
              onChange={(v) => onSize(fromSlider(v))}
              max={SLIDER_STEPS}
              keyStep={SLIDER_STEPS / 100}
              label="Position size"
              valueText={fmtUsd(sizeUsd)}
            />
          </div>
        </div>

        {/* Fee tier: the wallet search takes the whole row — an address needs
            the room — and the tier list sits under it, sharing its row with
            the maker rebate on a limit order. Both lists name themselves in
            their own options, so neither needs a label that would put the
            two at different heights. */}
        <div className="min-w-0">
          <div className="mb-2 flex h-[15px] items-center justify-between gap-3">
            <FieldLabel
              label="Fee tier"
              info="Your tier depends on your volume over the last 14 days. Search a wallet or pick a tier."
            />
            {walletState.status === "ok" && (
              <span className="font-data shrink-0 text-[11px] leading-none text-text-muted">
                {volumeLabel(Math.round(walletState.volumeUsd))} 14D volume
              </span>
            )}
          </div>
          <WalletSearchField
            value={wallet}
            onChange={setWallet}
            onSubmit={() => void detectTier()}
            onClear={clearWallet}
            loading={walletState.status === "loading"}
            showClear={Boolean(wallet.trim()) || walletState.status === "ok"}
            placeholder="Find your tier from a wallet…"
          />
          {walletState.status === "error" && (
            <p className="m-0 mt-2 font-data text-[13px] text-ask-red">{walletState.message}</p>
          )}
          {/* The rebate list is always mounted and eases in and out: its
              column grows from nothing while the tier list gives up half the
              row (on a phone, where the two stack, its row grows instead).
              The list inside keeps its final width and rides the column's
              left edge, so it slides in from the right rather than
              squeezing. */}
          <div
            ref={selectRowRef}
            className={cn(
              "mt-2 grid transition-[grid-template-columns,grid-template-rows,column-gap,row-gap] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              maker
                ? "grid-rows-[auto_1fr] gap-y-2 sm:grid-cols-[1fr_1fr] sm:grid-rows-1 sm:gap-x-2 sm:gap-y-0"
                : "grid-rows-[auto_0fr] gap-y-0 sm:grid-cols-[1fr_0fr] sm:grid-rows-1 sm:gap-x-0",
            )}
          >
            <Select
              className="min-w-0"
              value={String(tier)}
              onChange={(v) => onTier(Number(v))}
              options={FEE_TIERS.map((t) => ({
                value: String(t.tier),
                label: `Tier ${t.tier} · ${tierRangeLabel(t)} · ${orderType === "taker" ? t.takerBps : t.makerBps} bp`,
              }))}
            />
            <div
              inert={!maker || undefined}
              aria-hidden={!maker}
              className={cn(
                "min-h-0 min-w-0 overflow-hidden transition-[opacity,transform] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                maker ? "opacity-100 sm:translate-x-0" : "opacity-0 sm:translate-x-3",
              )}
            >
              <div className="w-full sm:w-[var(--half)]" style={{ "--half": `${halfWidth}px` } as CSSProperties}>
                <Select
                  value={String(rebateId)}
                  onChange={(v) => onRebate(Number(v))}
                  options={MAKER_REBATES.map((r) => ({
                    value: String(r.id),
                    label:
                      r.id === 0
                        ? "No maker rebate"
                        : `Rebate ${r.bps} bp · ≥ ${(r.minShare * 100).toFixed(2)}% share`,
                  }))}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Result, on the Overview KPI card's pattern: a label, one figure in
            ink with its rate beside it, then a footer grid of label-over-value
            cells. Two rows of three share one set of columns — what the cost
            is made of, then how the order fills — so it reads as a grid, not a
            list. The bar's segments run in the same order as the first row. */}
        <div className="border-t border-[var(--color-line)] pt-4">
          <PanelLabel>{earns ? "You earn" : "You pay"}</PanelLabel>
          <p className="m-0 mt-2 flex items-baseline gap-2">
            <span
              className={cn(
                "font-figure whitespace-nowrap text-[26px] font-semibold leading-none tracking-[-0.02em] sm:text-[28px] xl:text-[30px]",
                earns ? "text-bid-green" : "text-text-primary",
              )}
            >
              <SwapValue>{cost ? fmtUsd(Math.abs(cost.totalUsd)) : "—"}</SwapValue>
            </span>
            <span className="font-data leading-none text-text-muted">
              <SwapValue>{cost ? fmtBp(Math.abs(cost.totalBp)) : ""}</SwapValue>
            </span>
          </p>

          <div
            className="mt-4 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-[rgb(var(--t-veil-rgb)/0.05)]"
            role="img"
            aria-label="Cost breakdown"
          >
            {cost &&
              positiveTotal > 0 &&
              PARTS.map((p) => {
                const v = Math.max(0, cost[p.key]);
                return v > 0 ? (
                  <span
                    key={p.key}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${(v / positiveTotal) * 100}%`, background: p.color }}
                  />
                ) : null;
              })}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 border-t border-[var(--color-line)] pt-3">
            {PARTS.map((p) => {
              const usd = cost ? cost[p.key] : null;
              const rebate = p.key === "feeUsd" && usd != null && usd < 0;
              return (
                <FooterCell
                  key={p.key}
                  label={rebate ? "Rebate" : p.label}
                  swatch={p.color}
                  value={usd != null ? fmtUsd(Math.abs(usd)) : "—"}
                  tone={rebate ? "text-bid-green" : undefined}
                />
              );
            })}
            <span className="col-span-3 h-px bg-[var(--color-line-soft)]" aria-hidden />
            {orderType === "taker" && fill ? (
              <>
                <FooterCell label="Avg fill" value={fmtPrice(fill.vwap, decimals)} />
                <FooterCell label="With fee" value={fmtPrice(effective, decimals)} />
                <FooterCell
                  label="Impact"
                  // Unsigned: a sell pushes the price down, but the impact is
                  // a cost to the trader either way, not a gain.
                  value={top.mid ? `${((Math.abs(fill.worstPx - top.mid) / top.mid) * 100).toFixed(3)}%` : "—"}
                />
              </>
            ) : (
              <>
                <FooterCell label={side === "buy" ? "Rests at bid" : "Rests at ask"} value={fmtPrice(makerPrice, decimals)} />
                <FooterCell
                  label="Quantity"
                  value={qty != null ? fmtQty(qty) : "—"}
                />
                <FooterCell label="At market" value={marketCost ? fmtUsd(marketCost.totalUsd) : "—"} />
              </>
            )}
          </div>

          {partial && fill && (
            <p className="m-0 mt-3 rounded-[10px] bg-[rgb(var(--t-red-rgb)/0.1)] px-3 py-2 text-[12px] leading-relaxed text-ask-red">
              Only {fmtUsd(fill.filledUsd)} rests on the {side === "buy" ? "ask" : "bid"} side — the rest of this
              order would not fill. Costs are for the filled part.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
