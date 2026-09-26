export interface CategoryBreakdownItem {
  key: string;
  category: string;
  points: number;
  share: number;
}

type AuraCategoryGroup = "retro" | "week" | "other";

interface ParsedAuraCategory {
  group: AuraCategoryGroup;
  week?: number;
}

const REFERRAL_WEEK_RE = /^(?:predeposit_)?referral_week(\d+)$/;
const PREDEPOSIT_WEEK_RE = /^predeposit_week(\d+)$/;
// Any weekN-prefixed sub-category (protocol bonuses, one-off corrections, etc.)
// belongs to that week's group, not "Other".
const WEEK_SUFFIX_RE = /^week(\d+)_.+$/;
const WEEK_RE = /^week(\d+)$/;
// Mainnet trading categories arrive as "mainnet_weekN" (optionally with a
// source suffix) and restart their own numbering at 1. Pre-deposits ran weeks
// 1-14, so mainnet week 1 is week 15 of the campaign — offset them onto the
// same sequence instead of letting them fall into the "Other" catch-all.
const MAINNET_WEEK_RE = /^mainnet_week(\d+)(?:_.+)?$/;
const MAINNET_WEEK_OFFSET = 14;

/**
 * Campaign week a "mainnet_weekN" key belongs to, or null for anything else.
 * The one place that offset lives, so every view agrees on which week mainnet
 * categories land in.
 */
function mainnetCampaignWeek(key: string): number | null {
  const match = key.match(MAINNET_WEEK_RE);
  return match ? Number(match[1]) + MAINNET_WEEK_OFFSET : null;
}

/** Map raw upstream category keys to Retro / Week N / Other buckets. */
export function parseAuraCategoryKey(key: string): ParsedAuraCategory {
  if (key.startsWith("retro_")) {
    return { group: "retro" };
  }

  const mainnetWeek = mainnetCampaignWeek(key);
  if (mainnetWeek != null) {
    return { group: "week", week: mainnetWeek };
  }

  const referralMatch = key.match(REFERRAL_WEEK_RE);
  if (referralMatch) {
    return { group: "week", week: Number(referralMatch[1]) };
  }

  const predepositMatch = key.match(PREDEPOSIT_WEEK_RE);
  if (predepositMatch) {
    return { group: "week", week: Number(predepositMatch[1]) };
  }

  const suffixMatch = key.match(WEEK_SUFFIX_RE);
  if (suffixMatch) {
    return { group: "week", week: Number(suffixMatch[1]) };
  }

  const weekMatch = key.match(WEEK_RE);
  if (weekMatch) {
    return { group: "week", week: Number(weekMatch[1]) };
  }

  return { group: "other" };
}

// Mainnet trading arrives as one "trading" bucket; before 2026-09-17 upstream
// split it into fees, held OI and liquidations/ADL instead. Both shapes are
// the same activity, so a week's drill-down shows them as one row either way.
// Maker rebates, referrals and the protocol bonus stay on their own rows.
const MAINNET_SUFFIX_RE = /^mainnet_week(\d+)_(.+)$/;
const MAINNET_TRADING_SUFFIXES = new Set([
  "trading",
  // Retired upstream keys — kept so older snapshots still collapse correctly.
  "fees",
  "held_oi",
  "liquidations_adl",
]);
const MAINNET_TRADING_LABEL = "Mainnet Trading";

/** Collapse each week's mainnet trading sub-categories into a single row. */
function mergeMainnetTrading(items: CategoryBreakdownItem[]): CategoryBreakdownItem[] {
  const mergedByWeek = new Map<string, CategoryBreakdownItem>();
  const rows: CategoryBreakdownItem[] = [];

  for (const item of items) {
    const match = item.key.match(MAINNET_SUFFIX_RE);
    if (!match || !MAINNET_TRADING_SUFFIXES.has(match[2].toLowerCase())) {
      rows.push(item);
      continue;
    }

    // "_all" keeps this synthetic key distinct from upstream's own
    // "mainnet_weekN_trading", which would otherwise collide with it.
    const mergedKey = `mainnet_week${match[1]}_trading_all`;
    const existing = mergedByWeek.get(mergedKey);
    if (existing) {
      existing.points += item.points;
      existing.share += item.share;
      continue;
    }

    // A fresh row — never mutate the caller's items.
    const row: CategoryBreakdownItem = {
      key: mergedKey,
      category: MAINNET_TRADING_LABEL,
      points: item.points,
      share: item.share,
    };
    mergedByWeek.set(mergedKey, row);
    rows.push(row);
  }

  return rows;
}

