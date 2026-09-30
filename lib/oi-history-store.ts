import fs from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/atomic-write";
import { fetchExchangeStats } from "@/lib/bulk-exchange";
import { getExchangeLevelHistory } from "@/lib/exchange-level-store";
import type { LevelPoint } from "@/lib/exchange-level-history";
import { mergeOiHistory } from "@/lib/oi-history";

const OI_HISTORY_FILE = path.join(process.cwd(), "data", "oi-history.json");

type OiHistoryFile = {
  updatedAt: string;
  oi: LevelPoint[];
};

export function readOiHistoryFile(): OiHistoryFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(OI_HISTORY_FILE, "utf-8")) as Partial<OiHistoryFile>;
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      oi: Array.isArray(parsed.oi) ? parsed.oi : [],
    };
  } catch {
    return { updatedAt: new Date(0).toISOString(), oi: [] };
  }
}

export function writeOiHistoryFile(oi: LevelPoint[]): OiHistoryFile {
  const payload: OiHistoryFile = {
    updatedAt: new Date().toISOString(),
    oi: mergeOiHistory(Date.now(), oi),
  };
  writeFileAtomic(OI_HISTORY_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function liveOiPoint(): Promise<LevelPoint[]> {
  try {
    const stats = await fetchExchangeStats(60);
    const value = Number(stats?.openInterest?.totalUsd) || 0;
    return value > 0 ? [{ t: Date.now(), value }] : [];
  } catch {
    return [];
  }
}

/**
 * Every OI vertex we know about, oldest first: the recorded file, this
 * server's own hourly samples since it last read the file, and the live print
 * so the line reaches the current bar.
 */
export async function loadOiPoints(): Promise<LevelPoint[]> {
  return mergeOiHistory(
    Date.now(),
    readOiHistoryFile().oi,
    getExchangeLevelHistory().oi,
    await liveOiPoint(),
  );
}
