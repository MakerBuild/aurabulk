/**
 * Import pipeline — replaces data/leaderboard.json with a fresh export.
 *
 * Usage:
 *   npm run import -- <path-to-export.json>
 *   npm run import -- ./exports/bulk-export.json
 *
 * The export may be any of these shapes:
 *   - LeaderboardEntry[]                (canonical array)
 *   - { items:   LeaderboardEntry[] }
 *   - { data:    LeaderboardEntry[] }
 *   - { results: LeaderboardEntry[] }
 *
 * Field names are normalized, so raw BULK exports with alternate keys
 * (e.g. "address", "depositedAmount") are accepted. Ranks are recomputed
 * from the data and a snapshot is appended to data/snapshots.json.
 *
 * No network access — this reads a local file only.
 */
import fs from "fs";
import path from "path";
import { writeFileAtomic } from "../lib/atomic-write";
import { finalizeLeaderboardEntries } from "../lib/leaderboard-upstream";
import { appendSnapshot } from "../lib/snapshots";
import type { LeaderboardEntry } from "../types/index";

const DATA_DIR = path.join(process.cwd(), "data");
const LEADERBOARD_FILE = path.join(DATA_DIR, "leaderboard.json");

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pick<T>(obj: Record<string, unknown>, keys: string[], fallback: T): T {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key] as T;
    }
  }
  return fallback;
}

function normalizeEntry(raw: Record<string, unknown>): LeaderboardEntry {
  const wallet = String(
    pick(raw, ["wallet", "address", "wallet_address", "owner", "pubkey"], "")
  );

  const categoriesRaw = pick<Record<string, unknown>>(
    raw,
    ["categories", "aura_categories", "sources"],
    {}
  );
  const categories: Record<string, number> = {};
  for (const [key, val] of Object.entries(categoriesRaw ?? {})) {
    categories[key] = num(val);
  }

  return {
    wallet,
    aura: num(pick(raw, ["aura", "aura_points", "points", "total_aura"], 0)),
    aura_rank: num(pick(raw, ["aura_rank", "rank", "auraRank"], 0)),
    deposit_rank: num(pick(raw, ["deposit_rank", "depositRank"], 0)),
    deposited_amount: num(
      pick(raw, ["deposited_amount", "depositedAmount", "deposited", "total_deposited"], 0)
    ),
    withdrawn_amount: num(
      pick(raw, ["withdrawn_amount", "withdrawnAmount", "withdrawn", "total_withdrawn"], 0)
    ),
    current_amount: num(
      pick(raw, ["current_amount", "currentAmount", "current", "balance"], 0)
    ),
    referrals_sent: num(pick(raw, ["referrals_sent", "referralsSent"], 0)),
    referrals_qualified: num(pick(raw, ["referrals_qualified", "referralsQualified"], 0)),
    referrals_rewarded: num(pick(raw, ["referrals_rewarded", "referralsRewarded"], 0)),
    referees_total_deposited: num(
      pick(raw, ["referees_total_deposited", "refereesTotalDeposited"], 0)
    ),
    categories,
    first_seen: pick<string | undefined>(
      raw,
      ["first_seen", "firstSeen", "created_at", "createdAt"],
      undefined
    ),
    total_held_time_seconds: num(
      pick(raw, ["total_held_time_seconds", "totalHeldTimeSeconds"], 0)
    ),
    total_held_time_hours: num(
      pick(raw, ["total_held_time_hours", "totalHeldTimeHours"], 0)
    ),
    referral_number: num(pick(raw, ["referral_number", "referralNumber"], 0)),
    updated_at: pick<string | undefined>(raw, ["updated_at", "updatedAt"], undefined),
  };
}

function extractArray(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["rows", "items", "data", "results", "leaderboard", "entries"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  throw new Error(
    "Could not find an array of entries in the export. Expected an array or { items: [...] }."
  );
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npm run import -- <path-to-export.json>");
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Export file not found: ${resolved}`);
    process.exit(1);
  }

  console.log(`Importing leaderboard from ${resolved} ...`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  } catch (err) {
    console.error("Failed to parse export as JSON:", err);
    process.exit(1);
  }

  const rawEntries = extractArray(parsed);
  const entries = rawEntries.map(normalizeEntry).filter((e) => e.wallet.length > 0);

  if (entries.length === 0) {
    console.error("No valid entries found (every row was missing a wallet address).");
    process.exit(1);
  }

  const needsRanks = entries.some((e) => e.aura_rank === 0 || e.deposit_rank === 0);
  if (needsRanks) {
    console.log("Recomputing aura/deposit ranks from data...");
    finalizeLeaderboardEntries(entries);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(LEADERBOARD_FILE)) {
    const backup = path.join(DATA_DIR, `leaderboard.backup.json`);
    fs.copyFileSync(LEADERBOARD_FILE, backup);
    console.log(`Backed up previous leaderboard → ${path.basename(backup)}`);
  }

  writeFileAtomic(LEADERBOARD_FILE, JSON.stringify(entries, null, 2));

  const tvl = entries.reduce((s, e) => s + e.current_amount, 0);
  const totalAura = entries.reduce((s, e) => s + e.aura, 0);
  appendSnapshot({ tvl, totalAura, wallets: entries.length });

  console.log(`Imported ${entries.length.toLocaleString()} wallets`);
  console.log(`   TVL:        $${tvl.toLocaleString()}`);
  console.log(`   Total Aura: ${totalAura.toLocaleString()}`);
  console.log(`Wrote ${path.basename(LEADERBOARD_FILE)} and appended a snapshot.`);
}

main();
