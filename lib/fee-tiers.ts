/**
 * BULK's fee schedule, Phase 1 "Genesis Liquidity" — the one in force: the
 * exchange's own `fullAccount.feeTiers` reports these exact thresholds and
 * rates (maker 0, taker 3.5 → 2.6 bp over the first five tiers).
 * https://docs.bulk.trade/bulk-exchange/fees
 *
 * The tier is set by the trailing 14 completed UTC days of volume, main
 * account and sub-accounts together. Fees settle per fill, on executed notional.
 */
export interface FeeTier {
  /** 1-based, as the docs number them. The API's `tierIndex` is this minus one. */
  tier: number;
  minVolumeUsd: number;
  makerBps: number;
  takerBps: number;
}

export const FEE_TIERS: FeeTier[] = [
  { tier: 1, minVolumeUsd: 0, makerBps: 0, takerBps: 3.5 },
  { tier: 2, minVolumeUsd: 1e6, makerBps: 0, takerBps: 3.3 },
  { tier: 3, minVolumeUsd: 10e6, makerBps: 0, takerBps: 3.0 },
  { tier: 4, minVolumeUsd: 50e6, makerBps: 0, takerBps: 2.8 },
  { tier: 5, minVolumeUsd: 150e6, makerBps: 0, takerBps: 2.6 },
  { tier: 6, minVolumeUsd: 500e6, makerBps: 0, takerBps: 2.4 },
  { tier: 7, minVolumeUsd: 1.5e9, makerBps: 0, takerBps: 2.3 },
  { tier: 8, minVolumeUsd: 4e9, makerBps: 0, takerBps: 2.2 },
];

/** Per-market maker rebates, earned by share of that market's maker volume.
 *  Negative: a rebate is paid to the maker. */
export interface MakerRebate {
  id: number;
  minShare: number;
  bps: number;
}

export const MAKER_REBATES: MakerRebate[] = [
  { id: 0, minShare: 0, bps: 0 },
  { id: 1, minShare: 0.005, bps: -0.2 },
  { id: 2, minShare: 0.025, bps: -1.0 },
  { id: 3, minShare: 0.05, bps: -1.5 },
];

export function tierForVolume(volumeUsd: number): FeeTier {
  let hit = FEE_TIERS[0];
  for (const tier of FEE_TIERS) if (volumeUsd >= tier.minVolumeUsd) hit = tier;
  return hit;
}

export function volumeLabel(usd: number): string {
  if (usd >= 1e9) return `$${+(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${+(usd / 1e6).toFixed(1)}M`;
  return `$${usd.toLocaleString("en-US")}`;
}

export function tierRangeLabel(tier: FeeTier): string {
  return tier.minVolumeUsd === 0
    ? `< ${volumeLabel(FEE_TIERS[1].minVolumeUsd)}`
    : `≥ ${volumeLabel(tier.minVolumeUsd)}`;
}
