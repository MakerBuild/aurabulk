import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/PageHeading";
import { StatsDashboard } from "@/components/stats/StatsDashboard";

export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Execution | AURA Intelligence",
  description:
    "Live order book and execution costs for every BULK market: two-sided liquidity, cost by order size and fee tiers.",
};

export default function ExecutionPage() {
  return (
    <div className="shell flex flex-col gap-4 pb-11 pt-5">
      <PageHeading eyebrow="Execution" title="Order book & costs" />
      {/* The dashboard polls /api/market-quality itself, so the page stays static. */}
      <StatsDashboard />
    </div>
  );
}
