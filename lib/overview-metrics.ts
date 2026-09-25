import { aggregateBySource, type CategoryBreakdownItem } from "@/lib/aura-category-groups";
import { AURA_TIER_NAMES, DEPOSITOR_AURA_RANGES } from "@/lib/utils";

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

/** One of the size tiers in the depositor cohort ring. */
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
    /** Six mutually exclusive Aura bands — what the ring and the stat list
     * both draw from directly. */
    tiers: DepositTier[];
  };
}

export function buildOverviewPanels(input: {
  totalAura: number;
  depositSizeDistribution: DepositSizeBucket[];
  auraDistribution: DepositSizeBucket[];
  categoryBreakdown: CategoryBreakdownItem[];
}): OverviewPanelsData {
  const {
    totalAura,
    depositSizeDistribution,
    auraDistribution,
    categoryBreakdown,
  } = input;

  // Keep the meaningful sources named and roll the long tail into "Others", so
  // the ring stays readable instead of fraying into 1% slivers.
  const MIN_DONUT_SHARE = 2.5;
  const allSources = aggregateBySource(categoryBreakdown).filter((s) => s.share > 0);
  // Leftover "other" joins the small-source tail so the ring never shows
  // both "Other" and "Others". Maker stays named however small: it is split
  // out of Mainnet precisely so it can be seen, and folding it into Others
  // would hide it again.
  const isNamed = (s: CategoryBreakdownItem) =>
    s.key !== "other" && (s.key === "maker" || s.share >= MIN_DONUT_SHARE);
  const named = allSources.filter(isNamed);
  const tail = allSources.filter((s) => !isNamed(s));
  const tailShare = tail.reduce((sum, s) => sum + s.share, 0);
  const tailPoints = tail.reduce((sum, s) => sum + s.points, 0);

  // Largest share first, so colours are assigned the same way everywhere —
  // the biggest source always takes the accent gold.
  const sources = [
    ...named.map((s) => ({ key: s.key, category: s.category, share: s.share, points: s.points })),
    ...(tailShare > 0
      ? [{ key: "others", category: "Others", share: tailShare, points: tailPoints }]
      : []),
  ]
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

  // The tiers keep their names but are cut by the Aura a wallet holds, over
  // every holder rather than only depositors. They were cut by deposit size
  // and labelled with an Aura band, which stopped being true once mainnet
  // trading started paying Aura to wallets that never deposited.
  // Optional access, not an assertion: a metrics file written before this
  // field existed would otherwise take the whole Overview down with it.
  const at = (i: number) => auraDistribution?.[i] ?? EMPTY_BUCKET;
  const auraTiers = AURA_TIER_NAMES.map((name, i) => ({
    id: name.replace(/\s+/g, "").toLowerCase(),
    label: `${name} (${DEPOSITOR_AURA_RANGES[i].label})`,
    bucket: at(i),
  }));
  const tierDefs = auraTiers.map((t, i) => ({
    id: t.id,
    label: t.label,
    ...t.bucket,
    rangeLabel: DEPOSITOR_AURA_RANGES[i].label.replace(/\s+AURA$/i, ""),
    color: chartPrimaryRamp(i, auraTiers.length),
  }));

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
