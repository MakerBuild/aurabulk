import type { LeaderboardEntry } from "@/types";

export const LEADERBOARD_TOP_LIMIT = 100;

export type LeaderboardTab = "aura" | "volume" | "pnl";
export type LeaderboardSortDir = "asc" | "desc";

export const LEADERBOARD_TAB_DEFAULT_SORT: Record<
  LeaderboardTab,
  { key: string; dir: LeaderboardSortDir }
> = {
  aura: { key: "aura", dir: "desc" },
  volume: { key: "volume", dir: "desc" },
  pnl: { key: "pnl", dir: "desc" },
};

/** Every key getLeaderboardSortValue understands. */
const LEADERBOARD_SORT_KEYS = new Set(["aura_rank", "wallet", "aura", "volume", "pnl"]);

export function isLeaderboardSortKey(key: string): boolean {
  return LEADERBOARD_SORT_KEYS.has(key);
}

function getLeaderboardPool(
  entries: LeaderboardEntry[],
  tab: LeaderboardTab
): LeaderboardEntry[] {
  if (tab === "volume") {
    return entries.filter((entry) => (entry.volume_usd ?? 0) > 0);
  }
  if (tab === "pnl") {
    return entries.filter((entry) => entry.pnl_usd != null && entry.pnl_usd !== 0);
  }
  return entries;
}

function getLeaderboardSortValue(
  entry: LeaderboardEntry,
  tab: LeaderboardTab,
  sortKey: string
): number | string {
  switch (sortKey) {
    case "aura_rank":
      return entry.aura_rank;
    case "wallet":
      return entry.wallet;
    case "aura":
      return entry.aura;
    case "volume":
      return entry.volume_usd ?? 0;
    case "pnl":
      return entry.pnl_usd ?? 0;
    default:
      return getLeaderboardSortValue(
        entry,
        tab,
        LEADERBOARD_TAB_DEFAULT_SORT[tab].key
      );
  }
}

export function sortLeaderboardEntries(
  entries: LeaderboardEntry[],
  tab: LeaderboardTab,
  sortKey: string,
  sortDir: LeaderboardSortDir
): LeaderboardEntry[] {
  const copy = [...entries];

  copy.sort((a, b) => {
    const aVal = getLeaderboardSortValue(a, tab, sortKey);
    const bVal = getLeaderboardSortValue(b, tab, sortKey);

    if (typeof aVal === "string" && typeof bVal === "string") {
      const cmp = aVal.localeCompare(bVal);
      return sortDir === "desc" ? -cmp : cmp;
    }

    const diff = Number(aVal) - Number(bVal);
    return sortDir === "desc" ? -diff : diff;
  });

  return copy;
}

export function getLeaderboardTop(
  entries: LeaderboardEntry[],
  tab: LeaderboardTab,
  sortKey?: string,
  sortDir?: LeaderboardSortDir,
  limit = LEADERBOARD_TOP_LIMIT
): LeaderboardEntry[] {
  const defaults = LEADERBOARD_TAB_DEFAULT_SORT[tab];
  const key = sortKey ?? defaults.key;
  const dir = sortDir ?? defaults.dir;
  const pool = getLeaderboardPool(entries, tab);
  const sorted = sortLeaderboardEntries(pool, tab, key, dir);
  return sorted.slice(0, limit);
}
