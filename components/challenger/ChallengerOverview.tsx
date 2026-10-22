"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PanelCard } from "@/components/overview/PanelCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import {
  GAUNTLETS,
  GAUNTLET_AURA,
  leaguePrizesUsd,
  PRIZE_POOL_SHARE,
  SEASON_WEEKS,
  prizePoolUsd,
  seasonWeek,
} from "@/lib/challenger-series";
import { getNextSnapshotTimestamp } from "@/lib/projected-snapshot-tvl";
import type { RankName } from "@/lib/ranks";
import type { WeeklyRevenuePayload } from "@/lib/weekly-revenue";
import { cn } from "@/lib/utils";
import { formatSignedDelta, usdBoard } from "@/components/overview/spark-format";
import { DayBars, PoolCurve, weekDays } from "@/components/challenger/WeekCharts";
import { Standings, type StandingsData } from "@/components/challenger/Standings";
import { FootStats, type FootStat } from "@/components/challenger/FootStats";
import { LeagueCarousel } from "@/components/challenger/LeagueCarousel";

const WEEK_MS = 7 * 86_400_000;
/** The API reads the exchange's fee total behind a 15s cache; polling
 *  faster only hands back the same figure. */
const REFRESH_MS = 30_000;
const TICK_MS = 100;

/** One league as the ladder shows it, Challenger first. */
export interface LeagueSummary {
  rank: Exclude<RankName, "Unranked">;
  traders: number;
  /** Trading Aura of the league's last trader: what it took to get in. */
  minAura: number;
  firstPosition: number | null;
  lastPosition: number | null;
}

const usd2 = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd0 = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const count = (value: number) => Math.round(value).toLocaleString("en-US");


/**
 * BULK's net revenue this week, counting up as fills settle. The figure comes
 * from /api/weekly-revenue every half minute; between fetches the count runs
 * on at the pace the server reports, and a fresh figure never winds it back.
 */
function useLiveWeekRevenue(): {
  weekStart: number;
  netRevenueUsd: number | null;
  source: WeeklyRevenuePayload["source"] | null;
  now: number;
  anchor: WeeklyRevenuePayload | null;
} {
  const [anchor, setAnchor] = useState<WeeklyRevenuePayload | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const shown = useRef({ weekStart: 0, netRevenueUsd: 0 });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/weekly-revenue");
        if (!res.ok) return;
        const payload = (await res.json()) as WeeklyRevenuePayload;
        if (!cancelled) setAnchor(payload);
      } catch {
        // Keep counting from the last figure.
      }
    };
    load();
    const refresh = window.setInterval(load, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, []);

  const weekStart = getNextSnapshotTimestamp(now) - WEEK_MS;
  if (!anchor || anchor.weekStart !== weekStart) {
    return { weekStart, netRevenueUsd: null, source: null, now, anchor: null };
  }
  let netRevenueUsd = anchor.netRevenueUsd + anchor.usdPerMs * Math.max(0, now - anchor.at);
  // A snapshot rollover starts the count from zero; within a week it only
  // ever climbs, even when a fresh fetch lands under the running count.
  if (shown.current.weekStart === weekStart) {
    netRevenueUsd = Math.max(netRevenueUsd, shown.current.netRevenueUsd);
  }
  shown.current = { weekStart, netRevenueUsd };
  return { weekStart, netRevenueUsd, source: anchor.source, now, anchor };
}

/**
 * One headline card, built like the Overview KPI cards so the page reads as
 * the same site: glowing label and a badge on top, the figure with its 24h
 * move beside a chart, three small stats along the foot.
 */
