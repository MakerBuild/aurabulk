import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/PageHeading";
import { PanelCard } from "@/components/overview/PanelCard";

export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Trade | AURA Intelligence",
  description:
    "Atomic execution with automated delta-neutral hedging. Run capital-efficient strategies in a single transaction.",
};

export default function TradePage() {
  return (
    <div className="shell flex flex-col gap-4 pb-11 pt-5">
      <PageHeading eyebrow="Trade" title="Soon" />
      <PanelCard glossy glossDelay={-11} className="py-8 text-center">
        <p className="mx-auto m-0 max-w-[640px] font-sans text-[13px] leading-relaxed text-text-secondary">
          Atomic execution with automated delta-neutral hedging. Run
          capital-efficient strategies in a single transaction.
        </p>
      </PanelCard>
    </div>
  );
}
