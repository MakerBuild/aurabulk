import { buildLiveFinancialPayloadFromDisk } from "@/lib/live-financial-payload";
import { buildOverviewPanels } from "@/lib/overview-metrics";
import { computeDashboardMetrics } from "@/lib/stats";
import { VolumePanel } from "@/components/overview/VolumePanel";
import { AuraSourcesPanel } from "@/components/overview/AuraSourcesPanel";
import { KpiStrip } from "@/components/overview/KpiStrip";
import { DepositorsDistributionPanel } from "@/components/overview/DepositorsDistributionPanel";

export const dynamic = "force-static";
export const revalidate = 3600;

export default async function OverviewPage() {
  const metrics = await computeDashboardMetrics();
  const live = buildLiveFinancialPayloadFromDisk();

  const panels = buildOverviewPanels({
    totalAura: live.totalAura,
    depositSizeDistribution: metrics.depositSizeDistribution,
    auraDistribution: metrics.auraDistribution,
    categoryBreakdown: metrics.categoryBreakdown,
  });

  return (
    // 100vh minus the sticky header plus a small buffer.
    // The one-screen treatment starts at xl, not lg. Side by side at 1024 the
    // right-hand panels get ~365px, and a readable ring plus its three-column
    // legend needs more than that however the gaps are tuned — the ring was
    // collapsing and the names truncating to pay for it. Below xl the panels
    // stack full-width, where both have room, and the page scrolls instead of
    // being held to one screen.
    // min-height rather than a fixed height. A hard height fills a tall
    // screen exactly, which is what it was for, but on a short one it hands
    // each row less than its contents need and the overflow is simply clipped
    // — the distribution panel lost its last tier and its footnote that way at
    // 720px. As a minimum it does the same job wherever there is room and lets
    // the page scroll where there isn't.
    <div className="shell flex flex-col pb-8 pt-[26px] xl:min-h-[calc(100vh-70px)]">
      {/* A strip of headline numbers on top, then the chart grid.

          minmax(0, …) rather than bare fr: an fr track's automatic minimum is
          min-content, so a panel whose contents refuse to shrink past a point
          — the Aura legend has a floor, the distribution chart has one — quietly
          widens its own column and narrows the other. The two rows then stop
          being the same split, which is exactly what put the tier table's
          bullets out of line with the donut above them at 1280. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <KpiStrip />

        {/* One grid for all four cards — Volume, donut, bars, tiers, in that
            order — rather than one grid per row, so the breakpoints can
            regroup them across what used to be the row boundary. The
            distribution panel's wrapper is `display: contents`, which puts its
            two cards straight into this grid as cells; the panel still owns
            both, so hovering a bar lights its tier row and back.

              xl:  Volume | donut      lg:  Volume (full)     below: stacked
                   bars   | tiers           donut | bars
                                            tiers (full)

            At xl the first row takes all the leftover height and the second
            exactly what the six-row table needs — stretching a table only
            pushes its rows apart, while the Volume chart actually improves
            with height. The 320px floor keeps a short window from squeezing that

            row (191px at 1366×768, which capped the donut below its own width
            formula): the page scrolls instead of shrinking the ring. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] xl:grid-rows-[minmax(320px,1fr)_auto]">
          <div className="min-h-0 lg:col-span-2 xl:col-span-1">
            <VolumePanel />
          </div>
          <div className="min-h-0 lg:flex">
            <AuraSourcesPanel
              donut={panels.auraSources.donut}
              totalAuraNumber={panels.auraSources.totalAuraNumber}
            />
          </div>
          <DepositorsDistributionPanel tiers={panels.depositorsAnalysis.tiers} />
        </div>
      </div>
    </div>
  );
}
