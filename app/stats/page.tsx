import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/PageHeading";
import { StatsDashboard } from "@/components/stats/StatsDashboard";

export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Stats | AURA Intelligence",
  description:
    "Live execution and trading data for every BULK market: order book depth, execution cost by size and fee tiers.",
};

export default function StatsPage() {
  return (
    <div className="shell flex flex-col gap-4 pb-11 pt-5">
      <PageHeading eyebrow="Stats" title="Execution & trading" />
      {/* The dashboard polls /api/market-quality itself, so the page stays static. */}
      <StatsDashboard />
    </div>
  );
}
