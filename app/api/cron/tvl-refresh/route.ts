import type { NextRequest } from "next/server";

import { dispatchUnlessFresh } from "@/lib/cron-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A daily job: skip when GitHub's own schedule has already run (or is running)
// it within most of a day.
const FRESH_WINDOW_HOURS = 18;

/** Vercel Cron backup — triggers the daily TVL GitHub Action via repository_dispatch,
 * but only when GitHub's own schedule has not delivered it. */
export async function GET(req: NextRequest) {
  return dispatchUnlessFresh(req, "tvl-refresh", "daily-tvl-refresh.yml", FRESH_WINDOW_HOURS);
}
