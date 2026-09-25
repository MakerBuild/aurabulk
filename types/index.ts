import type { WalletExchangeStats } from "@/lib/volume-leaderboard";
import type { WalletAuraBreakdown } from "@/lib/wallet-aura-breakdown";

export interface LeaderboardEntry {
  wallet: string;
  aura: number;
  aura_rank: number;
  deposit_rank: number;
  deposited_amount: number;
  withdrawn_amount: number;
  current_amount: number;
  referrals_sent: number;
  referrals_qualified: number;
  referrals_rewarded: number;
  referees_total_deposited?: number;
  categories: Record<string, number>;
  first_seen?: string;
  total_held_time_seconds?: number;
  total_held_time_hours?: number;
  referral_number?: number;
  updated_at?: string;
  /** 14-day rolling trading volume from the exchange fee-tier quote. */
  volume_usd?: number;
  /** Live exchange account equity (fullAccount margin.totalMargin, else totalBalance). */
  balance_usd?: number;
  /** Realized + unrealized PnL from the exchange account snapshot. */
  pnl_usd?: number;
}

export interface WalletData extends LeaderboardEntry {
  percentile: number;
  hold_time_days: number;
  aura_breakdown: WalletAuraBreakdown;
  /** Exchange figures for this wallet, or null when it has never traded. */
  exchange: WalletExchangeStats | null;
}

export interface Snapshot {
  timestamp: string;
  tvl: number;
  totalAura: number;
  wallets: number;
  totalDeposited?: number;
  totalWithdrawn?: number;
}

export interface Totals {
  tvl: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalWallets: number;
  leaderboardWallets?: number;
  updatedAt: string;
}

/**
 * Only what the Overview and Aura pages actually render. Everything else this
 * used to carry — Gini, the Lorenz curve, top-N shares, median/average, the
 * rank thresholds, the Aura histogram and the alpha insights — was computed
 * on every refresh and read by nothing.
 */
export interface DashboardMetrics {
  /** Depositor count and USD still held per deposit-size bucket, smallest to
   * largest.
   *
   * Which bucket a wallet lands in is decided by `deposited_amount` — that is
   * what a tier like "$100-1K" names. `held` is a different question and sums
   * deposits net of withdrawals, so the buckets add up to TVL rather than to
   * lifetime deposits. Summing `deposited_amount` instead put $88.8M against
   * a TVL of $22.5M: the withdrawn $65M counted as though it were still
   * there. */
  depositSizeDistribution: {
    bucket: string;
    count: number;
    held: number;
    aura: number;
    auraMin: number;
    auraMax: number;
  }[];
  /**
   * Wallet count, Aura and still-held USD per Aura band, smallest to largest —
   * over every wallet holding Aura, not only depositors.
   *
   * The Overview tiers used to be cut by deposit size and merely labelled with
   * an Aura band, which held while Aura came from deposits alone. Mainnet
   * trading broke it: 42,329 wallets now hold Aura with no deposit at all, and
   * the labels drifted an order of magnitude from the cohorts they sat on — the
   * "<$100" tier, labelled "<10", actually spanned 2 to 44 Aura.
   */
  auraDistribution: {
    bucket: string;
    count: number;
    held: number;
    aura: number;
    auraMin: number;
    auraMax: number;
  }[];
  categoryBreakdown: { key: string; category: string; points: number; share: number }[];
}
