"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { PanelCard } from "@/components/overview/PanelCard";
import { CopyableWallet } from "@/components/ui/CopyableWallet";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { WalletSearchField } from "@/components/ui/WalletSearchField";
import { AuraCurve } from "@/components/challenger/AuraCurve";
import { FootStats } from "@/components/challenger/FootStats";
import type { RankName } from "@/lib/ranks";
import { cn, truncateWallet } from "@/lib/utils";

type PaidLeague = "Challenger" | "Diamond" | "Platinum" | "Gold";

export interface StandingRow {
  wallet: string;
  /** Place on BULK's leaderboard. */
  position: number;
  /** Trading AURA since launch, as BULK's leaderboard shows it: leagues are
   *  ranked by it, and each league's pool is split by it. */
  tradingAura: number;
  rank: RankName;
}

/** What the standings cards need, from BULK's settled leagues. */
export interface StandingsData {
  /** The leaderboard's head, best first: Challengers, then the Diamonds the
   *  bubble card needs below the line. */
  top: StandingRow[];
  /** Trading AURA summed over each paid league: the pro rata divisor. */
  leagueAura: Record<PaidLeague, number>;
  /** The snapshot BULK settled these leagues at, ms. */
  asOf: number;
}

/** A searched wallet: one BULK does not rank has no place. */
type FoundRow = Omit<StandingRow, "position"> & { position: number | null };

/** Leaderboard rows closed, and opened: the board stops at the Challengers.
 *  Closed, twelve rows fill the card to the race card's height beside it. */
const FIRST_ROWS = 12;
const ALL_ROWS = 25;
/** The open and close slide, the same as Market assumptions on Tools. */
const SLIDE_MS = 560;
const FADE_MS = 380;
const SLIDE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** Room under the last row, opened, for the toggle to sit in. */
const TOGGLE_ROOM = 40;

/** Ranks either side of the Challenger line on the curve: #15 to #35. */
const ABOVE_LINE = 11;
const BELOW_LINE = 10;
/** What counts as close to the line, in Trading AURA. */
const NEAR_LINE = 500;

const aura = (n: number) => Math.round(n).toLocaleString("en-US");
const usd2 = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isPaid = (rank: RankName): rank is PaidLeague =>
  rank === "Challenger" || rank === "Diamond" || rank === "Platinum" || rank === "Gold";

function CardHead({ label, aside }: { label: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex h-4 items-center justify-between gap-3 px-4 leading-none sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5">{label}</div>
      {aside && <span className="font-label shrink-0 text-[var(--t-accent)]">{aside}</span>}
    </div>
  );
}

/**
 * Three stacked chevrons lighting one after another from the top, the
 * expand control under the leaderboard. Turned over once the list is open,
 * so the same wave runs upward toward the fold.
 */
function WaveChevrons({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 40 24"
      width="40"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("chevron-wave transition-transform duration-300", up && "rotate-180")}
      aria-hidden
    >
      {/* Wide and shallow: a broad wave rather than a tall arrow. */}
      <path d="M5 4l15 4.5 15-4.5" />
      <path d="M5 10l15 4.5 15-4.5" />
      <path d="M5 16l15 4.5 15-4.5" />
    </svg>
  );
}

