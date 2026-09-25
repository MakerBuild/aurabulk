import { PageHeading } from "@/components/layout/PageHeading";
import { AuraSourcesClient } from "@/components/lookup/AuraSourcesClient";
import { computeDashboardMetrics } from "@/lib/stats";

export const dynamic = "force-static";
export const revalidate = 3600;

export default async function AuraPage() {
  const metrics = await computeDashboardMetrics();

  return (
    <div className="shell flex min-h-[calc(100dvh-61px)] flex-col gap-4 pb-11 pt-5">
      <div className="shrink-0">
        <PageHeading eyebrow="Aura" title="Aura analytics" />
      </div>
      <AuraSourcesClient categoryBreakdown={metrics.categoryBreakdown} />
    </div>
  );
}
