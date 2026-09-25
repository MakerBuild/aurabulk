import { parseAuraCategoryKey } from "@/lib/aura-category-groups";
import { getCurrentCampaignWeek } from "@/lib/campaign-clock";

type AuraSource = "deposit" | "referral" | "other";

interface AuraSourceBreakdown {
  deposit: number;
  referral: number;
  other: number;
  total: number;
}

export interface WalletAuraBreakdown {
  /** Last completed campaign week (current − 1), or null during Week 1. */
  lastWeek: number | null;
  lastWeekAura: AuraSourceBreakdown;
  totalAura: AuraSourceBreakdown;
}

const DEPOSIT_RE = /^(?:predeposit_)?week(\d+)$/;
const REFERRAL_RE = /^(?:predeposit_)?referral_week(\d+)$/;

function classifyAuraSource(key: string): AuraSource {
  if (DEPOSIT_RE.test(key)) return "deposit";
  if (REFERRAL_RE.test(key)) return "referral";
  return "other";
}

/**
 * Which campaign week a category key belongs to, or null if it is not weekly.
 * Defers to the group parser so the wallet lookup, the global breakdown and
 * the Overview can never disagree about a key's week — its own patterns used
 * to miss mainnet keys entirely and to require "_protocol_" in the middle,
 * which dropped "weekN_exponent_correction" out of every week.
 */
export function extractCampaignWeek(key: string): number | null {
  const parsed = parseAuraCategoryKey(key);
  return parsed.group === "week" ? parsed.week ?? null : null;
}

function emptyBreakdown(): AuraSourceBreakdown {
  return { deposit: 0, referral: 0, other: 0, total: 0 };
}

function addPoints(breakdown: AuraSourceBreakdown, source: AuraSource, points: number) {
  breakdown[source] += points;
  breakdown.total += points;
}

/** Split wallet aura into deposit / referral / other for one week and lifetime totals. */
export function computeWalletAuraBreakdown(
  categories: Record<string, number> | undefined,
  reportedAura: number,
  nowMs: number = Date.now()
): WalletAuraBreakdown {
  const currentWeek = getCurrentCampaignWeek(nowMs);
  const lastWeek = currentWeek > 1 ? currentWeek - 1 : null;

  const lastWeekAura = emptyBreakdown();
  const totalAura = emptyBreakdown();

  for (const [key, val] of Object.entries(categories ?? {})) {
    const points = Number(val) || 0;
    if (points <= 0) continue;

    const source = classifyAuraSource(key);
    addPoints(totalAura, source, points);

    const week = extractCampaignWeek(key);
    if (lastWeek != null && week === lastWeek) {
      addPoints(lastWeekAura, source, points);
    }
  }

  const remainder = Math.max(0, reportedAura - totalAura.total);
  if (remainder > 0) {
    totalAura.other += remainder;
    totalAura.total = reportedAura;
  }

  return { lastWeek, lastWeekAura, totalAura };
}
