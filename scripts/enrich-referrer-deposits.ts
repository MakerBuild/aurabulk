/**
 * Enrich all wallets with referral_number > 0 in leaderboard.json
 * using the wallet API (offline one-shot, no full leaderboard refetch).
 */
import path from "path";
import { writeFileAtomic } from "../lib/atomic-write";
import { readLeaderboardFromDisk } from "../lib/fetcher";
import { sleep } from "../lib/http";
import { upstreamJson } from "../lib/upstream";

const LEADERBOARD_FILE = path.join(process.cwd(), "data", "leaderboard.json");

interface WalletProfile {
  referrals_sent?: number;
  referrals_qualified?: number;
  referrals_rewarded?: number;
  referees_total_deposited?: number;
}

async function fetchWalletProfile(wallet: string): Promise<WalletProfile | null> {
  try {
    return await upstreamJson<WalletProfile>(`/v1/aura/wallet/${wallet}`, { noStore: true });
  } catch {
    return null;
  }
}

async function main() {
  const entries = readLeaderboardFromDisk();
  const targets = entries.filter((e) => (e.referral_number ?? 0) > 0);

  console.log(`Enriching referral profiles for ${targets.length} wallets...`);

  let done = 0;
  for (const entry of targets) {
    const profile = await fetchWalletProfile(entry.wallet);
    if (profile) {
      entry.referrals_sent = Number(profile.referrals_sent) || 0;
      entry.referrals_qualified = Number(profile.referrals_qualified) || 0;
      entry.referrals_rewarded = Number(profile.referrals_rewarded) || 0;
      entry.referees_total_deposited = Number(profile.referees_total_deposited) || 0;
    }
    done += 1;
    if (done % 50 === 0 || done === targets.length) {
      console.log(`  enriched ${done}/${targets.length}`);
    }
    await sleep(80);
  }

  writeFileAtomic(LEADERBOARD_FILE, JSON.stringify(entries, null, 2));
  console.log("Updated leaderboard.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