function WeekCard({
  label,
  badge,
  figure,
  counting,
  delta,
  chart,
  stats,
  footAside,
  className,
}: {
  label: React.ReactNode;
  badge?: React.ReactNode;
  figure: string;
  /** Mid count: lit like the Overview counters. */
  counting?: boolean;
  /** The line under the figure: the 24h move, plus whatever frames it. */
  delta: React.ReactNode;
  /** Held to one height while loading, so the card does not jump. */
  chart: React.ReactNode;
  stats: FootStat[];
  /** Fills the foot's right two columns, next to a lone stat. */
  footAside?: React.ReactNode;
  className?: string;
}) {
  return (
    <PanelCard className={cn("h-full px-4 py-4 sm:px-5 sm:py-4", className)}>
      <div className="mb-4 flex h-4 items-center justify-between gap-3 leading-none">
        <div className="flex min-w-0 items-center gap-1.5">{label}</div>
        {badge && <span className="font-label shrink-0 text-[var(--t-accent)]">{badge}</span>}
      </div>
      {/* Side by side from sm up; on a phone the chart needs the full width
          or its seven day labels run together. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-6">
        <div className="flex shrink-0 flex-col">
          <p className="font-figure m-0 pb-0.5 whitespace-nowrap text-[26px] font-semibold leading-none tracking-[-0.02em] sm:text-[28px] xl:text-[30px]">
            <span className={cn("kpi-number", counting && "is-counting")}>{figure}</span>
          </p>
          <p className="m-0 mt-2.5 flex flex-1 items-center gap-2 font-data text-[12px] leading-none">{delta}</p>
        </div>
        {/* Grows into whatever height the card has spare, so a card
            stretched to its neighbour's height fills it with chart rather
            than leaving a gap under the footer. */}
        <div className="flex min-h-[70px] min-w-0 flex-1 flex-col">{chart}</div>
      </div>
      <div className="mt-4">
        <FootStats stats={stats} aside={footAside} />
      </div>
    </PanelCard>
  );
}

type PoolMode = "current" | "projected";

/** The Overview's KpiTerminalCounter timing: up from zero on first load, an
 *  ease-out glide when the toggle flips. */
const ENTRANCE_MS = 1000;
const SWITCH_MS = 480;

/**
 * Counts the figure the way KpiTerminalCounter does on 24h | Total Volume,
 * but starts a glide only when `key` (the toggle) changes or the figure first
 * arrives. The counter itself glides to every new value, and this one ticks
 * ten times a second: it would never settle, and its glow would stay on.
 */
