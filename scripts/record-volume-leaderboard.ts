/**
 * Sample exchange fullAccount snapshots (14d volume, equity, PnL).
 * Bulk has no ranking API — we walk Aura wallets and keep anyone with
 * volume, equity, or non-zero PnL.
 *
 *   npm run record:volume
 */
import { getLeaderboard } from "../lib/fetcher";
import {
  readVolumeLeaderboardFile,
  sampleWalletVolumes,
  writeVolumeLeaderboardFile,
} from "../lib/volume-leaderboard";

// The sweep is the only thing that reaches a wallet outside the fast lists, so
// its size sets how stale a quiet wallet's row can get: at 400 a wallet waited
// 141 runs, and with GitHub landing these every three to five hours that was
// about twenty days. 1200 brings a full pass to roughly a week.
const BATCH = Number.isFinite(Number(process.env.VOLUME_SCAN_BATCH))
  ? Number(process.env.VOLUME_SCAN_BATCH)
  : 1200;

// Mainnet trading pays Aura, so anyone trading real size climbs this ranking —
// sampling the top thousand every run keeps active traders current without
// waiting for the sweep. At 100 a wallet ranked 433 with $1.9M of volume sat
// at zero for a fortnight.
const TOP_AURA = 1000;

// Wallets already known to trade, refreshed every run regardless of rank.
const TOP_KNOWN = 200;

async function main() {
  const wallets = getLeaderboard().map((entry) => entry.wallet);
  if (!wallets.length) throw new Error("empty leaderboard");

  const prev = readVolumeLeaderboardFile();
  const known = prev.rows
    .filter((row) => row.volumeUsd > 0 || (row.pnlUsd ?? 0) !== 0)
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
    .slice(0, TOP_KNOWN)
    .map((row) => row.wallet);
  const topAura = wallets.slice(0, TOP_AURA);

  const start = ((prev.cursor % wallets.length) + wallets.length) % wallets.length;
  const scan: string[] = [];
  for (let i = 0; i < BATCH && i < wallets.length; i += 1) {
    scan.push(wallets[(start + i) % wallets.length]);
  }

  const sampled = await sampleWalletVolumes([...new Set([...topAura, ...known, ...scan])]);
  const byWallet = new Map(prev.rows.map((row) => [row.wallet, row]));
  for (const row of sampled) {
    // Upstream only ever reports the current PnL, so the high-water mark has
    // to be carried forward by us, sample to sample.
    const previous = byWallet.get(row.wallet);
    const seen = [previous?.peakPnlUsd, previous?.pnlUsd, row.pnlUsd].filter(
      (value): value is number => typeof value === "number",
    );
    byWallet.set(row.wallet, {
      ...row,
      peakPnlUsd: seen.length ? Math.max(...seen) : row.pnlUsd,
    });
  }

  const next = writeVolumeLeaderboardFile({
    cursor: (start + scan.length) % wallets.length,
    windowDays: 14,
    rows: [...byWallet.values()],
  });

  console.log(
    `[volume] rows=${next.rows.length} sampled=${sampled.length}` +
      ` scanned=${scan.length} topAura=${topAura.length} known=${known.length}` +
      ` cursor=${next.cursor} sweepRuns=${Math.ceil(wallets.length / BATCH)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
