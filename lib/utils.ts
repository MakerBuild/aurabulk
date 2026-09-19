import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number, decimals = 0): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatUsd(value: number): string {
  return `$${formatNumber(value, value < 1000 ? 2 : 0)}`;
}

export function truncateWallet(wallet: string, chars = 4): string {
  if (wallet.length <= chars * 2 + 3) return wallet;
  return `${wallet.slice(0, chars)}...${wallet.slice(-chars)}`;
}

export function categoryLabel(key: string): string {
  // "retro_*" and "weekN_*" categories are only ever shown inside that
  // group's own drill-down (the "Retro" / "Week N" filter is already
  // selected), so the prefix is a redundant echo — strip it and label by
  // what's left.
  if (key.startsWith("retro_")) return categoryLabel(key.slice("retro_".length));

  // Bare "weekN" / "predeposit_weekN" is the deposit-holding bucket itself.
  if (/^week\d+$/i.test(key) || /^predeposit_week\d+$/i.test(key)) return "Pre-Deposits";

  // "referral_weekN" / "predeposit_referral_weekN" — week number is redundant.
  if (/^(?:predeposit_)?referral_week\d+$/i.test(key)) return "Referrals";

  const weekPrefixMatch = key.match(/^week\d+_(.+)$/i);
  if (weekPrefixMatch) return categoryLabel(weekPrefixMatch[1]);

  // Same for "mainnet_weekN_*": the drill-down is already scoped to that week,
  // so the prefix is a redundant echo. "protocol" is the week's bonus bucket
  // and is the one remainder that must not be stripped further — the filter
  // below drops that word as noise, which would leave nothing to show.
  const mainnetPrefixMatch = key.match(/^mainnet_week\d+_(.+)$/i);
  if (mainnetPrefixMatch) {
    const rest = mainnetPrefixMatch[1];
    return rest.toLowerCase() === "protocol" ? "Protocols" : categoryLabel(rest);
  }

  const parts = key.split("_").filter((part) => part.toLowerCase() !== "protocol");
  if (parts.length !== key.split("_").length) {
    return categoryLabel(parts.join("_"));
  }

  if (key === "bulk_validator_stake") return "Validator Stake";

  return key
    .replace(/_/g, " ")
    .replace(/\bweek(\d+)/gi, "week $1")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Exclusive Aura bands for the Overview depositor chart. A wallet sits in
 * exactly one — `<10` is [0, 10), `100000+` is [100000, ∞). */
/** Tier names in band order, smallest to largest. The Overview ring and the
 *  wallet lookup both read them from here so they cannot drift apart. */
export const AURA_TIER_NAMES = [
  "Snowflake",
  "Bulker",
  "Lil Yeti",
  "Bulking Yeti",
  "Auramaxer",
  "Megalodon",
] as const;

/** The tier a wallet's Aura puts it in, or null with no Aura at all. */
export function auraTierName(aura: number): string | null {
  if (!(aura > 0)) return null;
  const index = DEPOSITOR_AURA_RANGES.findIndex(
    (range) => aura >= range.min && aura < range.max,
  );
  return index >= 0 ? AURA_TIER_NAMES[index] : null;
}

export const DEPOSITOR_AURA_RANGES = [
  { id: "under10", label: "<10 AURA", min: 0, max: 10 },
  { id: "10-100", label: "10-100 AURA", min: 10, max: 100 },
  { id: "100-1000", label: "100-1k AURA", min: 100, max: 1000 },
  { id: "1000-10000", label: "1k-10k AURA", min: 1000, max: 10000 },
  { id: "10000-100000", label: "10k-100k AURA", min: 10000, max: 100000 },
  { id: "100000+", label: "100k+ AURA", min: 100000, max: Infinity },
] as const;

export const FDV_SCENARIOS = [100_000_000, 250_000_000, 500_000_000, 750_000_000, 1_000_000_000, 2_000_000_000];
