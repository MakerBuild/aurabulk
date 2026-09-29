import { NextRequest, NextResponse } from "next/server";
import { getWalletData } from "@/lib/stats";
import { mergeFinancialRow } from "@/lib/leaderboard-financial-sync";
import { upstreamJson } from "@/lib/upstream";
import { getLeaderboardForApp } from "@/lib/live-leaderboard";
import { toRankName } from "@/lib/ranks";
import { buildWalletData } from "@/lib/wallet-data";
import type { LeaderboardEntry, WalletData } from "@/types";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface UpstreamWallet {
  wallet: string;
  /** Rank by Aura. Upstream's plain `rank` is the pre-deposit rank by hold
   * time, which is neither this nor our deposit_rank (by current amount). */
  aura_rank?: number;
  referrals_sent?: number;
  referrals_qualified?: number;
  referrals_rewarded?: number;
  deposited_amount?: number;
  withdrawn_amount?: number;
  current_amount?: number;
  total_held_time_seconds?: number;
  total_held_time_hours?: number;
  aura?: number;
  categories?: Record<string, number>;
  updated_at?: string;
  trading_league?: { qualified?: boolean; league?: { name?: string } | null } | null;
}

/** The live trading rank when upstream sent one, over the last recorded one. */
function withLiveRank(wallet: WalletData, remote: UpstreamWallet): WalletData {
  const league = remote.trading_league;
  if (!league) return wallet;
  return { ...wallet, rank: league.qualified ? toRankName(league.league?.name) : "Unranked" };
}

/** Upstream value when it sent one (a real 0 included), else the stored one. */
function orStored(value: number | undefined, stored: number): number {
  if (value == null) return stored;
  const n = Number(value);
  return Number.isFinite(n) ? n : stored;
}

function withLiveFinancials(
  entry: LeaderboardEntry,
  remote: UpstreamWallet,
  allAura: number[]
): WalletData {
  const merged = mergeFinancialRow(entry, {
    wallet: remote.wallet,
    deposited_amount: orStored(remote.deposited_amount, entry.deposited_amount),
    withdrawn_amount: orStored(remote.withdrawn_amount, entry.withdrawn_amount),
    current_amount: orStored(remote.current_amount, entry.current_amount),
    updated_at: remote.updated_at ?? entry.updated_at,
  });

  if (remote.total_held_time_hours != null) {
    merged.total_held_time_hours = Number(remote.total_held_time_hours) || 0;
  }
  if (remote.total_held_time_seconds != null) {
    merged.total_held_time_seconds = Number(remote.total_held_time_seconds) || 0;
  }
  if (remote.aura != null) {
    merged.aura = Number(remote.aura) || 0;
  }
  if (remote.categories) {
    merged.categories = remote.categories;
  }

  return buildWalletData(merged, allAura);
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json({ error: "Address required" }, { status: 400 });
  }
  if (!SOLANA_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid wallet address format" }, { status: 400 });
  }

  // Only for the percentile, which the recorded board (or one already held in
  // memory) answers as well as a fresh one: Aura moves weekly. Waiting on a
  // live pull here meant every cold or stale instance fetched the whole board
  // (~26 upstream pages, ~52k rows) before answering one wallet, which took
  // seconds and most of the lookup's CPU.
  const entries = await getLeaderboardForApp({ waitMs: 0 });
  const allAura = entries.map((e) => e.aura);
  const local = getWalletData(address);

  try {
    const remote = await upstreamJson<UpstreamWallet>(`/v1/aura/wallet/${address}`, {
      revalidate: 300,
    });

    if (remote) {
      if (local) {
        return NextResponse.json(withLiveRank(withLiveFinancials(local, remote, allAura), remote));
      }

      const entry: LeaderboardEntry = {
        wallet: remote.wallet,
        aura: remote.aura ?? 0,
        aura_rank: remote.aura_rank ?? 0,
        deposit_rank: 0,
        deposited_amount: remote.deposited_amount ?? 0,
        withdrawn_amount: remote.withdrawn_amount ?? 0,
        current_amount: remote.current_amount ?? 0,
        referrals_sent: remote.referrals_sent ?? 0,
        referrals_qualified: remote.referrals_qualified ?? 0,
        referrals_rewarded: remote.referrals_rewarded ?? 0,
        categories: remote.categories ?? {},
        total_held_time_seconds: remote.total_held_time_seconds ?? 0,
        total_held_time_hours: remote.total_held_time_hours ?? 0,
        updated_at: remote.updated_at,
      };
      return NextResponse.json(withLiveRank(buildWalletData(entry, allAura), remote));
    }
  } catch {
    if (local) return NextResponse.json(local);
  }

  if (local) {
    return NextResponse.json(local);
  }

  return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
}