function useSwitchGlide(target: number | null, key: string): { value: number | null; counting: boolean } {
  const glide = useRef<{ from: number; start: number; span: number } | null>(null);
  const last = useRef<{ key: string; value: number | null }>({ key, value: null });
  const [, setFrame] = useState(0);

  let value = target;
  let counting = false;
  if (target != null) {
    const now = performance.now();
    if (last.current.value == null) glide.current = { from: 0, start: now, span: ENTRANCE_MS };
    else if (last.current.key !== key) glide.current = { from: last.current.value, start: now, span: SWITCH_MS };
    const g = glide.current;
    if (g) {
      const t = Math.min(1, (now - g.start) / g.span);
      value = g.from + (target - g.from) * (1 - (1 - t) ** 3);
      counting = t < 1;
      if (!counting) glide.current = null;
    }
  }
  last.current = { key, value };

  // The live tick only redraws ten times a second; a glide wants every frame.
  useEffect(() => {
    if (!counting) return;
    let frame = requestAnimationFrame(function step() {
      setFrame((n) => n + 1);
      if (glide.current) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [counting]);

  return { value, counting };
}

const POOL_MODES: { id: PoolMode; label: string }[] = [
  { id: "current", label: "Current" },
  { id: "projected", label: "Projected" },
];

/** Current | Projected, the same switch as 24h | Total Volume on the
 *  Overview: the lit label is the one showing. */
function PoolModeToggle({ mode, onChange }: { mode: PoolMode; onChange: (mode: PoolMode) => void }) {
  return (
    <div className="flex h-4 min-w-0 items-center gap-[7px]" role="group" aria-label="Prize pool">
      {POOL_MODES.map((m, i) => {
        const on = m.id === mode;
        return (
          <span key={m.id} className="contents">
            {i > 0 && (
              <span className="text-text-dim" aria-hidden>
                |
              </span>
            )}
            <button
              type="button"
              onClick={() => onChange(m.id)}
              aria-pressed={on}
              className={cn(
                "font-label m-0 h-4 whitespace-nowrap border-0 bg-transparent p-0 leading-none transition-colors",
                on ? "volume-mode-on" : "volume-mode-off text-text-muted hover:text-text-secondary"
              )}
            >
              {m.label}
              {/* No room for the noun twice on a phone. */}
              <span className="hidden sm:inline"> prize pool</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}

const noSubscribe = () => () => {};

/**
 * Time left in the week, to the Saturday 12:00 UTC snapshot that settles the
 * leagues and pays the pool: one box per unit, as the BULK app counts down
 * its own reveal.
 */
function RevealCountdown({ target, now }: { target: number; now: number }) {
  // The server's clock and the browser's never agree to the second, so the
  // digits wait for the browser rather than fail hydration.
  const mounted = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );
  const left = Math.max(0, Math.floor((target - now) / 1000));
  const units = [
    { label: "days", value: Math.floor(left / 86_400) },
    { label: "hours", value: Math.floor((left % 86_400) / 3_600) },
    { label: "minutes", value: Math.floor((left % 3_600) / 60) },
    { label: "seconds", value: left % 60 },
  ];
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="hidden items-center gap-1.5 sm:flex">
        <span className="font-label whitespace-nowrap text-text-dim">Next reveal</span>
        <InfoTooltip text="Leagues settle and the pool pays out at Saturday's 12:00 UTC snapshot." panelClassName="w-60" />
      </div>
      <div className="flex gap-1 sm:gap-1.5" role="timer" aria-label="Time until the weekly snapshot">
        {units.map((unit) => (
          <div
            key={unit.label}
            className="flex w-10 flex-col items-center rounded-md border border-[var(--color-line)] bg-[rgb(var(--t-accent-rgb)/0.05)] py-1 sm:w-12"
          >
            <span className="font-figure text-[15px] leading-none tabular-nums text-text-primary sm:text-[17px]">
              {mounted ? String(unit.value).padStart(2, "0") : "--"}
            </span>
            <span className="mt-0.5 text-[9px] leading-none text-text-muted">{unit.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A 24h move, green as on the Overview cards. */
function Up({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--color-bid-green)]">{children}</span>;
}

function positions(league: LeagueSummary): string {
  const { firstPosition: a, lastPosition: b } = league;
  if (a == null || b == null) return "Ranked";
  return a === b ? `Rank ${count(a)}` : `Ranks ${count(a)}–${count(b)}`;
}

const HOUR_MS = 3_600_000;

/** Pool value at `t` along the cumulative curve, between its points. */
function poolAt(points: { t: number; usd: number }[], t: number): number {
  if (!points.length || t <= points[0].t) return 0;
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i];
    if (t <= b.t) {
      const a = points[i - 1];
      return a.usd + ((b.usd - a.usd) * (t - a.t)) / Math.max(1, b.t - a.t);
    }
  }
  return points[points.length - 1].usd;
}

/**
 * The week's curves from the hourly volume. Net revenue is split across the
 * hours by their share of the volume: the fee rate barely moves within a
 * week, and the total it adds up to is the measured (or estimated) one.
 */
function weekSeries(anchor: WeeklyRevenuePayload, now: number, livePoolUsd: number) {
  const { weekStart, hours } = anchor;
  const anchorPool = prizePoolUsd(anchor.netRevenueUsd);
  const weekVolumeUsd = hours.reduce((sum, h) => sum + h.volumeUsd, 0);
  const end = Math.max(now, anchor.at);

  const points = [{ t: weekStart, usd: 0 }];
  let cumulative = 0;
  for (const hour of hours) {
    cumulative += hour.volumeUsd;
    const t = Math.min(hour.t + HOUR_MS, anchor.at);
    if (t <= points[points.length - 1].t) continue;
    points.push({ t, usd: weekVolumeUsd > 0 ? (anchorPool * cumulative) / weekVolumeUsd : 0 });
  }
  points.push({ t: end, usd: livePoolUsd });

  const slots = weekDays(weekStart);
  const days = slots.map(() => 0);
  for (const hour of hours) {
    const day = slots.findIndex((d) => hour.t >= d.start && hour.t < d.end);
    if (day >= 0) days[day] += hour.volumeUsd;
  }

  const elapsed = Math.max(HOUR_MS, end - weekStart);
  // Hourly buckets, so the 24h window starts on the hour that holds its edge.
  const dayAgo = end - 86_400_000;
  const last24hVolumeUsd = hours
    .filter((h) => h.t + HOUR_MS > dayAgo)
    .reduce((sum, h) => sum + h.volumeUsd, 0);
  return {
    points,
    days,
    weekVolumeUsd,
    last24hVolumeUsd,
    projectedVolumeUsd: (weekVolumeUsd * WEEK_MS) / elapsed,
    last24hUsd: livePoolUsd - poolAt(points, end - 86_400_000),
    projectedUsd: (livePoolUsd * WEEK_MS) / elapsed,
  };
}

/**
 * The page's top half: the live prize pool and the week's Gauntlet as two
 * matching halves, each with a chart over the same Saturday to Friday axis,
 * above the six leagues, each carrying its own share of the pool.
 */
export function ChallengerOverview({
  leagues,
  standings,
}: {
  leagues: LeagueSummary[];
  standings: StandingsData;
}) {
  const { weekStart, netRevenueUsd, source, now, anchor } = useLiveWeekRevenue();
  const loading = netRevenueUsd == null;
  const pool = prizePoolUsd(netRevenueUsd ?? 0);
  const week = seasonWeek(weekStart);
  const gauntlet = week ? GAUNTLETS[week] : undefined;

  const [mode, setMode] = useState<PoolMode>("current");
  const series = anchor ? weekSeries(anchor, now, pool) : null;
  const projected = mode === "projected";
  // The leagues below pay out of whichever pool the toggle shows, and count
  // along with the figure when it switches.
  const figure = useSwitchGlide(
    loading || (projected && !series) ? null : projected && series ? series.projectedUsd : pool,
    mode
  );
  const shownPool = figure.value ?? 0;

  const byRank = new Map(leagues.map((league) => [league.rank, league]));
  const prizes = leaguePrizesUsd(shownPool, {
    platinum: byRank.get("Platinum")?.traders ?? 0,
    gold: byRank.get("Gold")?.traders ?? 0,
  });

  const leagueCards = leagues.map((league, i) => {
    const prize = league.rank in prizes ? prizes[league.rank as keyof typeof prizes] : null;
    const rows = [
      { label: "Traders", value: count(league.traders) },
      { label: "Min AURA", value: count(league.minAura) },
      // No per trader figure: the pool is split pro rata by Trading
      // AURA, not evenly, so an average would promise what nobody gets.
      { label: "Prize pool", value: prize == null ? "No cash" : loading ? "—" : usd2(prize), prize: true },
    ];
    return (
      <PanelCard
        key={league.rank}
        glossy={i === 0}
        glossDelay={-7}
        className={cn("py-5 text-center", i === 0 && "border-[rgb(var(--t-accent-rgb)/0.35)]")}
      >
        {/* Own column: a glossy card wraps its children in one more box,
            so centring on the card itself would shrink that box. */}
        <div className="flex w-full flex-col items-center gap-2">
          {/* Decorative: the league's name sits right under it. The glint
              is masked to the badge's own shape, so the light only ever
              crosses the metal, and each card catches it a beat after
              the one before, like sun moving along a row of badges. */}
          {/* Swells a little more at the centre of the phone carousel,
              which sets --focus; elsewhere it is unset and stays put. */}
          <span className="relative size-14 shrink-0 [scale:calc(1+0.18*var(--focus,0))]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/ranks/${league.rank.toLowerCase()}.webp`}
              alt=""
              width={56}
              height={56}
              className="size-14 object-contain"
            />
            <span
              className="badge-glint"
              style={{
                maskImage: `url(/ranks/${league.rank.toLowerCase()}.webp)`,
                WebkitMaskImage: `url(/ranks/${league.rank.toLowerCase()}.webp)`,
                animationDelay: `${i * 0.35}s`,
              }}
              aria-hidden
            />
          </span>
          <p
            className={cn(
              "m-0 text-[14px] font-semibold uppercase tracking-[0.08em]",
              i === 0 ? "text-accent" : "text-text-primary"
            )}
          >
            {league.rank}
          </p>
          <p className="font-data m-0 text-[11px] leading-none text-text-muted">{positions(league)}</p>
          <dl className="m-0 mt-2 flex w-full flex-col gap-2 border-t border-[var(--color-line)] pt-3">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2">
                <dt className="font-label whitespace-nowrap text-text-dim">{row.label}</dt>
                <dd
                  className={cn(
                    "font-data m-0 tabular-nums",
                    row.prize && prize != null ? "text-accent" : "text-text-secondary",
                    prize == null && row.label !== "Traders" && row.label !== "Min AURA" && "text-text-muted"
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </PanelCard>
    );
  });

  return (
    <>
      {/* Equal halves: at full width each sits over three league cards. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <WeekCard
          className={gauntlet ? undefined : "lg:col-span-2"}
          label={
            <>
              <PoolModeToggle mode={mode} onChange={setMode} />
              <InfoTooltip
                text={
                  projected
                    ? "The pool at Saturday's 12:00 UTC snapshot if trading keeps this week's pace."
                    : source === "estimated"
                      ? "12.5% of BULK's net revenue after maker rebates. Estimated from volume this week, exact from next week."
                      : "12.5% of BULK's net revenue after maker rebates, counted live from BULK's fee totals."
                }
                panelClassName="w-64"
              />
            </>
          }
          badge={`${projected ? "By Sat" : "Live"}${week ? ` · W${week}/${SEASON_WEEKS}` : ""}`}
          figure={figure.value == null ? "$—" : usd2(figure.value)}
          counting={figure.counting}
          delta={
            <Up>
              {!series
                ? "—"
                : projected
                  ? `${formatSignedDelta(series.projectedUsd - pool, usd0)} to go`
                  : `${formatSignedDelta(series.last24hUsd, usd0)} 24h`}
            </Up>
          }
          chart={
            series && (
              <PoolCurve
                weekStart={weekStart}
                now={now}
                points={series.points}
                projectedUsd={series.projectedUsd}
                emphasis={mode}
                format={usd2}
              />
            )
          }
          stats={[
            projected
              ? {
                  label: "Projected net revenue",
                  value: series ? usd0(series.projectedUsd / PRIZE_POOL_SHARE) : "—",
                }
              : { label: "Net revenue", value: netRevenueUsd == null ? "—" : usd0(netRevenueUsd) },
          ]}
          footAside={<RevealCountdown target={weekStart + WEEK_MS} now={now} />}
        />
        {gauntlet && (
          <WeekCard
            label={<h2 className="font-label volume-mode-on m-0 truncate">This week&apos;s Gauntlet</h2>}
            // The Gauntlet is what the card is about, so its name takes the
            // headline; the week's figure for it reads right under it.
            figure={gauntlet.name}
            delta={
              series && gauntlet.metric === "takerVolume" ? (
                <>
                  <span className="text-text-primary">{usdBoard(series.weekVolumeUsd)}</span>
                  <Up>{`${formatSignedDelta(series.last24hVolumeUsd, usdBoard)} 24h`}</Up>
                </>
              ) : (
                "—"
              )
            }
            chart={
              series &&
              gauntlet.metric === "takerVolume" && (
                <DayBars weekStart={weekStart} now={now} days={series.days} format={usdBoard} />
              )
            }
            stats={[
              { label: "Reward", value: count(GAUNTLET_AURA), unit: "AURA" },
              { label: "Projected volume", value: series ? usdBoard(series.projectedVolumeUsd) : "—" },
              {
                label: "Per $1M traded",
                value: series && series.weekVolumeUsd > 0 ? count(GAUNTLET_AURA / (series.weekVolumeUsd / 1e6)) : "—",
                unit: "AURA",
              },
            ]}
          />
        )}
      </div>

      {/* A grid from tablets up; on a phone, a carousel instead of a column
          of six cards to scroll past. */}
      <div className="hidden gap-4 md:grid md:grid-cols-3 xl:grid-cols-6">{leagueCards}</div>
      <LeagueCarousel label="Leagues" className="-mx-4 sm:-mx-7 md:hidden">
        {leagueCards}
      </LeagueCarousel>

      <Standings data={standings} prizes={prizes} loading={loading} />
    </>
  );
}