export const OVERVIEW_GROUP = "overview";

/**
 * The four sources every Aura overview is grouped into, summed across every
 * week — the homepage ring and the /aura Overview (market and wallet) read
 * the same buckets, so their figures agree:
 *   - Pre-Deposits: pre-deposit weeks and their referral bonuses.
 *   - Mainnet Trading: everything earned on mainnet except the protocol
 *     pool — trading, maker rebates, trading referrals, boosts.
 *   - BulkSOL: every protocol reward from any week, pre-deposit or mainnet,
 *     and the Exponent corrections to them.
 *   - Retro: every retro category, retro protocol staking included.
 * Anything unrecognised lands in "other" rather than being guessed at.
 */
export type AuraSourceKey = "pre-deposits" | "mainnet-trading" | "bulksol" | "retro" | "other";

export const AURA_SOURCE_LABELS: Record<AuraSourceKey, string> = {
  "pre-deposits": "Pre-Deposits",
  "mainnet-trading": "Mainnet Trading",
  bulksol: "BulkSOL",
  retro: "Retro",
  other: "Other",
};

export function auraSourceKey(key: string): AuraSourceKey {
  if (key.startsWith("retro_")) return "retro";
  if (/^mainnet_week\d+_protocol(?:_.+)?$/.test(key)) return "bulksol";
  if (MAINNET_WEEK_RE.test(key)) return "mainnet-trading";
  if (/^(?:predeposit_)?(?:referral_)?week\d+$/.test(key)) return "pre-deposits";
  if (/^week\d+_(?:protocol_.+|.*exponent.*correction)$/.test(key)) return "bulksol";
  return "other";
}

/** Overview by source (see auraSourceKey), largest first, "other" last. */
export function aggregateBySource(data: CategoryBreakdownItem[]): CategoryBreakdownItem[] {
  const buckets = new Map<AuraSourceKey, number>();
  let totalPoints = 0;

  for (const item of data) {
    totalPoints += item.points;
    const bucketKey = auraSourceKey(item.key);
    buckets.set(bucketKey, (buckets.get(bucketKey) ?? 0) + item.points);
  }

  return [...buckets.entries()]
    .map(([key, points]) => ({
      key,
      category: AURA_SOURCE_LABELS[key],
      points,
      share: totalPoints > 0 ? (points / totalPoints) * 100 : 0,
    }))
    .sort((a, b) => Number(a.key === "other") - Number(b.key === "other") || b.points - a.points);
}

export function filterCategoryBreakdown(
  data: CategoryBreakdownItem[],
  selectedGroup: string
): CategoryBreakdownItem[] {
  if (selectedGroup === OVERVIEW_GROUP) {
    return aggregateBySource(data);
  }

  if (selectedGroup === "retro") {
    return data
      .filter((item) => parseAuraCategoryKey(item.key).group === "retro")
      .sort((a, b) => b.points - a.points);
  }

  if (selectedGroup === "other") {
    return data
      .filter((item) => parseAuraCategoryKey(item.key).group === "other")
      .sort((a, b) => b.points - a.points);
  }

  const weekMatch = selectedGroup.match(/^week-(\d+)$/);
  if (weekMatch) {
    const week = Number(weekMatch[1]);
    const items = data.filter((item) => {
      const parsed = parseAuraCategoryKey(item.key);
      return parsed.group === "week" && parsed.week === week;
    });
    return mergeMainnetTrading(items).sort((a, b) => b.points - a.points);
  }

  return [...data].sort((a, b) => b.points - a.points);
}

export function buildCategoryGroupOptions(data: CategoryBreakdownItem[]) {
  const weeks = new Set<number>();
  let hasRetro = false;
  let hasOther = false;

  for (const item of data) {
    const parsed = parseAuraCategoryKey(item.key);
    if (parsed.group === "retro") hasRetro = true;
    if (parsed.group === "week" && parsed.week != null) weeks.add(parsed.week);
    if (parsed.group === "other") hasOther = true;
  }

  const options: { value: string; label: string }[] = [
    { value: OVERVIEW_GROUP, label: "Overview" },
  ];

  if (hasRetro) {
    options.push({ value: "retro", label: "Retro" });
  }

  for (const week of [...weeks].sort((a, b) => a - b)) {
    options.push({ value: `week-${week}`, label: `Week ${week}` });
  }

  if (hasOther) {
    options.push({ value: "other", label: "Other" });
  }

  return options;
}
