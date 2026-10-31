import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Drop every cached page so the next visit renders from the data on disk.
 *
 * The pages are static with an hourly revalidate, so a data job that rewrites
 * data/ was invisible for up to an hour after it finished. deploy/jobs.sh
 * calls this right after each refresh.
 *
 * The server listens on 127.0.0.1 only. Caddy sets X-Forwarded-For to the
 * visitor's address, replacing any the visitor sent; Next fills it with the
 * socket's address when it is missing. So a loopback address means the
 * request came from the machine itself. (Checking for the header alone
 * refused every call, Next's own included, until 2026-10-31.)
 */
export async function POST(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (forwardedFor && !LOOPBACK.has(forwardedFor)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ revalidated: true });
}
