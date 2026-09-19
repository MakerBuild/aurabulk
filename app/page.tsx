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
    depositWallets: live.depositWallets,
    depositSizeDistribution: metrics.depositSizeDistribution,
    auraDistribution: metrics.auraDistribution,
    ogHodlers: metrics.ogHodlers,
    categoryBreakdown: metrics.categoryBreakdown,
  });

  return (
    // 100vh minus the sticky header only now — the site-wide Footer that used
    // to sit below `main` is gone, so this is just the nav's own height (61px)
    // plus a small buffer.
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
      {/* A strip of headline numbers on top, then two chart rows. Both rows
          share one column template — unlike the previous layout, whose rows
          were split differently and so never lined up with each other. Each
          row is flex-1 of the capped height above, so the whole dashboard
          sits on one screen instead of scrolling.

          minmax(0, …) rather than bare fr: an fr track's automatic minimum is
          min-content, so a panel whose contents refuse to shrink past a point
          — the Aura legend has a floor, the distribution chart has one — quietly
          widens its own column and narrows the other. The two rows then stop
          being the same split, which is exactly what put the tier table's
          bullets out of line with the donut above them at 1280. */}
      {/* Wraps both the KPI strip and the chart row so the Current/Projected
          toggle inside the chart can drive the headline figure in the card
          above it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <KpiStrip />

        {/* 1.25 against the depositors row's 1, not an equal share. Both
            rows were flex-1, which split the screen down the middle — and half
            the screen is more than a six-row table needs and less than a chart
            wants. At this ratio the TVL curve gets the height, and the panel
            below settles at roughly four fifths of what it used to take.

            xl:min-h-[280px] on top of that: the depositors panel below is
            fixed to its own content height, not flex, so on a short window
            this row was the only thing left to squeeze — 191px at 1366×768,
            which is what capped the Aura donut to a ring smaller than its own
            width formula allowed. A floor here means the one-screen fit gives
            way instead: the page scrolls a short window rather than
            shrinking the donut down to fit it. */}
        <div className="grid min-h-0 grid-cols-1 gap-5 xl:min-h-[320px] xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="min-h-0">
            <VolumePanel />
          </div>
          <div className="min-h-0 xl:flex">
            <AuraSourcesPanel
              donut={panels.auraSources.donut}
              totalAuraNumber={panels.auraSources.totalAuraNumber}
            />
          </div>
        </div>

        {/* Two cards again, on the same column template as the row above —
            the bars under the TVL curve at its width, the tier table under
            the donut at its. They spent a spell as a single card, which read
            well as one object but split this row at its own ratio, leaving
            the two rows visibly out of step with each other. The pairing
            survives the split: the panel still owns both halves, so hovering
            a bar lights its tier row and back, across the two cards. */}
        {/* No flex-1: this row takes exactly what it contains and no more.
            A table of six fixed-height rows has one right height, and stretching
            it only pushes the footnote away from the rows and pads the bars;
            the chart above is the thing that actually improves with height, so
            the entire remainder goes there. It used to be flex-1 with a 336px
            floor, and between them they took more of the screen than the TVL
            chart, which is what this now gives back. */}
        <div className="min-h-0 xl:flex">
          <DepositorsDistributionPanel tiers={panels.depositorsAnalysis.tiers} />
        </div>
      </div>
    </div>
  );
}
