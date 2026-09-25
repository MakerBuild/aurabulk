import { getLeaderboard } from "@/lib/fetcher";
import {
  fetchAllLeaderboardPages,
  finalizeLeaderboardEntries,
  mergeReferralFieldsFromDisk,
  normalizeUpstreamRow,
  type LeaderboardUpstreamPage,
} from "@/lib/leaderboard-upstream";
import { upstreamFetch } from "@/lib/upstream";
import type { LeaderboardEntry } from "@/types";

const PAGE_SIZE = 2000;
const CACHE_MS = 900_000; // 15 min per warm serverless instance

let cache: { at: number; data: LeaderboardEntry[] } | null = null;
let inflight: Promise<LeaderboardEntry[]> | null = null;

async function fetchLeaderboardPage(
  page: number,
  pageSize: number,
  noTotal: boolean,
): Promise<LeaderboardUpstreamPage> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (noTotal) params.set("no_total", "true");

  const response = await upstreamFetch(
    `/v1/aura/predeposit/leaderboard?${params.toString()}`,
    { noStore: true },
  );
  if (!response.ok) {
    throw new Error(`Upstream leaderboard page ${page} failed: ${response.status}`);
  }
  return (await response.json()) as LeaderboardUpstreamPage;
}

async function pullLeaderboardFromUpstream(): Promise<LeaderboardEntry[]> {
  const rows = await fetchAllLeaderboardPages(fetchLeaderboardPage, {
    pageSize: PAGE_SIZE,
    concurrency: 6,
  });

  const entries = rows
    .map(normalizeUpstreamRow)
    .filter((entry): entry is LeaderboardEntry => entry !== null);

  finalizeLeaderboardEntries(entries);
  return mergeReferralFieldsFromDisk(entries, getLeaderboard());
}

function sleep(ms: number): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

function startRefresh(): Promise<LeaderboardEntry[]> {
  if (!inflight) {
    inflight = pullLeaderboardFromUpstream()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .catch((err) => {
        if (cache) return cache.data;
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

interface LeaderboardOptions {
  /** Max wait for upstream before falling back to disk (SSR-friendly). */
  waitMs?: number;
}

/** Live leaderboard from BULK API (15 min in-memory cache), disk fallback. */
export async function getLeaderboardForApp(
  options: LeaderboardOptions = {},
): Promise<LeaderboardEntry[]> {
  const disk = getLeaderboard();

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }

  // waitMs: 0 is for page SSR, tab switches, and live-financials. Starting
  // a no-store upstream pull here — even if we don't await it — opts the
  // route into dynamic rendering and burns Fluid CPU on a 26-page fetch.
  if (options.waitMs === 0) {
    return cache?.data ?? disk;
  }

  try {
    const refresh = startRefresh();

    if (options.waitMs != null) {
      const live = await Promise.race([refresh, sleep(options.waitMs)]);
      return live ?? disk;
    }

    return await refresh;
  } catch {
    return disk;
  }
}