function LeagueCell({ rank }: { rank: RankName }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {/* Decorative: the league's name sits beside it from sm up. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/ranks/${rank.toLowerCase()}.webp`} alt="" width={16} height={16} className="size-4 shrink-0 object-contain" />
      <span className={cn("font-label hidden truncate sm:inline", rank === "Challenger" ? "text-accent" : "text-text-secondary")}>
        {rank}
      </span>
    </span>
  );
}

const BOARD_COLS =
  "grid grid-cols-[2rem_minmax(0,1fr)_4.25rem_1rem_4.5rem] items-center gap-2 px-4 sm:grid-cols-[2.75rem_minmax(0,1fr)_6rem_6.5rem_6rem] sm:gap-3 sm:px-5";
/**
 * The standings as BULK ranks them: the official leaderboard with what each
 * place takes of its league's pool, and the race either side of the
 * Challenger line.
 */
export function Standings({
  data,
  prizes,
  loading,
}: {
  data: StandingsData;
  prizes: Record<PaidLeague, number>;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<FoundRow | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Every row stays mounted and the box around them slides between the
  // closed cut and the full list; these are the two heights it slides to.
  const listRef = useRef<HTMLOListElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<{ closed: number; open: number } | null>(null);

  const { top, leagueAura } = data;
  const challengers = top.filter((row) => row.rank === "Challenger");
  const diamonds = top.filter((row) => row.rank === "Diamond");
  const cutoff = challengers[challengers.length - 1]?.tradingAura ?? 0;
  const asOf = new Date(data.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  const payout = (row: { rank: RankName; tradingAura: number }) => {
    if (!isPaid(row.rank)) return "No cash";
    const divisor = leagueAura[row.rank];
    return loading || divisor <= 0 ? "—" : usd2((prizes[row.rank] * row.tradingAura) / divisor);
  };

  async function search() {
    const wallet = query.trim();
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/league-rank?wallet=${encodeURIComponent(wallet)}`);
      if (!res.ok) {
        setFound(null);
        setSearchError(res.status === 400 ? "Not a wallet address" : "Lookup failed, try again");
        return;
      }
      setFound((await res.json()) as FoundRow);
    } catch {
      setFound(null);
      setSearchError("Lookup failed, try again");
    } finally {
      setSearching(false);
    }
  }

  // Pinned above the list, as BULK's own leaderboard shows a searched wallet.
  const boardRow = (row: FoundRow, pinned = false, hidden = false) => (
    <li
      key={`${pinned ? "pin-" : ""}${row.wallet}`}
      inert={hidden || undefined}
      aria-hidden={hidden || undefined}
      className={cn(
        BOARD_COLS,
        "group py-[7px] transition-colors hover:bg-[rgb(var(--t-accent-rgb)/0.05)]",
        pinned && "bg-[rgb(var(--t-accent-rgb)/0.08)]",
      )}
    >
      <span className="font-data text-text-muted">{row.position ?? "—"}</span>
      <span className="font-data min-w-0 truncate text-text-secondary">
        <CopyableWallet wallet={row.wallet} display={truncateWallet(row.wallet, 4)} />
      </span>
      <span className="font-data text-right text-text-primary">{row.tradingAura > 0 ? aura(row.tradingAura) : "—"}</span>
      <LeagueCell rank={row.rank} />
      <span className={cn("font-data text-right", isPaid(row.rank) ? "text-accent" : "text-text-muted")}>
        {row.rank === "Unranked" ? "—" : payout(row)}
      </span>
    </li>
  );

  // The race around the line: the last Challengers and the first Diamonds,
  // as the same rows the leaderboard draws, the last column their gap to it.
  const ahead = challengers.slice(-ABOVE_LINE);
  const behind = diamonds.slice(0, BELOW_LINE);
  const chaser = behind[0];

  // How many runners sit within a close margin of the line, either way.
  const near = [...ahead, ...behind].filter((row) => Math.abs(row.tradingAura - cutoff) <= NEAR_LINE).length;

  // Re-measured whenever the list changes size: a search pins a row on top.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const rows = list.children;
      const cut = rows[Math.min(rows.length, FIRST_ROWS + (found ? 1 : 0)) - 1] as HTMLElement | undefined;
      const closed = cut ? cut.offsetTop + cut.offsetHeight : list.offsetHeight;
      const open = list.offsetHeight + TOGGLE_ROOM;
      setHeights((prev) => (prev && prev.closed === closed && prev.open === open ? prev : { closed, open }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [found]);

  /**
   * Opening carries the reader down with the list, the way closing carries
   * them up: each frame of the slide the page scrolls by however far the
   * box's bottom edge moved, so the chevrons stay where they were clicked
   * and the scroll follows the slide's own curve. Any wheel or touch hands
   * the page straight back.
   */
  function rideOpen() {
    const box = boxRef.current;
    if (!box) return;
    const anchor = box.getBoundingClientRect().bottom;
    const until = performance.now() + SLIDE_MS + 80;
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    window.addEventListener("wheel", stop, { once: true, passive: true });
    window.addEventListener("touchstart", stop, { once: true, passive: true });
    const step = () => {
      if (!stopped) {
        const drift = box.getBoundingClientRect().bottom - anchor;
        if (Math.abs(drift) >= 0.5) window.scrollBy({ top: drift, behavior: "instant" });
      }
      if (!stopped && performance.now() < until) {
        requestAnimationFrame(step);
      } else {
        window.removeEventListener("wheel", stop);
        window.removeEventListener("touchstart", stop);
      }
    };
    requestAnimationFrame(step);
  }

  const toggle = (
    <button
      type="button"
      onClick={() => {
        if (!open) rideOpen();
        setOpen((v) => !v);
      }}
      aria-expanded={open}
      aria-label={open ? `Show the top ${FIRST_ROWS} only` : `Show the top ${Math.min(ALL_ROWS, top.length)}`}
      className="pointer-events-auto flex h-9 w-20 items-center justify-center border-0 bg-transparent p-0 text-accent transition-colors hover:text-text-primary"
    >
      <WaveChevrons up={open} />
    </button>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PanelCard className="px-0 py-4 sm:px-0 sm:py-4">
        <CardHead label={<h2 className="font-label volume-mode-on m-0 truncate">Leaderboard</h2>} aside={`Snapshot · ${asOf}`} />
        <div className="mb-3 px-4 sm:px-5">
          <WalletSearchField
            value={query}
            onChange={setQuery}
            onSubmit={search}
            onClear={() => {
              setQuery("");
              setFound(null);
              setSearchError(null);
            }}
            loading={searching}
            showClear={query.length > 0 || found != null}
            placeholder="Search by wallet address…"
          />
          {searchError && <p className="font-data m-0 mt-1.5 text-text-muted">{searchError}</p>}
        </div>
        <div className={cn(BOARD_COLS, "border-b border-[var(--color-line)] pb-2")}>
          <span className="font-label text-text-dim">Rank</span>
          <span className="font-label text-text-dim">Trader</span>
          <span className="font-label whitespace-nowrap text-right text-text-dim">
            <span className="sm:hidden">AURA</span>
            <span className="hidden sm:inline">Trading AURA</span>
          </span>
          <span className="font-label truncate text-text-dim">
            <span className="hidden sm:inline">League</span>
          </span>
          <span className="font-label flex items-center justify-end gap-1 whitespace-nowrap text-text-dim">
            <span className="sm:hidden">Payout</span>
            <span className="hidden sm:inline">Est. payout</span>
            <InfoTooltip text="This week's pool for the league, split pro rata by Trading AURA." panelClassName="w-56" />
          </span>
        </div>
        {/* The box slides between the closed cut and the full list, as
            Market assumptions does. The toggle rides its bottom edge: over a
            fade on the last rows while closed, in the room under the 25th
            once open, so it never costs the closed card any height. */}
        <div
          ref={boxRef}
          className="relative overflow-hidden"
          style={{
            height: heights ? (open ? heights.open : heights.closed) : undefined,
            // Until the first measure (the server render), cut at about twelve
            // rows so the page never opens on all twenty five.
            maxHeight: heights ? undefined : FIRST_ROWS * 32,
            transition: `height ${SLIDE_MS}ms ${SLIDE_EASE}`,
          }}
        >
          <ol ref={listRef} className="m-0 list-none p-0 text-[12px]">
            {found && boardRow(found, true)}
            {top.slice(0, ALL_ROWS).map((row, i) => boardRow(row, false, !open && i >= FIRST_ROWS))}
          </ol>
          {top.length > FIRST_ROWS && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center">
              <div
                className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-primary)] via-[var(--color-bg-primary)]/85 to-transparent"
                style={{ opacity: open ? 0 : 1, transition: `opacity ${FADE_MS}ms ${SLIDE_EASE}` }}
                aria-hidden
              />
              <div className="relative">{toggle}</div>
            </div>
          )}
        </div>
      </PanelCard>

      <PanelCard className="px-0 py-4 sm:px-0 sm:py-4">
        {/* No visible title: the chart names its own zones at the line. The
            heading stays for screen readers, who get no picture to go on. */}
        <h2 className="sr-only">Race for Challenger</h2>
        <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-5">
          <AuraCurve
            line={cutoff}
            points={[...ahead, ...behind].map((row) => ({
              wallet: row.wallet,
              position: row.position,
              tradingAura: row.tradingAura,
            }))}
          />
        </div>
        {/* The race in three figures, the same footer every card closes on:
            what it takes to get in, who is nearest to it, how tight it is. */}
        <div className="mx-4 mt-4 sm:mx-5">
          <FootStats
            stats={[
              { label: "To enter Challenger", value: aura(cutoff), unit: "AURA" },
              {
                label: chaser ? `Closest chaser · #${chaser.position}` : "Closest chaser",
                value: chaser ? `−${aura(Math.max(0, cutoff - chaser.tradingAura))}` : "—",
                unit: chaser ? "AURA" : undefined,
                tone: "accent",
              },
              { label: `Within ${NEAR_LINE} AURA`, value: String(near), unit: "traders" },
            ]}
          />
        </div>
      </PanelCard>
    </div>
  );
}
