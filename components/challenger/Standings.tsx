"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { PanelCard } from "@/components/overview/PanelCard";
import { CopyableWallet } from "@/components/ui/CopyableWallet";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { SwapProvider, SwapValue } from "@/components/ui/SwapValue";
import { WalletSearchField } from "@/components/ui/WalletSearchField";
import { AuraCurve } from "@/components/challenger/AuraCurve";
import { FootStats } from "@/components/challenger/FootStats";
import type { RankName } from "@/lib/ranks";
import { cn, truncateWallet } from "@/lib/utils";

type PaidLeague = "Challenger" | "Diamond" | "Platinum" | "Gold";
type League = Exclude<RankName, "Unranked">;

export interface StandingRow {
  wallet: string;
  /** Place on BULK's leaderboard. */
  position: number;
  /** Trading AURA since launch, as BULK's leaderboard shows it: leagues are
   *  ranked by it, and each league's pool is split by it. */
  tradingAura: number;
  rank: RankName;
  /** Share of the week's prize pool this wallet takes (payoutShares); null
   *  in a league that wins no cash. */
  share: number | null;
}

/** What the standings cards need, from BULK's settled leagues. */
export interface StandingsData {
  /** The race at each line between two leagues, keyed by the league above
   *  it, best first: its last few in, then the first few of the one below. */
  races: Partial<Record<League, StandingRow[]>>;
  /** Each league's head, best first, for the leaderboard. */
  boards: Record<League, StandingRow[]>;
  /** The snapshot BULK settled these leagues at, ms. */
  asOf: number;
}

/** A searched wallet: one BULK does not rank has no place. */
type FoundRow = Omit<StandingRow, "position"> & { position: number | null };

/** Leaderboard rows closed, and opened: each league's top 25. Closed,
 *  twelve rows fill the card to the race card's height beside it. */
const FIRST_ROWS = 12;
const ALL_ROWS = 25;
/** The open and close slide, the same as Market assumptions on Tools. */
const SLIDE_MS = 560;
const FADE_MS = 380;
const SLIDE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** Room under the last row, opened, for the toggle to sit in. */
const TOGGLE_ROOM = 40;

/** Leagues best first, as the cards sit left to right. */
const LEAGUES: League[] = ["Challenger", "Diamond", "Platinum", "Gold", "Silver", "Bronze"];
/** What counts as close to a line: about 2.5% of what it takes to get in,
 *  500 AURA at the Challenger line, rounded to a 1, 2 or 5 step. */
const NEAR_SHARE = 0.025;

function nearBand(line: number): number {
  const raw = Math.max(1, line * NEAR_SHARE);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * magnitude).reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best));
}

const aura = (n: number) => Math.round(n).toLocaleString("en-US");
/** A chaser's gap to the line, signed. The lower leagues are packed tight
 *  enough that the first one out can tie the last one in: that reads 0. */
const gap = (n: number) => (Math.round(n) > 0 ? `−${aura(n)}` : "0");
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

/** From sm each column is as wide as what it holds, and the room left over
 *  falls in three equal spacer tracks between trader, AURA, league and
 *  payout, so the figures sit evenly across the row rather than the trader
 *  column taking it all. The cells skip the spacers by column. */
const BOARD_COLS =
  "grid grid-cols-[2rem_minmax(0,1fr)_4.25rem_1rem_4.5rem] items-center gap-2 px-4 sm:grid-cols-[2.75rem_minmax(0,5.25rem)_minmax(0,1fr)_3rem_minmax(0,1fr)_6rem_minmax(0,1fr)_3rem] sm:gap-x-0 sm:px-5 sm:[&>:nth-child(3)]:col-start-4 sm:[&>:nth-child(4)]:col-start-6 sm:[&>:nth-child(5)]:col-start-8";
/**
 * The standings as BULK ranks them: the official leaderboard of the league
 * picked from the cards above, with what each place takes of the pool, and
 * the race either side of the Challenger line.
 */
