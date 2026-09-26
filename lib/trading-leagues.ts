import fs from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/atomic-write";
import type { RankName } from "@/lib/ranks";

/** One ranked wallet, as the trading leaderboard reported it. */
export interface TradingLeagueRow {
  wallet: string;
  rank: RankName;
  /** Position among qualified wallets, 1 = most trading Aura. */
  position: number | null;
  tradingAura: number;
}

/**
 * Every wallet's official trading rank, recorded by
 * scripts/record-trading-leagues.ts with the weekly refresh rather than
 * fetched per request.
 */
export interface TradingLeaguesFile {
  updatedAt: string;
  /** Qualified wallets the percentiles are taken over. */
  population: number;
  /** Lifetime volume (USD) a wallet needs to be ranked at all. */
  qualificationThreshold: number;
  /** Only ranked wallets; anyone missing is Unranked. */
  rows: TradingLeagueRow[];
}

const FILE = path.join(process.cwd(), "data", "trading-leagues.json");

const EMPTY: TradingLeaguesFile = {
  updatedAt: new Date(0).toISOString(),
  population: 0,
  qualificationThreshold: 0,
  rows: [],
};

let cache: { mtimeMs: number; data: TradingLeaguesFile } | null = null;

export function readTradingLeaguesFile(): TradingLeaguesFile {
  try {
    const mtimeMs = fs.statSync(FILE).mtimeMs;
    if (cache && cache.mtimeMs === mtimeMs) return cache.data;
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8")) as Partial<TradingLeaguesFile>;
    if (!parsed || !Array.isArray(parsed.rows)) return EMPTY;
    const data = { ...EMPTY, ...parsed, rows: parsed.rows };
    cache = { mtimeMs, data };
    return data;
  } catch {
    return EMPTY;
  }
}

export function writeTradingLeaguesFile(file: TradingLeaguesFile): void {
  writeFileAtomic(FILE, `${JSON.stringify(file)}\n`);
}

/** Each qualified wallet's rank, by address. */
export function tradingRankByWallet(file = readTradingLeaguesFile()): Map<string, RankName> {
  return new Map(file.rows.map((row) => [row.wallet, row.rank]));
}
