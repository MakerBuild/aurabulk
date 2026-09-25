import { NextResponse, type NextRequest } from "next/server";

const GITHUB_REPO = "MakerBuild/aurabulk";
const GITHUB_API = "https://api.github.com";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` — refuse anything else in production. */
function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

interface DispatchResult {
  ok: boolean;
  status: number;
  detail?: string;
}

/** Fire a repository_dispatch event so the matching GitHub Action picks the work up. */
async function dispatchRepositoryEvent(
  token: string,
  event: string,
): Promise<DispatchResult> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: event }),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 204) return { ok: true, status: res.status };
    return { ok: false, status: res.status, detail: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Creation timestamp of the newest run of `workflow` that succeeded or is still
 * queued / in progress, or null when there is none — and also when the lookup
 * itself fails, so a backup trigger errs towards firing rather than silently
 * skipping a refresh.
 */
async function lastLiveOrSuccessfulRunAt(
  token: string,
  workflow: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/actions/workflows/${workflow}/runs?per_page=10`,
      { headers: githubHeaders(token), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;

    const body = (await res.json()) as {
      workflow_runs?: { created_at?: string; status?: string; conclusion?: string | null }[];
    };
    const run = body.workflow_runs?.find(
      (r) => r.status !== "completed" || r.conclusion === "success",
    );
    return run?.created_at ?? null;
  } catch {
    return null;
  }
}

/**
 * Shared body of the Vercel Cron backups: dispatch `event` unless `workflow`
 * already has a successful or still-running run from the last `freshHours`.
 */
export async function dispatchUnlessFresh(
  req: NextRequest,
  event: string,
  workflow: string,
  freshHours: number,
): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_DISPATCH_TOKEN is not configured" },
      { status: 503 },
    );
  }

  const lastRun = await lastLiveOrSuccessfulRunAt(token, workflow);
  if (lastRun) {
    const ageHours = (Date.now() - new Date(lastRun).getTime()) / 3_600_000;
    if (ageHours < freshHours) {
      return NextResponse.json({ ok: true, skipped: "already refreshed", lastRun });
    }
  }

  const result = await dispatchRepositoryEvent(token, event);
  if (result.ok) {
    return NextResponse.json({ ok: true, event, lastRun });
  }

  return NextResponse.json(
    { error: "GitHub dispatch failed", status: result.status, detail: result.detail },
    { status: 502 },
  );
}
