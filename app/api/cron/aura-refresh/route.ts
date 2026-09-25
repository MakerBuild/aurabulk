import type { NextRequest } from "next/server";

import { dispatchUnlessFresh } from "@/lib/cron-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The weekly job is a full leaderboard fetch with referral enrichment (~45 min), so
// only stand in for GitHub's own schedule when it has not already delivered today.
const FRESH_WINDOW_HOURS = 24;

/**
 * Vercel Cron backup — triggers the weekly Aura refresh via repository_dispatch, but
 * only when GitHub's own schedule failed to run it.
 */
export async function GET(req: NextRequest) {
  return dispatchUnlessFresh(req, "aura-refresh", "weekly-aura-refresh.yml", FRESH_WINDOW_HOURS);
}