export function Standings({
  data,
  board,
  direction,
  pool,
  loading,
}: {
  data: StandingsData;
  /** The league the leaderboard shows. */
  board: League;
  /** Which way its rows slide in on a switch (SwapValue). */
  direction: 1 | -1;
  /** The week's whole prize pool, as the card above shows it. */
  pool: number;
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

  const rows = data.boards[board] ?? [];
  // The race card follows the leaderboard: the line under the league shown,
  // what it takes to get in. Bronze has no league under it, so it shows the
  // line above it, the climb into Silver.
  const upper = board === "Bronze" ? "Silver" : board;
  const lower = LEAGUES[LEAGUES.indexOf(upper) + 1];
  const race = data.races[upper] ?? [];
  const ahead = race.filter((row) => row.rank === upper);
  const behind = race.filter((row) => row.rank === lower);
  const cutoff = ahead[ahead.length - 1]?.tradingAura ?? 0;
  const asOf = new Date(data.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  const payout = (row: { rank: RankName; share: number | null }) => {
    if (!isPaid(row.rank)) return "No cash";
    return loading || row.share == null ? "—" : usd2(row.share * pool);
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
  // A league's own rows are keyed by place, not wallet, so on a switch each
  // row stays put and only what is in it slides over, as Execution's values
  // do; `swap` wraps each cell for that. The pinned row holds still.
  const boardRow = (row: FoundRow, key: string, { pinned = false, hidden = false, swap = false } = {}) => {
    const cell = (content: React.ReactNode, innerClassName?: string) =>
      swap ? <SwapValue innerClassName={innerClassName}>{content}</SwapValue> : content;
    return (
      <li
        key={key}
        inert={hidden || undefined}
        aria-hidden={hidden || undefined}
        className={cn(
          BOARD_COLS,
          "group py-[7px] transition-colors hover:bg-[rgb(var(--t-accent-rgb)/0.05)]",
          pinned && "bg-[rgb(var(--t-accent-rgb)/0.08)]",
        )}
      >
        <span className="font-sans tabular-nums text-text-muted">{cell(row.position ?? "—")}</span>
        {/* From sm the column is the address's width, and its copy button,
            shown on hover, stands out in the spacer after it. */}
        <span className="font-data min-w-0 truncate text-text-secondary sm:overflow-visible">
          {cell(<CopyableWallet wallet={row.wallet} display={truncateWallet(row.wallet, 4)} />)}
        </span>
        {/* Flex ends: a figure wider than its column runs out leftwards,
            into the spacer, and keeps its right edge on the column's. */}
        <span className="font-sans flex justify-end whitespace-nowrap tabular-nums text-text-primary">
          {cell(row.tradingAura > 0 ? aura(row.tradingAura) : "—")}
        </span>
        {cell(<LeagueCell rank={row.rank} />, "flex min-w-0")}
        <span
          className={cn(
            "font-sans flex justify-end whitespace-nowrap tabular-nums",
            isPaid(row.rank) ? "text-accent" : "text-text-muted",
          )}
        >
          {cell(row.rank === "Unranked" ? "—" : payout(row))}
        </span>
      </li>
    );
  };

  const chaser = behind[0];

  // How many runners sit within a close margin of the line, either way.
  const band = nearBand(cutoff);
  const near = race.filter((row) => Math.abs(row.tradingAura - cutoff) <= band).length;

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
  }, [found, board]);

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
      aria-label={open ? `Show the top ${FIRST_ROWS} only` : `Show the top ${Math.min(ALL_ROWS, rows.length)}`}
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
          {searchError && <p className="m-0 mt-1.5 font-sans text-[13px] text-text-muted">{searchError}</p>}
        </div>
        <div className={cn(BOARD_COLS, "border-b border-[var(--color-line)] pb-2")}>
          <span className="font-label text-text-dim">Rank</span>
          <span className="font-label text-text-dim">Trader</span>
          {/* Wider than its figures' column: a flex end lets it run out to
              the left, into the spacer, rather than past the column's edge. */}
          <span className="font-label flex justify-end whitespace-nowrap text-text-dim">
            <span className="sm:hidden">AURA</span>
            <span className="hidden sm:inline">Trading AURA</span>
          </span>
          <span className="font-label truncate text-text-dim">
            <span className="hidden sm:inline">League</span>
          </span>
          <span className="font-label flex items-center justify-end gap-1 whitespace-nowrap text-text-dim">
            <span className="sm:hidden">Payout</span>
            <span className="hidden sm:inline">Est. payout</span>
            <InfoTooltip text="Your league's share of this week's pool, split by Trading AURA. Each league pays at least 20% more than the top of the one below." panelClassName="w-60" />
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
          <ol ref={listRef} className="m-0 list-none p-0 text-[13px]">
            {found && boardRow(found, `pin-${found.wallet}`, { pinned: true })}
            <SwapProvider swapKey={board} direction={direction} pending={false}>
              {rows
                .slice(0, ALL_ROWS)
                .map((row, i) => boardRow(row, `place-${i}`, { hidden: !open && i >= FIRST_ROWS, swap: true }))}
            </SwapProvider>
          </ol>
          {rows.length > FIRST_ROWS && (
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

      {/* The race card follows the line: its zone names and figures slide
          over the same way the leaderboard's rows do. Bronze and Silver share
          one line, so switching between them moves nothing. */}
      <SwapProvider swapKey={upper} direction={direction} pending={false}>
        <PanelCard className="px-0 py-4 sm:px-0 sm:py-4">
          {/* No visible title: the chart names its own zones at the line. The
              heading stays for screen readers, who get no picture to go on. */}
          <h2 className="sr-only">Race for {upper}</h2>
          <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-5">
            {/* Stays mounted across leagues, keeping its measured size, so a
                switch never flashes an empty card; it reveals the new curve itself. */}
            <AuraCurve
              upper={upper}
              lower={lower}
              line={cutoff}
              points={race.map((row) => ({
                wallet: row.wallet,
                position: row.position,
                tradingAura: row.tradingAura,
                inside: row.rank === upper,
              }))}
            />
          </div>
          {/* The race in three figures, the same footer every card closes on:
              what it takes to get in, who is nearest to it, how tight it is. */}
          <div className="mx-4 mt-4 sm:mx-5">
            <FootStats
              swap
              stats={[
                // Only what changes with the league slides; the wording holds still.
                // On a phone the league's name is left to the chart above.
                {
                  label: (
                    <>
                      To enter <SwapValue>{upper}</SwapValue>
                    </>
                  ),
                  phoneLabel: "To enter",
                  value: aura(cutoff),
                  unit: "AURA",
                },
                {
                  label: (
                    <>
                      Closest chaser{chaser && <> · <SwapValue>#{chaser.position}</SwapValue></>}
                    </>
                  ),
                  phoneLabel: <>Chaser{chaser && <> · <SwapValue>#{chaser.position}</SwapValue></>}</>,
                  value: chaser ? gap(cutoff - chaser.tradingAura) : "—",
                  unit: chaser ? "AURA" : undefined,
                  tone: "accent",
                },
                {
                  label: (
                    <>
                      Within <SwapValue>{aura(band)}</SwapValue> AURA
                    </>
                  ),
                  phoneLabel: (
                    <>
                      ±<SwapValue>{aura(band)}</SwapValue> AURA
                    </>
                  ),
                  value: String(near),
                  unit: "traders",
                },
              ]}
            />
          </div>
        </PanelCard>
      </SwapProvider>
    </div>
  );
}
