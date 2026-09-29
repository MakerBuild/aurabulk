"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PanelCard } from "@/components/overview/PanelCard";
import { SegmentedToggle } from "@/components/overview/SegmentedToggle";
import { usePolledJson } from "@/components/live/use-polled-json";
import { SwapProvider, SwapValue } from "@/components/ui/SwapValue";
import { KpiTerminalCounter } from "@/components/cards/KpiTerminalCounter";
import { CostCalculator } from "@/components/stats/CostCalculator";
import { CostCurve } from "@/components/stats/CostCurve";
import { DepthChart } from "@/components/stats/DepthChart";
import { FeeTierTable } from "@/components/stats/FeeTierTable";
import { DEFAULT_BAND, LEVELS, TwoSidedLiquidity } from "@/components/stats/TwoSidedLiquidity";
import { fmtBp, fmtPrice, fmtSignedBp } from "@/components/stats/format";
import { FEE_TIERS, MAKER_REBATES } from "@/lib/fee-tiers";
import type { AllMarketsPayload, MarketQualityPayload } from "@/lib/market-quality";
import {
  bookTop,
  executionCost,
  type Book,
  type OrderType,
  type Side,
} from "@/lib/order-book-math";
import { cn } from "@/lib/utils";

/** Every 2s: the depth chart eases into each book, so a faster beat reads as
 *  a live book rather than a flicker. Matches the server cache below it. */
const POLL = { intervalMs: 2_000, minGapMs: 1_500 };
/** The other markets, kept warm for a ticker switch: slow, since the one on
 *  screen replaces its reading with a fresh one within a poll anyway. */
const ALL_POLL = { intervalMs: 15_000, minGapMs: 10_000 };
const EMPTY_BOOK: Book = { bids: [], asks: [] };
/** Where the viewer's choice of liquidity levels is kept between visits. */
const LEVELS_KEY = "stats:liquidity-levels";

function loadLevels(): number[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? "null") as unknown;
    if (!Array.isArray(saved)) return null;
    const levels = LEVELS.filter((l) => saved.includes(l));
    return levels.length ? levels : null;
  } catch {
    return null;
  }
}

function saveLevels(levels: number[]) {
  try {
    localStorage.setItem(LEVELS_KEY, JSON.stringify(levels));
  } catch {
    // Private windows and blocked storage: the choice just lasts the visit.
  }
}

/** Supporting figure in the market strip. On a phone it is a table row —
 *  label left, value right, on a hairline — so five figures read as one
 *  list rather than wrapping into a ragged 3 + 2. From sm up it is the
 *  label-over-value pair in a single line with the rest. */
function StripStat({
  label,
  value,
  tone,
  width,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  /** A fixed width from sm up, sized to the widest value any market shows
   *  here, so switching market (or a count running through it) never
   *  shifts the figures beside it. */
  width: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 min-w-0 items-center justify-between gap-3 border-t border-[var(--color-line-soft)] sm:h-auto sm:flex-col sm:items-start sm:justify-start sm:gap-1.5 sm:border-0",
        width,
      )}
    >
      <span className="font-label leading-none text-text-muted">{label}</span>
      <span className={cn("font-data truncate-safe leading-none text-text-primary", tone)}>
        {value}
      </span>
    </div>
  );
}

/** A strip figure that counts to each new value — the Overview KPIs' fast
 *  recount — so a market switch runs the numbers over rather than swapping
 *  them. A missing value is a dash, not a count toward zero. */
function Counted({ value, format }: { value: number | null | undefined; format: (n: number) => string }) {
  if (value == null || !Number.isFinite(value)) return <>—</>;
  return <KpiTerminalCounter value={value} format={format} />;
}

