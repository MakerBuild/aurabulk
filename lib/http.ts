/**
 * Fetch with a per-attempt timeout and bounded retries — shared by the
 * server-side upstream helpers and the offline data scripts, so every caller
 * gets the same backoff rules and none of them can hang on a dead socket.
 */
export const USER_AGENT = "AURA-Intelligence/1.0";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry-After in ms (delta-seconds or HTTP date), or null when absent/unparseable. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

export interface RetryOptions {
  /** Retries after the first attempt. */
  maxRetries?: number;
  /** Abort each attempt after this long. */
  timeoutMs?: number;
  baseBackoffMs?: number;
  /** Ceiling for any single wait, Retry-After included. */
  maxBackoffMs?: number;
  onRetry?: (attempt: number, waitMs: number, reason: string) => void;
}

/**
 * Retries network errors, timeouts, 429 and 5xx with exponential backoff
 * (Retry-After honoured up to `maxBackoffMs`). Any other response — or the
 * last one once retries run out — is returned as is; a network error that
 * outlives the retries is rethrown.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const {
    maxRetries = 4,
    timeoutMs = 10_000,
    baseBackoffMs = 1000,
    maxBackoffMs = 10_000,
    onRetry,
  } = options;

  for (let attempt = 0; ; attempt += 1) {
    const backoff = Math.min(baseBackoffMs * 2 ** attempt, maxBackoffMs);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      onRetry?.(attempt + 1, backoff, err instanceof Error ? err.name : "network error");
      await sleep(backoff);
      continue;
    }

    if ((res.status !== 429 && res.status < 500) || attempt >= maxRetries) {
      return res;
    }

    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    const wait = Math.min(retryAfter ?? backoff, maxBackoffMs) + Math.floor(Math.random() * 250);
    onRetry?.(attempt + 1, wait, `HTTP ${res.status}`);
    await sleep(wait);
  }
}
