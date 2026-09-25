import { buildCampaignClock, type CampaignClock } from "@/lib/campaign-clock";
import { getLeaderboard, getLeaderboardMtimeMs } from "@/lib/fetcher";
import { getLiveTotals } from "@/lib/live-totals";
import { computeProjectedSnapshotTvl, type ProjectedSnapshotTvl } from "@/lib/projected-snapshot-tvl";
import { getSnapshotsMtimeMs, readSnapshots } from "@/lib/snapshots";
import { getTotalsMtimeMs, readTotals } from "@/lib/totals";
import type { LeaderboardEntry, Totals } from "@/types";
import {
  computeTvlKpiSecondaryMetrics,
  type TvlKpiSecondaryMetrics,
} from "@/lib/tvl-kpi-secondary";

/** Shared by the live-financials route and in-process callers so every open
 * tab does not rebuild the 52k-row payload. */
export const LIVE_PAYLOAD_TTL_MS = 45_000;

export interface LiveFinancialPayload {
  currentTvl: number;
  totalDeposited: number;
  totalWithdrawn: number;
  depositWallets: number;
  totalAura: number;
  totalWallets: number;
  updatedAt: string;
  referenceTimeMs: number;
  projection: ProjectedSnapshotTvl;
  secondaryMetrics: TvlKpiSecondaryMetrics;
  campaign: CampaignClock;
}

function assembleLiveFinancialPayload(
  totals: Totals | null,
  entries: LeaderboardEntry[],
): LiveFinancialPayload {
  const snapshots = readSnapshots();

  const currentTvl =
    totals?.tvl ?? entries.reduce((sum, entry) => sum + entry.current_amount, 0);
  const totalDeposited =
    totals?.totalDeposited ?? entries.reduce((sum, entry) => sum + entry.deposited_amount, 0);
  const totalWithdrawn =
    totals?.totalWithdrawn ?? entries.reduce((sum, entry) => sum + entry.withdrawn_amount, 0);
  const depositWallets = totals?.totalWallets ?? entries.length;
  const totalAura = entries.reduce((sum, entry) => sum + entry.aura, 0);
  const totalWallets = totals?.leaderboardWallets ?? entries.length;
  const updatedAt =
    totals?.updatedAt ??
    (snapshots.length > 0
      ? snapshots[snapshots.length - 1].timestamp
      : new Date().toISOString());
  // Derived figures are measured as of the data's own timestamp.
  const referenceTimeMs = Date.parse(updatedAt) || Date.now();

  const projection = computeProjectedSnapshotTvl(snapshots, currentTvl, referenceTimeMs);
  const secondaryMetrics = computeTvlKpiSecondaryMetrics(
    snapshots,
    currentTvl,
    totalDeposited,
    totalWithdrawn,
    referenceTimeMs,
  );
  const campaign = buildCampaignClock(referenceTimeMs);

  return {
    currentTvl,
    totalDeposited,
    totalWithdrawn,
    depositWallets,
    totalAura,
    totalWallets,
    updatedAt,
    referenceTimeMs,
    projection,
    secondaryMetrics,
    campaign,
  };
}

/** Sync disk snapshot for the root layout — no upstream fetch, so tab
 * switches are not blocked on a dynamic layout. The client provider
 * refreshes from /api/live-financials after paint.
 *
 * Assembling this walks the full leaderboard (~52k rows) plus weekly Aura
 * pools. The root layout re-renders on every client navigation, so the
 * result is cached against the three source files' mtimes. */
let diskPayloadCache: { key: string; data: LiveFinancialPayload } | null = null;

export function buildLiveFinancialPayloadFromDisk(): LiveFinancialPayload {
  const key = `${getLeaderboardMtimeMs()}:${getTotalsMtimeMs()}:${getSnapshotsMtimeMs()}`;
  if (diskPayloadCache?.key !== key) {
    diskPayloadCache = { key, data: assembleLiveFinancialPayload(readTotals(), getLeaderboard()) };
  }
  const base = diskPayloadCache.data;
  const now = Date.now();
  return {
    ...base,
    referenceTimeMs: now,
    campaign: buildCampaignClock(now),
  };
}

let livePayloadCache: { at: number; data: LiveFinancialPayload } | null = null;

/**
 * Live KPI payload for the client poll. Totals come from the cheap
 * page_size=1 upstream (already cached 5 min). Leaderboard Aura / predict
 * stay on the disk snapshot — starting a full 26-page pull here is what
 * burned Fluid Active CPU. Result is reused for LIVE_PAYLOAD_TTL_MS.
 */
export async function buildLiveFinancialPayload(): Promise<LiveFinancialPayload> {
  const now = Date.now();
  if (livePayloadCache && now - livePayloadCache.at < LIVE_PAYLOAD_TTL_MS) {
    return livePayloadCache.data;
  }

  const totals = await getLiveTotals();
  const base = buildLiveFinancialPayloadFromDisk();

  if (!totals) {
    livePayloadCache = { at: now, data: base };
    return base;
  }

  const snapshots = readSnapshots();
  const referenceTimeMs = now;
  const data: LiveFinancialPayload = {
    ...base,
    currentTvl: totals.tvl,
    totalDeposited: totals.totalDeposited,
    totalWithdrawn: totals.totalWithdrawn,
    depositWallets: totals.totalWallets,
    totalWallets: totals.leaderboardWallets ?? base.totalWallets,
    updatedAt: totals.updatedAt,
    referenceTimeMs,
    projection: computeProjectedSnapshotTvl(snapshots, totals.tvl, referenceTimeMs),
    secondaryMetrics: computeTvlKpiSecondaryMetrics(
      snapshots,
      totals.tvl,
      totals.totalDeposited,
      totals.totalWithdrawn,
      referenceTimeMs,
    ),
    campaign: buildCampaignClock(referenceTimeMs),
  };

  livePayloadCache = { at: now, data };
  return data;
}
