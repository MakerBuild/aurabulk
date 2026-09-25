/**
 * Server-only helper for talking to the upstream BULK indexer.
 *
 * The browser never calls indexer.bulk.trade directly — it only ever hits our
 * own /api routes. This module centralizes the upstream base URL (so it can be
 * swapped via env), sets a controlled User-Agent, and adds timeout/retry. It is
 * used by the API routes and by the offline data scripts.
 */
import { USER_AGENT, fetchWithRetry, type RetryOptions } from "@/lib/http";

const DEFAULT_BASE = "https://indexer.bulk.trade";

export function getUpstreamBase(): string {
  return process.env.BULK_API_BASE?.replace(/\/$/, "") || DEFAULT_BASE;
}

interface UpstreamOptions extends RetryOptions {
  revalidate?: number;
  /** Skip Next.js data cache entirely (for live polling). */
  noStore?: boolean;
}

export async function upstreamFetch(
  path: string,
  options: UpstreamOptions = {}
): Promise<Response> {
  const { revalidate = 300, noStore = false, ...retry } = options;
  const url = `${getUpstreamBase()}${path.startsWith("/") ? path : `/${path}`}`;

  return fetchWithRetry(
    url,
    {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      ...(noStore ? { cache: "no-store" as const } : { next: { revalidate } }),
    },
    retry,
  );
}

export async function upstreamJson<T>(path: string, options?: UpstreamOptions): Promise<T | null> {
  const res = await upstreamFetch(path, options);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Upstream ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}
