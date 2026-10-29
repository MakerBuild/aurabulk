import { NextResponse } from "next/server";
import { challengerWeekStart } from "@/lib/challenger-series";
import { buildWeeklyRevenue, type WeeklyRevenuePayload } from "@/lib/weekly-revenue";

/** Dynamic: the figure is the exchange's running fee total, kept in memory
 *  for a few seconds below rather than built on every request. */
export const dynamic = "force-dynamic";

/** How long a built payload is served as is. Cloudflare passes /api through
 *  uncached, so without this every visit waited on the exchange and the
 *  candles (~0.4s) before the Challenger cards could draw. The page counts
 *  on from `at` with the pace, so a payload this old still reads live. */
const FRESH_MS = 15_000;
/** Past fresh, still served at once while a new one is built behind it. */
const STALE_MS = 120_000;

let cached: { payload: WeeklyRevenuePayload; builtAt: number } | null = null;
let building: Promise<WeeklyRevenuePayload> | null = null;

/** One build at a time; every request waiting on it shares the result. */
function rebuild(): Promise<WeeklyRevenuePayload> {
  building ??= buildWeeklyRevenue()
    .then((payload) => {
      cached = { payload, builtAt: Date.now() };
      return payload;
    })
    .finally(() => {
      building = null;
    });
  return building;
}

export async function GET() {
  try {
    // A payload from before Saturday's 13:00 belongs to last week: none of it
    // is served once the new week opens.
    if (cached && cached.payload.weekStart !== challengerWeekStart(Date.now())) cached = null;
    const age = cached ? Date.now() - cached.builtAt : Infinity;
    let payload: WeeklyRevenuePayload;
    if (cached && age < FRESH_MS) {
      payload = cached.payload;
    } else if (cached && age < STALE_MS) {
      payload = cached.payload;
      void rebuild().catch(() => {});
    } else {
      payload = await rebuild();
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch {
    return NextResponse.json({ error: "Weekly revenue unavailable" }, { status: 503 });
  }
}
