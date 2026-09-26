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
  // so the prefix is a redundant echo. "protocol" is the week's protocol pool,
  // shown as BulkSOL like every other protocol reward, and is the one
  // remainder that must not be stripped further — the filter below drops
  // that word as noise, which would leave nothing to show.
  const mainnetPrefixMatch = key.match(/^mainnet_week\d+_(.+)$/i);
  if (mainnetPrefixMatch) {
    const rest = mainnetPrefixMatch[1];
    return rest.toLowerCase() === "protocol" ? "BulkSOL" : categoryLabel(rest);
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

export const FDV_SCENARIOS = [100_000_000, 250_000_000, 500_000_000, 750_000_000, 1_000_000_000, 2_000_000_000];
