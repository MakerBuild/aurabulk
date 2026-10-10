"use client";

import { useSyncExternalStore } from "react";

/**
 * The first page load is held behind the boot splash until its first data is
 * in. Components hand their initial fetch to `holdBoot`; the splash lifts
 * once those settle (or a time cap passes), and entrance animations wait for
 * `useBootReady`. Without this the count-ups and sparks started on the
 * server's figures and restarted half a second later when the live ones
 * landed, which is most of what read as jerky.
 */
const pending = new Set<Promise<unknown>>();
const listeners = new Set<() => void>();
let ready = false;

/** Keep the splash up until `work` settles. A no-op once the page is shown. */
export function holdBoot<T>(work: Promise<T>): Promise<T> {
  if (!ready) {
    pending.add(work);
    const drop = () => pending.delete(work);
    work.then(drop, drop);
  }
  return work;
}

/** Resolves when everything held so far has settled or `capMs` passes. */
export function settleBoot(capMs: number): Promise<void> {
  return Promise.race([
    Promise.allSettled([...pending]).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, capMs)),
  ]);
}

export function releaseBoot(): void {
  if (ready) return;
  ready = true;
  pending.clear();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** False on the server and until the splash lifts, then true for good. */
export function useBootReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ready,
    () => false,
  );
}
