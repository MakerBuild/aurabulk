"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { LeaderboardEntry } from "@/types";
import {
  LEADERBOARD_TAB_DEFAULT_SORT,
  LEADERBOARD_TOP_LIMIT,
  type LeaderboardSortDir,
  type LeaderboardTab,
} from "@/lib/leaderboard-table";
import { formatNumber, formatUsd, truncateWallet } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CopyableWallet } from "@/components/ui/CopyableWallet";
import { PageHeading } from "@/components/layout/PageHeading";
import { PanelCard } from "@/components/overview/PanelCard";
import { RowHighlight } from "@/components/ui/RowHighlight";

interface ColumnDef {
  key: string;
  label: string;
  align?: "left" | "right";
  isDisplayRank?: boolean;
  sortable?: boolean;
  render: (entry: LeaderboardEntry) => React.ReactNode;
}

function getColumns(tab: LeaderboardTab): ColumnDef[] {
  const rank: ColumnDef = {
    key: "rank",
    label: "Rank",
    align: "left",
    isDisplayRank: true,
    sortable: false,
    render: () => null,
  };

  const wallet: ColumnDef = {
    key: "wallet",
    label: "Wallet",
    align: "left",
    render: (entry) => <WalletCell wallet={entry.wallet} />,
  };

  const aura: ColumnDef = {
    key: "aura",
    label: "Aura",
    align: "right",
    render: (entry) => (
      <span className="font-data text-accent">{formatNumber(entry.aura)}</span>
    ),
  };

  const volume: ColumnDef = {
    key: "volume",
    label: "Volume",
    align: "right",
    render: (entry) => (
      <span className="font-data text-accent">{formatUsd(entry.volume_usd ?? 0)}</span>
    ),
  };

  const pnl: ColumnDef = {
    key: "pnl",
    label: "PnL",
    align: "right",
    render: (entry) => {
      const value = entry.pnl_usd ?? 0;
      return (
        <span
          className={cn(
            "font-data",
            value > 0 && "text-[var(--color-bid-green)]",
            value < 0 && "text-[var(--color-neg-strong)]",
          )}
        >
          {value > 0 ? "+" : value < 0 ? "−" : ""}
          {formatUsd(Math.abs(value))}
        </span>
      );
    },
  };

  if (tab === "volume") return [rank, wallet, volume, aura];
  if (tab === "pnl") return [rank, wallet, pnl, aura];
  return [rank, wallet, aura];
}

function defaultSortDirForKey(tab: LeaderboardTab, key: string): LeaderboardSortDir {
  const defaults = LEADERBOARD_TAB_DEFAULT_SORT[tab];
  if (key === defaults.key) return defaults.dir;
  if (key.endsWith("_rank")) return "asc";
  return "desc";
}

function cacheKey(tab: LeaderboardTab, sortKey: string, sortDir: LeaderboardSortDir) {
  return `${tab}:${sortKey}:${sortDir}`;
}

