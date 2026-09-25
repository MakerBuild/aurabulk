import fs from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/atomic-write";
import type { Snapshot } from "@/types";

const SNAPSHOTS_FILE = path.join(process.cwd(), "data", "snapshots.json");

/** Retention for the daily TVL snapshots (roughly six years). */
const MAX_SNAPSHOTS = 2160;

let cache: { mtimeMs: number; data: Snapshot[] } | null = null;

export function getSnapshotsMtimeMs(): number {
  try {
    return fs.statSync(SNAPSHOTS_FILE).mtimeMs;
  } catch {
    return 0;
  }
}

/** Snapshots on disk; [] when the file is absent. Throws on a malformed file. */
export function readSnapshots(): Snapshot[] {
  if (!fs.existsSync(SNAPSHOTS_FILE)) return [];
  const mtimeMs = fs.statSync(SNAPSHOTS_FILE).mtimeMs;
  if (cache && cache.mtimeMs === mtimeMs) return cache.data;
  const data = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, "utf-8")) as Snapshot[];
  if (!Array.isArray(data)) throw new Error(`${SNAPSHOTS_FILE} is not an array`);
  cache = { mtimeMs, data };
  return data;
}

/**
 * Append one snapshot, stamped now, for the data scripts. An unreadable
 * history aborts the run instead of being replaced by a one-entry file.
 */
export function appendSnapshot(snapshot: Omit<Snapshot, "timestamp">): Snapshot[] {
  const snapshots = [
    ...readSnapshots(),
    { ...snapshot, timestamp: new Date().toISOString() },
  ].slice(-MAX_SNAPSHOTS);
  writeFileAtomic(SNAPSHOTS_FILE, JSON.stringify(snapshots, null, 2));
  cache = null;
  return snapshots;
}
