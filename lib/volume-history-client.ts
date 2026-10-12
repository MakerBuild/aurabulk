import type { VolumeHistoryPayload } from "@/lib/volume-history";

/**
 * /api/volume-history on the client, shared by the Total Volume chart and
 * the volume KPI card. One request per query at a time, and the last answer
 * kept for the page's lifetime, so a range seen once (or prefetched) draws
 * straight away instead of going back to "Loading volume…" on every switch.
 * Past `FRESH_MS` a load refetches and the caller gets the new payload.
 */
const FRESH_MS = 60_000;

interface Entry {
  at: number;
  payload?: VolumeHistoryPayload;
  pending?: Promise<VolumeHistoryPayload>;
}

const entries = new Map<string, Entry>();

/** The last payload for `query`, however old, or undefined if none yet. */
export function peekVolume(query: string): VolumeHistoryPayload | undefined {
  return entries.get(query)?.payload;
}

export function loadVolume(query: string): Promise<VolumeHistoryPayload> {
  const entry = entries.get(query) ?? { at: 0 };
  if (entry.payload && Date.now() - entry.at < FRESH_MS) return Promise.resolve(entry.payload);
  if (entry.pending) return entry.pending;

  const pending = fetch(`/api/volume-history?${query}`)
    .then((res) => {
      if (!res.ok) throw new Error(`volume-history ${res.status}`);
      return res.json() as Promise<VolumeHistoryPayload>;
    })
    .then((payload) => {
      entries.set(query, { at: Date.now(), payload });
      return payload;
    })
    .finally(() => {
      const current = entries.get(query);
      if (current?.pending === pending) current.pending = undefined;
    });
  entries.set(query, { ...entry, pending });
  return pending;
}