export function StatsDashboard() {
  const [symbol, setSymbol] = useState("BTC-USD");
  // The latest reading of every market, so switching ticker shows one that
  // is already here instead of waiting on a request.
  const [byMarket, setByMarket] = useState<Record<string, MarketQualityPayload>>({});
  const [markets, setMarkets] = useState<string[]>(["BTC-USD"]);

  const [side, setSide] = useState<Side>("buy");
  const [orderType, setOrderType] = useState<OrderType>("taker");
  const [sizeUsd, setSizeUsd] = useState(100_000);
  const [tier, setTier] = useState(1);
  const [rebateId, setRebateId] = useState(0);
  const [walletTier, setWalletTier] = useState<number | null>(null);
  const [band, setBand] = useState(DEFAULT_BAND);
  const [levels, setLevels] = useState<number[]>(LEVELS);

  // The saved choice is read after mount: the server renders every level,
  // and reading storage during render would not match it.
  useEffect(() => {
    const saved = loadLevels();
    if (!saved) return;
    setLevels(saved);
    setBand((b) => (saved.includes(b) ? b : [...saved].sort((x, y) => Math.abs(x - b) - Math.abs(y - b))[0]));
  }, []);

  function changeLevels(next: number[]) {
    setLevels(next);
    saveLevels(next);
  }
  // Where the next market's data slides in from: a ticker to the left of the
  // current one brings it in from the right (travelling right to left), one
  // to the right brings it in from the left.
  const [slideDir, setSlideDir] = useState<1 | -1>(1);

  function pickMarket(next: string) {
    if (next === symbol) return;
    setSlideDir(markets.indexOf(next) < markets.indexOf(symbol) ? 1 : -1);
    setSymbol(next);
  }

  // Two polls into one store. The market on screen, every 2s; and every
  // market, every 15s, so a ticker switch shows a reading already here and
  // does not wait on the network. Each lands over the last readings, and a
  // market that failed a round keeps its previous one.
  function store(payloads: MarketQualityPayload[], list: string[]) {
    setByMarket((prev) => {
      const merged = { ...prev };
      // Never let an older reading replace a newer one.
      for (const p of payloads) if (!merged[p.symbol] || merged[p.symbol].updatedAt <= p.updatedAt) merged[p.symbol] = p;
      return merged;
    });
    if (list.length) setMarkets((prev) => (prev.join() === list.join() ? prev : list));
  }
  usePolledJson<MarketQualityPayload>(`/api/market-quality?symbol=${encodeURIComponent(symbol)}`, POLL, (next) =>
    store([next], next.markets),
  );
  usePolledJson<AllMarketsPayload>("/api/market-quality?symbol=all", ALL_POLL, (next) =>
    store(next.payloads, next.markets),
  );

  // Normally the picked market is already held. If it is not yet (it failed
  // to load), the last one shown stays on screen, dimmed, under its own
  // name, until it lands; blanking to dashes read as wipe-and-repaint.
  const current = byMarket[symbol];
  const [lastShown, setLastShown] = useState<string | null>(null);
  useEffect(() => {
    if (current) setLastShown(symbol);
  }, [current, symbol]);
  const live = current ?? (lastShown ? byMarket[lastShown] : undefined) ?? null;
  const shownSymbol = live?.symbol ?? symbol;
  const pending = live != null && live.symbol !== symbol;
  const book = useMemo<Book>(() => (live ? { bids: live.bids, asks: live.asks } : EMPTY_BOOK), [live]);
  const top = useMemo(() => bookTop(book), [book]);
  const decimals = live?.pricePrecision ?? 2;
  const base = shownSymbol.replace(/-USD$/i, "");

  const feeTier = FEE_TIERS.find((t) => t.tier === tier) ?? FEE_TIERS[0];
  const rebateBps = MAKER_REBATES.find((r) => r.id === rebateId)?.bps ?? 0;
  const feeBps = orderType === "taker" ? feeTier.takerBps : feeTier.makerBps + rebateBps;

  const cost = useMemo(
    () => executionCost(book, side, sizeUsd, feeBps, orderType),
    [book, side, sizeUsd, feeBps, orderType],
  );
  const marketCost = useMemo(
    () => (orderType === "maker" ? executionCost(book, side, sizeUsd, feeTier.takerBps, "taker") : cost),
    [orderType, book, side, sizeUsd, feeTier.takerBps, cost],
  );

  const markVsOracle =
    live?.markPrice != null && live.oraclePrice != null
      ? ((live.markPrice - live.oraclePrice) / live.oraclePrice) * 1e4
      : null;
  const updated = live
    ? new Date(live.updatedAt).toLocaleTimeString("en-US", { hour12: false, timeZone: "UTC" })
    : null;

  return (
    // Every value on the page slides when the market changes; labels,
    // headings and charts stay put. The provider says which market the
    // values belong to and which way to slide.
    <SwapProvider swapKey={shownSymbol} direction={slideDir} pending={pending}>
    <div className="flex flex-col gap-4">
      {/* Market strip — one line. The market and its price lead at headline
          size; everything else is supporting data a step down, so the eye
          lands on what is being traded before the detail around it. */}
      <PanelCard glossy glossDelay={-4} className="py-3 sm:py-3.5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {/* On a phone the pair is centred on the rule between them: the
              market reads right-aligned into it and the price left-aligned out
              of it, so the rule holds still whatever the symbol or price. */}
          <div className="order-1 flex w-full min-w-0 items-center sm:order-none sm:w-auto sm:gap-5">
            <div className="flex flex-1 flex-col items-end gap-1.5 pr-5 sm:flex-none sm:items-start sm:pr-0">
              <span className="flex items-baseline gap-2">
                {/* Wide enough for the widest symbol (PUMP), in ems so it
                    holds at every size this figure is set in. */}
                <span className="font-figure text-[26px] font-semibold leading-none tracking-[-0.02em] text-text-primary sm:min-w-[2.75em] sm:text-[28px] xl:text-[30px]">
                  <SwapValue>{base}</SwapValue>
                </span>
                <span className="font-label text-accent">Perp</span>
              </span>
              <span className="flex items-center gap-1.5 font-data text-[11px] leading-none text-text-muted">
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", updated ? "bg-bid-green" : "bg-[var(--t-text-dim)]")}
                  aria-hidden
                />
                <SwapValue>{updated ? `${updated} UTC` : "Connecting…"}</SwapValue>
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 border-l border-[var(--color-line)] pl-5 sm:flex-none">
              {/* Holds the widest price (0.00412345) so the count running
                  from one market's price to the next moves nothing beside it. */}
              <span className="font-figure text-[26px] font-semibold leading-none tracking-[-0.02em] text-text-primary sm:min-w-[5.3em] sm:text-[28px] xl:text-[30px]">
                <Counted value={top.mid} format={(n) => fmtPrice(n, decimals)} />
              </span>
              <span className="font-label leading-none text-text-muted">Mid price</span>
            </div>
          </div>

          {/* After the market switcher on a phone, beside the price from sm. */}
          <div className="order-3 flex w-full flex-col sm:order-none sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-3">
            {/* Widths measured in the strip's own type: prices run to ten
                characters (0.00412345, 10,672.043), bp and funding to about
                eight, and "Mark vs oracle" is set by its label. */}
            <StripStat
              label="Spread"
              width="sm:w-[64px]"
              value={<Counted value={top.spreadBp} format={(n) => fmtBp(n)} />}
            />
            <StripStat
              label="Mark"
              width="sm:w-[80px]"
              value={<Counted value={live?.markPrice} format={(n) => fmtPrice(n, decimals)} />}
            />
            <StripStat
              label="Oracle"
              width="sm:w-[80px]"
              value={<Counted value={live?.oraclePrice} format={(n) => fmtPrice(n, decimals)} />}
            />
            <StripStat
              label="Mark vs oracle"
              width="sm:w-[100px]"
              value={<Counted value={markVsOracle} format={(n) => fmtSignedBp(n)} />}
              tone={
                markVsOracle == null || Math.abs(markVsOracle) < 0.005
                  ? undefined
                  : markVsOracle > 0
                    ? "text-bid-green"
                    : "text-ask-red"
              }
            />
            <StripStat
              label="Funding / h"
              width="sm:w-[76px]"
              value={<Counted value={live?.fundingRate} format={(n) => `${(n * 100).toFixed(4)}%`} />}
            />
          </div>

          {/* On a phone the switcher is a 4 × 2 grid, every market in view: a
              single scrolling row cut the last ticker off at the card edge.
              `grid!` because .term-seg sets display outside the utilities. */}
          <div className="order-2 w-full sm:order-none sm:-mx-1 sm:w-auto sm:max-w-full sm:overflow-x-auto sm:px-1 sm:[scrollbar-width:none] xl:ml-auto sm:[&::-webkit-scrollbar]:hidden">
            <SegmentedToggle
              className="max-sm:grid! max-sm:grid-cols-4"
              options={markets.map((m) => ({ value: m, label: m.replace(/-USD$/i, "") }))}
              value={symbol}
              onChange={pickMarket}
              layoutId="stats-market-pill"
            />
          </div>
        </div>
      </PanelCard>

      <PanelCard glossy glossDelay={-11}>
        <TwoSidedLiquidity
          book={book}
          mid={top.mid}
          focus={band}
          onFocus={setBand}
          shown={levels}
          onShownChange={changeLevels}
          decimals={decimals}
          tickSize={live?.tickSize ?? null}
        />
      </PanelCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PanelCard glossy glossDelay={-9}>
          <CostCalculator
            base={base}
            decimals={decimals}
            top={top}
            side={side}
            onSide={setSide}
            orderType={orderType}
            onOrderType={setOrderType}
            sizeUsd={sizeUsd}
            onSize={setSizeUsd}
            tier={tier}
            onTier={setTier}
            rebateId={rebateId}
            onRebate={setRebateId}
            onWalletTier={setWalletTier}
            cost={cost}
            marketCost={marketCost}
          />
        </PanelCard>
        {/* Both chart cards grow to split the height the calculator sets,
            so the column ends level with it instead of leaving a gap. */}
        <div className="flex min-w-0 flex-col gap-4">
          <PanelCard glossy glossDelay={-13} className="flex-[3]">
            <DepthChart market={shownSymbol} book={book} mid={top.mid} cost={marketCost} decimals={decimals} />
          </PanelCard>
          <PanelCard glossy glossDelay={-2} className="flex-[2]">
            <CostCurve
              book={book}
              side={side}
              takerBps={feeTier.takerBps}
              sizeUsd={sizeUsd}
              onPickSize={setSizeUsd}
            />
          </PanelCard>
        </div>
      </div>

      <PanelCard glossy glossDelay={-6}>
        <FeeTierTable
          selected={tier}
          onSelect={setTier}
          walletTier={walletTier}
          cost={cost}
          orderType={orderType}
          rebateBps={rebateBps}
        />
      </PanelCard>
    </div>
    </SwapProvider>
  );
}
