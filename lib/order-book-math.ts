/**
 * Execution-cost math over an L2 snapshot. Pure and dependency-free so the
 * Stats page can re-price an order on every keystroke against the book it
 * already holds, without a round trip.
 */

/** [price, size in base units], best price first. */
export type Level = [number, number];

export interface Book {
  bids: Level[];
  asks: Level[];
}

export type Side = "buy" | "sell";
export type OrderType = "taker" | "maker";

export interface BookTop {
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  spread: number | null;
  spreadBp: number | null;
}

export function bookTop(book: Book): BookTop {
  const bestBid = book.bids[0]?.[0] ?? null;
  const bestAsk = book.asks[0]?.[0] ?? null;
  if (bestBid == null || bestAsk == null) {
    return { bestBid, bestAsk, mid: null, spread: null, spreadBp: null };
  }
  const mid = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;
  return { bestBid, bestAsk, mid, spread, spreadBp: (spread / mid) * 1e4 };
}

export interface Fill {
  requestedUsd: number;
  filledUsd: number;
  qty: number;
  vwap: number;
  worstPx: number;
  levelsUsed: number;
  complete: boolean;
}

/** Walks `usd` of notional through one side of the book. */
export function walkBook(levels: Level[], usd: number): Fill | null {
  if (!levels.length || !(usd > 0)) return null;
  let remaining = usd;
  let qty = 0;
  let worstPx = levels[0][0];
  let levelsUsed = 0;
  for (const [px, sz] of levels) {
    const take = Math.min(px * sz, remaining);
    qty += take / px;
    remaining -= take;
    worstPx = px;
    levelsUsed += 1;
    if (remaining <= 1e-9) break;
  }
  const filledUsd = usd - Math.max(0, remaining);
  return {
    requestedUsd: usd,
    filledUsd,
    qty,
    vwap: filledUsd / qty,
    worstPx,
    levelsUsed,
    complete: remaining <= 1e-6,
  };
}

export interface ExecutionCost {
  side: Side;
  orderType: OrderType;
  /** Null for a resting order: it sets its own price and walks nothing. */
  fill: Fill | null;
  /** Notional the costs are measured on — the filled part for a market order. */
  notionalUsd: number;
  /** Crossing from mid to the touch: half the spread. */
  spreadUsd: number;
  /** Walking past the touch into deeper levels. */
  slippageUsd: number;
  feeUsd: number;
  totalUsd: number;
  spreadBp: number;
  slippageBp: number;
  feeBp: number;
  totalBp: number;
}

/**
 * All-in cost of an order against mid, split into what crossing the spread,
 * walking the book and the fee each take. A market order pays all three; a
 * limit order that rests and fills at its own price pays only the maker fee
 * (negative with a rebate).
 */
export function executionCost(
  book: Book,
  side: Side,
  usd: number,
  feeBps: number,
  orderType: OrderType,
): ExecutionCost | null {
  const top = bookTop(book);
  if (top.mid == null || top.bestBid == null || top.bestAsk == null || !(usd > 0)) return null;

  if (orderType === "maker") {
    const feeUsd = (usd * feeBps) / 1e4;
    return {
      side,
      orderType,
      fill: null,
      notionalUsd: usd,
      spreadUsd: 0,
      slippageUsd: 0,
      feeUsd,
      totalUsd: feeUsd,
      spreadBp: 0,
      slippageBp: 0,
      feeBp: feeBps,
      totalBp: feeBps,
    };
  }

  const fill = walkBook(side === "buy" ? book.asks : book.bids, usd);
  if (!fill || fill.qty <= 0) return null;
  const touch = side === "buy" ? top.bestAsk : top.bestBid;
  const sign = side === "buy" ? 1 : -1;
  // Clamped at zero: a crossed or locked book can put the touch on the wrong
  // side of mid by a rounding hair, and a negative cost there is noise.
  const spreadUsd = Math.max(0, sign * fill.qty * (touch - top.mid));
  const slippageUsd = Math.max(0, sign * (fill.filledUsd - fill.qty * touch));
  const feeUsd = (fill.filledUsd * feeBps) / 1e4;
  const totalUsd = spreadUsd + slippageUsd + feeUsd;
  const n = fill.filledUsd;
  return {
    side,
    orderType,
    fill,
    notionalUsd: n,
    spreadUsd,
    slippageUsd,
    feeUsd,
    totalUsd,
    spreadBp: (spreadUsd / n) * 1e4,
    slippageBp: (slippageUsd / n) * 1e4,
    feeBp: feeBps,
    totalBp: (totalUsd / n) * 1e4,
  };
}

/** USD resting on one whole side — the largest order it can fill. */
export function sideDepthUsd(levels: Level[]): number {
  return levels.reduce((sum, [px, sz]) => sum + px * sz, 0);
}

/** USD resting on one side within `bp` basis points of mid. */
export function depthWithinBp(levels: Level[], mid: number, bp: number): number {
  let sum = 0;
  for (const [px, sz] of levels) {
    if ((Math.abs(px - mid) / mid) * 1e4 > bp + 1e-9) break;
    sum += px * sz;
  }
  return sum;
}

/** Market-order cost of `usd` on each side, before fees, in bp of notional.
 *  Null for a side that cannot fill the size. */
export function sideCosts(book: Book, usd: number): { buyBp: number | null; sellBp: number | null } {
  const at = (side: Side) => {
    const c = executionCost(book, side, usd, 0, "taker");
    return c?.fill?.complete ? c.totalBp : null;
  };
  return { buyBp: at("buy"), sellBp: at("sell") };
}

/** Log-spaced order sizes from `min` to `max`, inclusive. */
export function logSizes(min: number, max: number, count: number): number[] {
  const a = Math.log10(min);
  const b = Math.log10(max);
  return Array.from({ length: count }, (_, i) => 10 ** (a + ((b - a) * i) / (count - 1)));
}
