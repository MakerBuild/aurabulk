import fs from "fs";
import path from "path";
import type { LeaderboardEntry } from "@/types";
import { fetchAccountSnapshot } from "@/lib/bulk-exchange";

const VOLUME_FILE = path.join(process.cwd(), "data", "volume-leaderboard.json");

export type VolumeRow = {
  wallet: string;
  volumeUsd: number;
  balanceUsd?: number;
  pnlUsd?: number;
  feesUsd?: number;
  /** Highest PnL seen across our own samples. Upstream reports only the
   *  current figure, so this can only run from when we started recording. */
  peakPnlUsd?: number;
  updatedAt: string;
};

export type VolumeLeaderboardFile = {
  updatedAt: string;
  cursor: number;
  windowDays: number;
  rows: VolumeRow[];
};

const EMPTY: VolumeLeaderboardFile = {
  updatedAt: new Date(0).toISOString(),
  cursor: 0,
  windowDays: 14,
  rows: [],
};

function hasExchangeActivity(row: VolumeRow): boolean {
  return (
    row.volumeUsd > 0 ||
    (row.balanceUsd ?? 0) > 0 ||
    (row.pnlUsd ?? 0) !== 0
  );
}

export function readVolumeLeaderboardFile(): VolumeLeaderboardFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(VOLUME_FILE, "utf-8")) as Partial<VolumeLeaderboardFile>;
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : EMPTY.updatedAt,
      cursor: Number(parsed.cursor) || 0,
      windowDays: Number(parsed.windowDays) || 14,
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    };
  } catch {
    return { ...EMPTY, rows: [] };
  }
}

export function writeVolumeLeaderboardFile(
  next: Omit<VolumeLeaderboardFile, "updatedAt">,
): VolumeLeaderboardFile {
  const payload: VolumeLeaderboardFile = {
    updatedAt: new Date().toISOString(),
    cursor: next.cursor,
    windowDays: next.windowDays,
    rows: next.rows.filter(hasExchangeActivity).sort((a, b) => b.volumeUsd - a.volumeUsd),
  };
  fs.mkdirSync(path.dirname(VOLUME_FILE), { recursive: true });
  fs.writeFileSync(VOLUME_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function attachExchangeStats(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const byWallet = new Map(readVolumeLeaderboardFile().rows.map((row) => [row.wallet, row]));
  return entries.map((entry) => {
    const row = byWallet.get(entry.wallet);
    if (!row) return entry;
    return {
      ...entry,
      volume_usd: row.volumeUsd,
      balance_usd: row.balanceUsd,
      pnl_usd: row.pnlUsd,
    };
  });
}

/** Four in flight with a breath between rounds measures at about 6.5 requests
 *  a second, which the exchange serves without a single 429; eight flat out
 *  had two thirds of them throttled. */
const SAMPLE_CONCURRENCY = 4;
const SAMPLE_PAUSE_MS = 250;

export interface WalletExchangeStats {
  volumeUsd: number;
  windowDays: number;
  pnlUsd: number;
  peakPnlUsd: number | null;
  feesUsd: number | null;
  /** Place on the Volume ranking, or null when the wallet has no volume. */
  volumeRank: number | null;
  updatedAt: string;
}

/** What the wallet lookup shows for one wallet, rank included. */
export function getWalletExchangeStats(wallet: string): WalletExchangeStats | null {
  const file = readVolumeLeaderboardFile();
  const row = file.rows.find((entry) => entry.wallet === wallet);
  if (!row) return null;

  // Rows are stored sorted by volume, but only wallets with volume have a
  // meaningful place on that ranking.
  const ranked = file.rows.filter((entry) => entry.volumeUsd > 0);
  const index = ranked.findIndex((entry) => entry.wallet === wallet);

  return {
    volumeUsd: row.volumeUsd,
    windowDays: file.windowDays,
    pnlUsd: row.pnlUsd ?? 0,
    peakPnlUsd: row.peakPnlUsd ?? row.pnlUsd ?? null,
    feesUsd: row.feesUsd ?? null,
    volumeRank: index >= 0 ? index + 1 : null,
    updatedAt: row.updatedAt,
  };
}

export async function sampleWalletVolumes(
  wallets: string[],
  concurrency = SAMPLE_CONCURRENCY,
): Promise<VolumeRow[]> {
  const now = new Date().toISOString();
  const rows: VolumeRow[] = [];
  let noAnswer = 0;

  for (let offset = 0; offset < wallets.length; offset += concurrency) {
    const batch = wallets.slice(offset, offset + concurrency);
    const snapshots = await Promise.all(
      batch.map(async (wallet) => ({
        wallet,
        snapshot: await fetchAccountSnapshot(wallet),
      })),
    );
    if (offset + concurrency < wallets.length) {
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_PAUSE_MS));
    }
    for (const { wallet, snapshot } of snapshots) {
      if (!snapshot) {
        noAnswer += 1;
        continue;
      }
      const row: VolumeRow = {
        wallet,
        volumeUsd: snapshot.volumeUsd,
        balanceUsd: snapshot.balanceUsd,
        pnlUsd: snapshot.pnlUsd,
        feesUsd: snapshot.feesUsd,
        updatedAt: now,
      };
      if (!hasExchangeActivity(row)) continue;
      rows.push(row);
    }
  }

  // Loud on purpose: a silent shortfall here is indistinguishable from "these
  // wallets do not trade", which is exactly how stale rows went unnoticed.
  console.log(
    `[volume] asked=${wallets.length} withActivity=${rows.length} noAnswer=${noAnswer}`,
  );
  return rows;
}
