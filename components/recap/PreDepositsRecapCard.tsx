import Image from "next/image";
import { PanelLabel } from "@/components/overview/PanelCard";
import { cn } from "@/lib/utils";

function RecapStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[12px] bg-[var(--color-bulk-base)] px-5 py-4 shadow-[inset_0_1px_0_rgb(var(--t-veil-rgb)/0.07)]">
      <PanelLabel>{label}</PanelLabel>
      <p
        className={cn(
          "font-figure m-0 text-[36px] leading-none tracking-[-0.02em]",
          accent ? "text-accent" : "text-text-primary",
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="font-data m-0 text-[13px] leading-snug text-text-secondary">{sub}</p>
      ) : null}
    </div>
  );
}

/** Fixed-size share card — 1200×675, so nothing on it may scale with the
 * viewport or the exported PNG changes with the window. */
export function PreDepositsRecapCard() {
  return (
    <div className="relative flex h-[675px] w-[1200px] flex-col overflow-hidden rounded-[16px] bg-[var(--t-base)] px-10 py-9">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 80% 55% at 12% -8%, rgb(var(--t-accent-rgb)/0.14), transparent 58%), radial-gradient(ellipse 60% 45% at 92% 108%, rgb(var(--t-chart-b-rgb)/0.12), transparent 55%)",
        }}
      />

      <div className="relative flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/logos/bulkx-logo-light.svg"
            alt=""
            width={83}
            height={32}
            className="logo-ink-light shrink-0"
          />
          <Image
            src="/logos/bulkx-logo-dark.svg"
            alt=""
            width={83}
            height={32}
            className="logo-ink-dark shrink-0"
          />
          <span className="font-label text-text-dim">Intelligence</span>
        </div>
        <PanelLabel>Pre-Deposits Recap</PanelLabel>
      </div>

      <div className="relative mt-8 grid flex-1 grid-cols-3 gap-4">
        <RecapStat
          label="Participants"
          value="13.9K"
          sub="wallets joined the pre-deposit campaign"
        />
        <RecapStat
          label="Capital Flow"
          value="$91M"
          sub={
            <>
              flowed through the campaign
              <br />
              <span className="text-accent">$41M peak TVL</span>
            </>
          }
        />
        <RecapStat
          label="Aura Distributed"
          value="13.6M"
          accent
          sub={
            <>
              <span className="text-accent">88%</span> went to pre-depositors
            </>
          }
        />
      </div>

      <div className="relative mt-6 h-px w-full bg-[var(--color-line)]" />

      <p className="font-figure relative m-0 mt-6 text-center text-[22px] leading-snug tracking-[-0.01em] text-text-primary">
        Pretty fucking solid for a pre-launch campaign.{" "}
        <span aria-hidden className="inline-block">
          👀
        </span>
      </p>

      <p className="font-data relative m-0 mt-3 text-center text-[11px] text-text-dim">
        aurabulk.xyz · data as of Aug 29, 2026
      </p>
    </div>
  );
}
