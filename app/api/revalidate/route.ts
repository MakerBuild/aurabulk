import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Drop every cached page so the next visit renders from the data on disk.
 *
 * The pages are static with an hourly revalidate, so a data job that rewrites
 * data/ was invisible for up to an hour after it finished. deploy/jobs.sh
 * calls this right after each refresh.
 *
 * The server listens on 127.0.0.1 only and Caddy always adds
 * X-Forwarded-For, so a request without it came from the machine itself.
 */
export async function POST(request: NextRequest) {
  if (request.headers.has("x-forwarded-for")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ revalidated: true });
}
