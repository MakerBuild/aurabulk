import { NextResponse } from "next/server";
import { buildWeeklyRevenue } from "@/lib/weekly-revenue";

/** Dynamic: the figure is the exchange's running fee total, read fresh (with
 *  a short fetch cache) on each request. The CDN header does the caching. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await buildWeeklyRevenue();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch {
    return NextResponse.json({ error: "Weekly revenue unavailable" }, { status: 503 });
  }
}
