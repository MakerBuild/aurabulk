import type { OverviewDonutSegment } from "@/lib/overview-metrics";
import { AURA_SOURCES_DONUT_WELL, AuraDonut } from "@/components/overview/AuraDonut";
import { PanelCard } from "@/components/overview/PanelCard";
import { CardLink } from "@/components/overview/CardLink";

export function AuraSourcesPanel({
  donut,
  totalAuraNumber,
}: {
  donut: OverviewDonutSegment[];
  totalAuraNumber: number;
}) {
  return (
    <PanelCard className="h-full flex-1" glossy glossDelay={-8}>
      {/* To the Aura page, in the corner as on the ranks card. Laid over the
          card rather than given a row, which the donut would lose height to,
          and as far from the top as the ranks card centres its own. */}
      <CardLink href="/aura" label="Aura" className="absolute right-0 top-1.5 z-10" />
      {/* No PanelLabel here — same reasoning as Depositors by Tier: the
          "Category / Aura / Share" header row already identifies the table,
          and the donut sizes itself off however much vertical room this
          panel has, so the title's own line was a few more px it wasn't
          getting. */}
      {/* items-stretch (the default), not items-center: the donut measures
          this row's height to size itself, and centring would collapse it to
          its own content height — leaving the ring only as tall as the
          legend beside it. It does its own vertical centring inside.

          minHeight matches Aura's Source Breakdown well so the first measure
          is already close to the final box — without it this panel collapses
          toward the legend while Volume next door is still "Loading…", and
          the entrance wipe starts on a size that will not survive. */}
      {donut.length > 0 && (
        <div
          className="flex min-h-0 flex-1"
          style={{ minHeight: AURA_SOURCES_DONUT_WELL }}
        >
          <AuraDonut segments={donut} totalAuraNumber={totalAuraNumber} />
        </div>
      )}
    </PanelCard>
  );
}
