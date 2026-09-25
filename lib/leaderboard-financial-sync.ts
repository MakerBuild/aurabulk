import type { LeaderboardEntry } from "@/types";

interface LeaderboardFinancialRow {
  wallet: string;
  deposited_amount: number;
  withdrawn_amount: number;
  current_amount: number;
  updated_at?: string;
}

export interface LeaderboardFinancialPage {
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  rows: Array<{
    wallet: string;
    deposited_amount?: number;
    withdrawn_amount?: number;
    current_amount?: number;
    updated_at?: string;
  }>;
}

function normalizeFinancialRow(
  row: LeaderboardFinancialPage["rows"][number]
): LeaderboardFinancialRow | null {
  if (!row.wallet) return null;
  return {
    wallet: row.wallet,
    deposited_amount: Number(row.deposited_amount) || 0,
    withdrawn_amount: Number(row.withdrawn_amount) || 0,
    current_amount: Number(row.current_amount) || 0,
    updated_at: row.updated_at,
  };
}

function financialRowsToMap(
  rows: LeaderboardFinancialRow[]
): Map<string, LeaderboardFinancialRow> {
  return new Map(rows.map((row) => [row.wallet, row]));
}

export function mergeFinancialRow(
  entry: LeaderboardEntry,
  live: LeaderboardFinancialRow | undefined
): LeaderboardEntry {
  if (!live) return entry;
  return {
    ...entry,
    deposited_amount: live.deposited_amount,
    withdrawn_amount: live.withdrawn_amount,
    current_amount: live.current_amount,
    updated_at: live.updated_at ?? entry.updated_at,
  };
}

export function mergeFinancialRowsIntoEntries(
  entries: LeaderboardEntry[],
  rows: LeaderboardFinancialRow[]
): LeaderboardEntry[] {
  const map = financialRowsToMap(rows);
  return entries.map((entry) => mergeFinancialRow(entry, map.get(entry.wallet)));
}

export function recomputeDepositRanks(entries: LeaderboardEntry[]): void {
  const sorted = [...entries].sort((a, b) => b.current_amount - a.current_amount);
  const rankByWallet = new Map(sorted.map((entry, index) => [entry.wallet, index + 1]));
  for (const entry of entries) {
    entry.deposit_rank = rankByWallet.get(entry.wallet) ?? entry.deposit_rank;
  }
}

export async function fetchAllLeaderboardFinancialRows(
  fetchPage: (page: number, pageSize: number, noTotal: boolean) => Promise<LeaderboardFinancialPage>,
  options: { pageSize?: number; pageDelayMs?: number; maxPages?: number } = {}
): Promise<LeaderboardFinancialRow[]> {
  const pageSize = options.pageSize ?? 2000;
  const pageDelayMs = options.pageDelayMs ?? 0;
  const maxPages = options.maxPages ?? Infinity;

  const first = await fetchPage(1, pageSize, false);
  const totalPages = Math.min(first.total_pages || 1, maxPages);
  const rows: LeaderboardFinancialRow[] = [];

  for (const row of first.rows) {
    const normalized = normalizeFinancialRow(row);
    if (normalized) rows.push(normalized);
  }

  for (let page = 2; page <= totalPages; page += 1) {
    if (pageDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
    }
    const data = await fetchPage(page, pageSize, true);
    for (const row of data.rows) {
      const normalized = normalizeFinancialRow(row);
      if (normalized) rows.push(normalized);
    }
    if (!data.has_next) break;
  }

  return rows;
}
