import type { LeaderboardEntry } from "@/types";

interface LeaderboardUpstreamRow {
  rank?: number;
  wallet: string;
  referral_number?: number;
  deposited_amount?: number;
  withdrawn_amount?: number;
  current_amount?: number;
  total_held_time_seconds?: number;
  total_held_time_hours?: number;
  aura?: number;
  categories?: Record<string, number>;
  updated_at?: string;
}

export interface LeaderboardUpstreamPage {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  rows: LeaderboardUpstreamRow[];
}

export function normalizeUpstreamRow(row: LeaderboardUpstreamRow): LeaderboardEntry | null {
  if (!row.wallet) return null;

  const categories: Record<string, number> = {};
  for (const [key, val] of Object.entries(row.categories ?? {})) {
    categories[key] = Number(val) || 0;
  }

  return {
    wallet: row.wallet,
    aura: Number(row.aura) || 0,
    aura_rank: Number(row.rank) || 0,
    deposit_rank: 0,
    deposited_amount: Number(row.deposited_amount) || 0,
    withdrawn_amount: Number(row.withdrawn_amount) || 0,
    current_amount: Number(row.current_amount) || 0,
    referrals_sent: 0,
    referrals_qualified: 0,
    referrals_rewarded: 0,
    categories,
    total_held_time_seconds: Number(row.total_held_time_seconds) || 0,
    total_held_time_hours: Number(row.total_held_time_hours) || 0,
    referral_number: Number(row.referral_number) || 0,
    updated_at: row.updated_at,
  };
}

export function finalizeLeaderboardEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  entries.sort((a, b) => b.aura - a.aura);
  entries.forEach((entry, index) => {
    entry.aura_rank = index + 1;
  });

  const byDeposit = [...entries].sort((a, b) => b.current_amount - a.current_amount);
  byDeposit.forEach((entry, index) => {
    entry.deposit_rank = index + 1;
  });

  return entries;
}

export function mergeReferralFieldsFromDisk(
  live: LeaderboardEntry[],
  disk: LeaderboardEntry[],
): LeaderboardEntry[] {
  if (!disk.length) return live;
  const diskByWallet = new Map(disk.map((entry) => [entry.wallet, entry]));
  return live.map((entry) => {
    const previous = diskByWallet.get(entry.wallet);
    if (!previous) return entry;
    return {
      ...entry,
      referrals_sent: previous.referrals_sent,
      referrals_qualified: previous.referrals_qualified,
      referrals_rewarded: previous.referrals_rewarded,
      referees_total_deposited: previous.referees_total_deposited,
    };
  });
}

/** Fetch all leaderboard pages from upstream (parallel batches). */
export async function fetchAllLeaderboardPages(
  fetchPage: (
    page: number,
    pageSize: number,
    noTotal: boolean,
  ) => Promise<LeaderboardUpstreamPage>,
  options: {
    pageSize?: number;
    maxPages?: number;
    concurrency?: number;
    onProgress?: (page: number, totalPages: number, rowCount: number) => void;
  } = {},
): Promise<LeaderboardUpstreamRow[]> {
  const pageSize = options.pageSize ?? 2000;
  const maxPages = options.maxPages ?? Infinity;
  const concurrency = options.concurrency ?? 6;

  const first = await fetchPage(1, pageSize, false);
  const totalPages = Math.min(first.total_pages || 1, maxPages);
  const rows: LeaderboardUpstreamRow[] = [...first.rows];
  options.onProgress?.(1, totalPages, rows.length);

  const remainingPages = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);

  for (let offset = 0; offset < remainingPages.length; offset += concurrency) {
    const batch = remainingPages.slice(offset, offset + concurrency);
    const pages = await Promise.all(
      batch.map((page) => fetchPage(page, pageSize, true)),
    );

    for (const page of pages) {
      rows.push(...page.rows);
    }

    const lastPage = batch[batch.length - 1] ?? totalPages;
    options.onProgress?.(lastPage, totalPages, rows.length);
  }

  return rows;
}
