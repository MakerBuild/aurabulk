import { NextRequest, NextResponse } from "next/server";
import { getWalletData } from "@/lib/stats";
import { mergeFinancialRow } from "@/lib/leaderboard-financial-sync";
import { upstreamJson } from "@/lib/upstream";
import { getLeaderboardForApp } from "@/lib/live-leaderboard";
import { buildWalletData } from "@/lib/wallet-data";
import type { LeaderboardEntry, WalletData } from "@/types";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface UpstreamWallet {
  wallet: string;
  rank?: number;
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

  const entries = await getLeaderboardForApp({ waitMs: 5000 });
  const allAura = entries.map((e) => e.aura);
  const local = getWalletData(address);

  try {
    const remote = await upstreamJson<UpstreamWallet>(`/v1/aura/wallet/${address}`, {
      revalidate: 300,
    });

    if (remote) {
      if (local) {
        return NextResponse.json(withLiveFinancials(local, remote, allAura));
      }

      const entry: LeaderboardEntry = {
        wallet: remote.wallet,
        aura: remote.aura ?? 0,
        aura_rank: remote.rank ?? 0,
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
      const wallet = buildWalletData(entry, allAura);
      return NextResponse.json(wallet);
    }
  } catch {
    if (local) return NextResponse.json(local);
  }

  if (local) {
    return NextResponse.json(local);
  }

  return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
}