export function LeaderboardTable({
  initialRows = [],
}: {
  /** Aura ranking from the server, so the first paint is a table, not a wait. */
  initialRows?: LeaderboardEntry[];
}) {
  const [tab, setTab] = useState<LeaderboardTab>("aura");
  // Bumped on every press and used as the underline's key, so the mark
  // restarts even when the tab pressed is the one already open. Same control
  // as the tools page — see the note on .switch-underline.
  const [tabClickCount, setTabClickCount] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [hoveredWallet, setHoveredWallet] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState(LEADERBOARD_TAB_DEFAULT_SORT.aura.key);
  const [sortDir, setSortDir] = useState<LeaderboardSortDir>(
    LEADERBOARD_TAB_DEFAULT_SORT.aura.dir
  );
  const [rows, setRows] = useState<LeaderboardEntry[]>(initialRows);
  const [loading, setLoading] = useState(initialRows.length === 0);
  const cacheRef = useRef(new Map<string, LeaderboardEntry[]>());
  const pageSize = 25;

  const columns = useMemo(() => getColumns(tab), [tab]);

  useEffect(() => {
    const auraKey = cacheKey("aura", LEADERBOARD_TAB_DEFAULT_SORT.aura.key, LEADERBOARD_TAB_DEFAULT_SORT.aura.dir);
    if (initialRows.length > 0 && !cacheRef.current.has(auraKey)) {
      cacheRef.current.set(auraKey, initialRows);
    }
  }, [initialRows]);

  useEffect(() => {
    let cancelled = false;
    const key = cacheKey(tab, sortKey, sortDir);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setRows(cached);
      setLoading(false);
    }

    async function load() {
      if (!cached) setLoading(true);
      try {
        const params = new URLSearchParams({
          tab,
          sort: sortKey,
          dir: sortDir,
          limit: String(LEADERBOARD_TOP_LIMIT),
        });
        const res = await fetch(`/api/leaderboard?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load leaderboard");
        const data = (await res.json()) as { items: LeaderboardEntry[] };
        cacheRef.current.set(key, data.items);
        if (!cancelled) setRows(data.items);
      } catch {
        if (!cancelled && !cached) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tab, sortKey, sortDir]);

  useEffect(() => {
    const others: LeaderboardTab[] = ["volume", "pnl"];
    const timer = window.setTimeout(() => {
      for (const other of others) {
        const defaults = LEADERBOARD_TAB_DEFAULT_SORT[other];
        const key = cacheKey(other, defaults.key, defaults.dir);
        if (cacheRef.current.has(key)) continue;
        const params = new URLSearchParams({
          tab: other,
          sort: defaults.key,
          dir: defaults.dir,
          limit: String(LEADERBOARD_TOP_LIMIT),
        });
        void fetch(`/api/leaderboard?${params.toString()}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data: { items: LeaderboardEntry[] } | null) => {
            if (data?.items) cacheRef.current.set(key, data.items);
          });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((entry) => entry.wallet.toLowerCase().includes(q));
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageData = filtered.slice((page - 1) * pageSize, page * pageSize);

  function handleTabChange(nextTab: LeaderboardTab) {
    const defaults = LEADERBOARD_TAB_DEFAULT_SORT[nextTab];
    setTab(nextTab);
    setSortKey(defaults.key);
    setSortDir(defaults.dir);
    setPage(1);
  }

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(key);
    setSortDir(defaultSortDirForKey(tab, key));
    setPage(1);
  }

  const tabs: { id: LeaderboardTab; label: string }[] = [
    { id: "aura", label: "Aura Rank" },
    { id: "volume", label: "Volume Rank" },
    { id: "pnl", label: "PnL Rank" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* The rank tabs ride the bottom edge of the heading card, the way the
          tool tabs do on /tools. They choose what the page IS, which is the
          heading's own question — as a strip of ghost buttons above the table
          they read as one more table control, alongside search and paging. */}
      <PageHeading eyebrow="Leaderboards" title="Top wallets" centered>
        <div className="flex flex-wrap items-center justify-center gap-7">
          {tabs.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  handleTabChange(t.id);
                  setTabClickCount((n) => n + 1);
                }}
                aria-pressed={on}
                className={cn(
                  "relative cursor-pointer pb-2.5 text-[13px] font-medium transition-colors",
                  on ? "text-accent" : "text-text-muted hover:text-text-primary"
                )}
              >
                {t.label}
                {on && (
                  <span
                    key={tabClickCount}
                    className="switch-underline pointer-events-none absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[linear-gradient(90deg,transparent_0%,var(--color-accent)_22%,var(--color-accent)_78%,transparent_100%)]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </PageHeading>

      <PanelCard glossy glossDelay={-11} className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-[var(--color-line)] p-4 sm:flex-row sm:items-center sm:justify-end">
          <input
            type="text"
            placeholder="Search wallet..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="input-field max-w-xs text-[13px]"
          />
        </div>

      <div
        ref={scrollRef}
        className={cn("relative isolate overflow-x-auto", loading && "min-h-[680px]")}
        onMouseLeave={() => setHoveredWallet(null)}
      >
        {/* Lives in the scroll wrapper rather than the table: a <tr> can't
            hold a positioned box, and this way the highlight scrolls with the
            rows on a narrow screen. */}
        <RowHighlight
          containerRef={scrollRef}
          target={hoveredWallet != null ? (rowEls.current[hoveredWallet] ?? null) : null}
        />
        <table className="w-full text-left text-[13px] text-text-primary">
          <thead>
            <tr className="border-b border-[var(--color-line)]">
              {columns.map((col) => (
                <SortableHeader
                  key={col.key}
                  label={col.label}
                  align={col.align}
                  sortable={col.sortable !== false}
                  active={sortKey === col.key}
                  direction={sortKey === col.key ? sortDir : null}
                  onClick={() => handleSort(col.key)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-text-muted"
                >
                  Loading top {LEADERBOARD_TOP_LIMIT}…
                </td>
              </tr>
            ) : pageData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-text-muted"
                >
                  {tab === "volume"
                    ? "No recorded trading volume yet"
                    : tab === "pnl"
                      ? "No recorded PnL yet"
                      : "No wallets found"}
                </td>
              </tr>
            ) : (
              pageData.map((entry, i) => (
                <tr
                  key={entry.wallet}
                  ref={(el) => {
                    rowEls.current[entry.wallet] = el;
                  }}
                  onMouseEnter={() => setHoveredWallet(entry.wallet)}
                  className="group border-b border-[var(--color-line-soft)]"
                >
                  {columns.map((col) => {
                    const value = col.isDisplayRank
                      ? `#${(page - 1) * pageSize + i + 1}`
                      : col.render(entry);
                    const alignRight = col.align === "right";
                    const sortable = col.sortable !== false;
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "px-4 py-2.5",
                          alignRight ? "text-right" : "text-left",
                          col.isDisplayRank && "font-data text-text-muted"
                        )}
                      >
                        {alignRight && sortable ? (
                          <span className="inline-flex w-full items-center justify-end gap-1">
                            {value}
                            <SortIconSlot />
                          </span>
                        ) : (
                          value
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--color-line)] px-4 py-3">
        <p className="font-data text-[12px] text-text-muted">
          {search.trim()
            ? `Showing ${pageData.length} of ${filtered.length} matches`
            : tab === "volume"
              ? `14-day volume · ${filtered.length} wallets`
              : tab === "pnl"
                ? `PnL · ${filtered.length} wallets`
              : `Top ${LEADERBOARD_TOP_LIMIT} · showing ${pageData.length} of ${filtered.length}`}
        </p>
        <div className="term-seg">
          <button
            type="button"
            className={cn(
              "term-seg-btn min-w-[3.5rem] flex-[1_1_0]",
              page <= 1 || loading ? "is-off opacity-40" : "is-off"
            )}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            <span className="relative z-10">Prev</span>
          </button>
          <span className="term-seg-label" aria-live="polite">
            {page}/{totalPages}
          </span>
          <button
            type="button"
            className={cn(
              "term-seg-btn min-w-[3.5rem] flex-[1_1_0]",
              page >= totalPages || loading ? "is-off opacity-40" : "is-off"
            )}
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            <span className="relative z-10">Next</span>
          </button>
        </div>
      </div>
      </PanelCard>
    </div>
  );
}

function WalletCell({ wallet }: { wallet: string }) {
  return <CopyableWallet wallet={wallet} display={truncateWallet(wallet, 6)} />;
}

/** Same box the sort chevron occupies, so right-aligned figures sit on the
 * header label rather than sliding under the icon. Empty in the body; the
 * header fills it with the chevron. */
function SortIconSlot({ children }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      {children}
    </span>
  );
}

function SortableHeader({
  label,
  align = "right",
  sortable,
  active,
  direction,
  onClick,
}: {
  label: string;
  align?: "left" | "right";
  sortable: boolean;
  active: boolean;
  direction: LeaderboardSortDir | null;
  onClick: () => void;
}) {
  const th = "px-4 py-3 text-[13px] font-medium";

  if (!sortable) {
    return (
      <th
        className={cn(
          th,
          align === "right" ? "text-right" : "text-left",
          "text-text-muted"
        )}
      >
        {label}
      </th>
    );
  }

  const Icon = active && direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <th className={cn(th, align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex w-full items-center gap-1 transition-colors",
          align === "right" ? "justify-end" : "justify-start",
          active ? "text-accent" : "text-text-muted hover:text-text-primary"
        )}
      >
        {label}
        <SortIconSlot>
          <Icon
            className={cn("h-3.5 w-3.5", active ? "text-accent" : "text-text-dim")}
          />
        </SortIconSlot>
      </button>
    </th>
  );
}
