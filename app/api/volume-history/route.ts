import { NextResponse } from "next/server";
import {
  VOLUME_RANGES,
  buildAllTimeHourly,
  buildVolumeHistory,
  type VolumeHistoryPayload,
  type VolumeRange,
} from "@/lib/volume-history";
import { oiForBuckets } from "@/lib/oi-history";
import { loadOiPoints } from "@/lib/oi-history-store";

export const revalidate = 60;

/** Copies the buckets rather than writing into them: they are the cached
 *  objects buildVolumeHistory hands every caller. */
async function withOpenInterest(payload: VolumeHistoryPayload): Promise<VolumeHistoryPayload> {
  const oi = oiForBuckets(
    payload.buckets.map((b) => b.t),
    await loadOiPoints(),
  );
  return { ...payload, buckets: payload.buckets.map((b, i) => ({ ...b, oi: oi[i] })) };
}

function isVolumeRange(value: string | null): value is VolumeRange {
  return VOLUME_RANGES.includes(value as VolumeRange);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rangeParam = url.searchParams.get("range");
  const range: VolumeRange = isVolumeRange(rangeParam) ? rangeParam : "1D";
  const hourlyAll = range === "ALL" && url.searchParams.get("interval") === "1h";

  try {
    const payload = hourlyAll
      ? await buildAllTimeHourly()
      : await withOpenInterest(await buildVolumeHistory(range));
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch {
    return NextResponse.json({ error: "Volume history unavailable" }, { status: 503 });
  }
}
