"use client";

import { useEffect, useState } from "react";
import { useLiveFinancials } from "@/components/live/LiveFinancialProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SnapshotButton } from "@/components/snapshot/SnapshotButton";
import { challengerWeekStart } from "@/lib/challenger-series";
import { cn } from "@/lib/utils";

const WEEK_DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;

function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Tick index for Sat→Fri labels. Uses the UTC calendar day, not 24h
 * slices from Saturday 13:00 — those stay on Sunday until Monday 13:00 UTC. */
function campaignDayIndex(nowMs: number, weekStartMs: number): number {
  const days = Math.floor((utcMidnight(nowMs) - utcMidnight(weekStartMs)) / MS_DAY);
  return Math.min(6, Math.max(0, days));
}

function formatLeftCompact(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  return `${days}d ${hours}h left`;
}

function WeekTicks({ today }: { today: number | null }) {
  return (
    <div className="flex items-center">
      {WEEK_DAYS.map((day, i) => {
        const current = today != null && i === today;
        const past = today != null && i < today;
        // The hit box is wider than the mark it holds, to give the hover a
        // target. It gives a pixel of that back on phones, where seven of
        // them add up to the room the wordmark needs.
        return (
          <div key={day} className="week-tick-hit flex h-[13px] w-[8px] cursor-default items-center justify-center sm:w-[9px]" title={day}>
            <div
              className={cn(
                "week-tick h-[9px] w-[7px]",
                current && "is-today apr-week-pulse",
                past && !current && "is-past",
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

export function HeaderCampaignStatus() {
  const live = useLiveFinancials();
  const nextSnapshot = live.campaign.nextSnapshotTimestamp;
  const [today, setToday] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);

  // The clock runs to Saturday 13:00 UTC, when BULK reveals the week and the
  // next opens (challengerWeekStart), not to the 12:00 snapshot. For the hour
  // between them the campaign has already moved its week on, so the header
  // holds the week number back to the one still closing.
  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const start = challengerWeekStart(now);
      setToday(campaignDayIndex(now, start));
      setRemainingMs(Math.max(0, start + MS_WEEK - now));
      // This week opened before the campaign's: the hour after 12:00.
      setClosing(start < nextSnapshot - MS_WEEK);
    };
    update();
    const id = window.setInterval(update, 30_000);
    return () => window.clearInterval(id);
  }, [nextSnapshot]);

  const week = closing ? live.campaign.week - 1 : live.campaign.week;
  const left = remainingMs != null ? formatLeftCompact(remainingMs) : "—";

  return (
    <div className="flex items-center gap-2 sm:gap-2.5 xl:gap-[18px]">
      {/* Where the TPS readout used to sit. The rule between the switch and
          the week clock is desktop-only: below the inline nav's breakpoint
          this corner also carries the Menu button, and every pixel it spends
          is one the wordmark loses. */}
      <SnapshotButton />
      <ThemeToggle />
      <span className="hidden h-[18px] w-px bg-[var(--color-line-strong)] xl:block" aria-hidden />
      <span
        className="flex shrink-0 items-center gap-[7.5px] xl:gap-[9px]"
        title={`Week ${week} · ${left}`}
      >
        {/* Capitals as tall as the ticks beside them: 14px caps are 9px in this face, and they sit 1px low in a line-height-1 box, so it rises by that. .font-label sets its own size, so these win by !important. The margin takes back the spacing after the last letter, so the gap to the ticks is the 8px the Menu row keeps too. */}
        <span className="font-label -mr-[0.12em] -translate-y-px text-[14px]! leading-none tracking-[0.12em]! text-text-muted">W{week}</span>
        <WeekTicks today={today} />
        {/* Desktop only. Below the inline nav's breakpoint the corner also
            carries the switch and the Menu button, and the countdown was the
            piece that pushed the row wide enough to ride over the wordmark.
            It is the least load-bearing of the three — the week number and
            its ticks already say where the week stands, and the exact hours
            are still in the group's title. */}
        <span className="font-data hidden whitespace-nowrap text-[11px] text-text-muted xl:inline">
          {left}
        </span>
      </span>
    </div>
  );
}
