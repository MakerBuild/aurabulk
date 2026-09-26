import { aggregateBySource, type CategoryBreakdownItem } from "@/lib/aura-category-groups";
import { RANK_NAMES } from "@/lib/ranks";

function numFull(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export interface OverviewDonutSegment {
  id: string;
  label: string;
  color: string;
  pct: number;
  /** Raw Aura points behind this share, for the hover detail. */
  points: number;
}

export interface OverviewDistributionBar {
  id: string;
  label: string;
  count: number;
  pct: number;
}

/** One official trading rank in the Overview rank table. */
export interface DepositTier {
  id: string;
  label: string;
  count: number;
  /** Share of all depositors, 0-100. */
  pct: number;
  /** USD this tier's wallets still hold — deposits net of withdrawals. */
  held: number;
  /** Share of all held USD, 0-100. */
  heldPct: number;
  /** Held USD per wallet in the tier. */
  avgHeld: number;
  /** Aura this tier's wallets hold in total. */
  aura: number;
  /** Share of all Aura in these tiers, 0-100. */
  auraPct: number;
  /** Aura per wallet in the tier. */
  avgAura: number;
  /** Compact min–max Aura among wallets in the tier. */
  auraRange: string;
  color: string;
}

type DepositSizeBucket = {
  bucket: string;
  count: number;
  held: number;
  aura: number;
  auraMin: number;
  auraMax: number;
};

const EMPTY_BUCKET: DepositSizeBucket = {
  bucket: "",
  count: 0,
  held: 0,
  aura: 0,
  auraMin: 0,
  auraMax: 0,
};

/** 1234 → "1.2k", 19000 → "19k", 298424 → "298k". */
function compactAura(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return Math.round(value).toLocaleString("en-US");
}

/** The rank's actual trading-Aura span, e.g. "30-221"; one figure when the
 * rank holds a single value, a dash when it is empty. */
function auraRangeLabel(bucket: DepositSizeBucket): string {
  if (!(bucket.count > 0)) return "—";
  const min = compactAura(bucket.auraMin);
  const max = compactAura(bucket.auraMax);
  return min === max ? max : `${min}-${max}`;
}

/**
 * Chart colours are shared by the Overview ring, Aura Sources breakdown and
 * Aura Distribution histogram, so a source that is gold on one chart is gold
 * on the others. They are CSS custom properties, not literals: SVG `fill` and
 * `stroke` resolve var() at paint time, so the same server-rendered payload
 * repaints when the theme flips without re-fetching or re-computing.
 *
 * Identity still works — callers compare against CHART_GOLD to decide which
 * mark is the primary one, and string equality holds across both themes.
 */

/** Overview / Aura ring duochrome: primary accent, then the supporting ramp.
 * Index 0 (usually the largest share) takes the accent; the rest step through
 * the ramp so proportions stay readable without a rainbow. */
export const CHART_GOLD = "var(--t-accent)";
/** Ordered prominent→recessive for sequential charts (Aura histogram buckets).
 * Unlike chartPrimaryRamp this never injects the accent mid-series. Each theme
 * defines these seven stops by interpolating its own pair of support tones,
 * walked so index 0 is always the most prominent against that background. */
const SUPPORT_RAMP = [
  "var(--t-ramp-0)",
  "var(--t-ramp-1)",
  "var(--t-ramp-2)",
  "var(--t-ramp-3)",
  "var(--t-ramp-4)",
  "var(--t-ramp-5)",
  "var(--t-ramp-6)",
] as const;

export function chartSlateRamp(index: number, count: number): string {
  if (count <= 1) return SUPPORT_RAMP[0];
  const t = Math.min(1, Math.max(0, index / (count - 1)));
  const i = Math.round(t * (SUPPORT_RAMP.length - 1));
  return SUPPORT_RAMP[i];
}

/** Gold on the primary (index 0), then bright→dull slate for the rest.
 * Idle gold lives on the first mark; hover transfers it (caller borrows). */
export function chartPrimaryRamp(index: number, count: number): string {
  if (index <= 0) return CHART_GOLD;
  return chartSlateRamp(index - 1, Math.max(1, count - 1));
}

/** Homepage ring stays at six named sources even though the palette now
 * has room for drill-downs. More than that and the legend crowds the tier
 * table it has to line up with. */
const MAX_OVERVIEW_DONUT_SLICES = 6;

/** The homepage ring uses the shared source buckets (see auraSourceKey) under
 * its own shorter names. */
const HOMEPAGE_SOURCE_LABELS: Partial<Record<string, string>> = {
  "mainnet-trading": "Trading",
  other: "Others",
};

function overviewSources(items: CategoryBreakdownItem[]): CategoryBreakdownItem[] {
  return aggregateBySource(items)
    .filter((source) => source.points > 0)
    .map((source) => ({
      ...source,
      category: HOMEPAGE_SOURCE_LABELS[source.key] ?? source.category,
    }));
}

/**
 * The campaign's total distributable AURA supply — fixed, not the "earned
 * so far" figure shown elsewhere on the page (that one only grows over the
 * campaign and would make the modelled price drift for the wrong reason).
 */
export const APR_TOTAL_AURA_SUPPLY = 60_000_000;

export interface OverviewPanelsData {
  auraSources: {
    totalAuraValue: string;
    totalAuraNumber: number;
    donut: OverviewDonutSegment[];
  };
  depositorsAnalysis: {
    /** Wallets the tiers describe: every Aura holder, depositor or not. */
    totalWallets: number;
    bars: OverviewDistributionBar[];
    /** Every Aura holder by official trading rank, Unranked first. */
    tiers: DepositTier[];
  };
}

export function buildOverviewPanels(input: {
  totalAura: number;
  depositSizeDistribution: DepositSizeBucket[];
  rankDistribution: DepositSizeBucket[];
  categoryBreakdown: CategoryBreakdownItem[];
}): OverviewPanelsData {
  const {
    totalAura,
    depositSizeDistribution,
    rankDistribution,
    categoryBreakdown,
  } = input;

  // Largest share first, so colours are assigned the same way everywhere —
  // the biggest source always takes the accent gold.
  const sources = overviewSources(categoryBreakdown)
    .sort((a, b) => b.share - a.share)
    .slice(0, MAX_OVERVIEW_DONUT_SLICES);

  const auraSources = {
    totalAuraValue: numFull(totalAura),
    totalAuraNumber: totalAura,
    donut: sources.map((source, i) => ({
      id: source.key,
      label: source.category,
      color: chartPrimaryRamp(i, sources.length),
      pct: source.share,
      points: source.points,
    })),
  };

  // Optional access, not an assertion: a metrics file written before this
  // field existed would otherwise take the whole Overview down with it.
  const at = (i: number) => rankDistribution?.[i] ?? EMPTY_BUCKET;
  const tierDefs = RANK_NAMES.map((name, i) => {
    const bucket = at(i);
    return {
      id: name.toLowerCase(),
      label: name,
      ...bucket,
      rangeLabel: auraRangeLabel(bucket),
      color: chartPrimaryRamp(i, RANK_NAMES.length),
    };
  });

  // Both shares are taken against the tiers' own totals rather than against
  // the wallet count the rest of the page quotes: the tiers are cut from the
  // leaderboard and now span every Aura holder, while `depositWallets` counts
  // depositors from the live totals endpoint — a different population
  // entirely. A share is only meaningful against a base its own parts add up
  // to.
  //
  // The held total no longer approaches TVL: wallets with Aura and no deposit
  // sit in these tiers and hold nothing, so it covers only the depositors
  // among them.
  const tierCountTotal = tierDefs.reduce((sum, t) => sum + t.count, 0);
  const tierHeldTotal = tierDefs.reduce((sum, t) => sum + t.held, 0);
  const tierAuraTotal = tierDefs.reduce((sum, t) => sum + t.aura, 0);
  const tierBase = tierCountTotal > 0 ? tierCountTotal : 1;
  const heldBase = tierHeldTotal > 0 ? tierHeldTotal : 1;
  const auraBase = tierAuraTotal > 0 ? tierAuraTotal : 1;
  const tiers: DepositTier[] = tierDefs.map((t) => ({
    ...t,
    pct: (t.count / tierBase) * 100,
    heldPct: (t.held / heldBase) * 100,
    avgHeld: t.count > 0 ? t.held / t.count : 0,
    auraPct: (t.aura / auraBase) * 100,
    avgAura: t.count > 0 ? t.aura / t.count : 0,
    auraRange: t.rangeLabel,
  }));

  // Same rule for the deposit-size bars and the OG share: both are cut from
  // the leaderboard's depositors, so that count is their base — not the live
  // totals endpoint's wallet count, which is a different population.
  const depositorCount = depositSizeDistribution.reduce((sum, b) => sum + b.count, 0);
  const depositorBase = depositorCount > 0 ? depositorCount : 1;

  const depositorsAnalysis = {
    // The population the tiers actually describe — see the note on tierBase.
    totalWallets: tierCountTotal,
    bars: depositSizeDistribution.map((b) => ({
      id: b.bucket,
      label: b.bucket,
      count: b.count,
      pct: (b.count / depositorBase) * 100,
    })),
    tiers,
  };

  return { auraSources, depositorsAnalysis };
}
