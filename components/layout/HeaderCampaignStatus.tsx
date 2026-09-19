"use client";

import { useEffect, useState } from "react";
import { useLiveFinancials } from "@/components/live/LiveFinancialProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { cn } from "@/lib/utils";

const WEEK_DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const MS_DAY = 86_400_000;

function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Tick index for Sat→Fri labels. Uses the UTC calendar day, not 24h
 * slices from Saturday 12:00 — those stay on Sunday until Monday 12:00 UTC. */
function campaignDayIndex(nowMs: number, nextSnapshotMs: number): number {
  const weekStartMs = nextSnapshotMs - 7 * MS_DAY;
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

  useEffect(() => {
    const update = () => {
      setToday(campaignDayIndex(Date.now(), nextSnapshot));
      setRemainingMs(Math.max(0, nextSnapshot - Date.now()));
    };
    update();
    const id = window.setInterval(update, 30_000);
    return () => window.clearInterval(id);
  }, [nextSnapshot]);

  const week = live.campaign.week;
  const left = remainingMs != null ? formatLeftCompact(remainingMs) : "—";

  return (
    <div className="flex items-center gap-2 sm:gap-2.5 lg:gap-[18px]">
      {/* Where the TPS readout used to sit. The rule between the switch and
          the week clock is desktop-only: below the inline nav's breakpoint
          this corner also carries the Menu button, and every pixel it spends
          is one the wordmark loses. */}
      <ThemeToggle />
      <span className="hidden h-[18px] w-px bg-[var(--color-line-strong)] lg:block" aria-hidden />
      <span
        className="flex shrink-0 items-center gap-1.5 lg:gap-[9px]"
        title={`Week ${week} · ${left}`}
      >
        <span className="font-label text-text-muted">W{week}</span>
        <WeekTicks today={today} />
        {/* Desktop only. Below the inline nav's breakpoint the corner also
            carries the switch and the Menu button, and the countdown was the
            piece that pushed the row wide enough to ride over the wordmark.
            It is the least load-bearing of the three — the week number and
            its ticks already say where the week stands, and the exact hours
            are still in the group's title. */}
        <span className="font-data hidden whitespace-nowrap text-[11px] text-text-muted lg:inline">
          {left}
        </span>
      </span>
    </div>
  );
}
