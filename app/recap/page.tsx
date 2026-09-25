"use client";

import { useRef } from "react";
import { PreDepositsRecapCard } from "@/components/recap/PreDepositsRecapCard";
import { CopyCardPngButton } from "@/components/recap/CopyCardPngButton";

export default function RecapPage() {
  const exportRef = useRef<HTMLDivElement>(null);

  return (
    <div className="shell flex flex-col items-center gap-6 py-10">
      <div className="flex w-full max-w-[1200px] items-center justify-between gap-4">
        <div>
          <h1 className="font-figure m-0 text-xl text-text-primary">Pre-Deposits Recap</h1>
          <p className="font-data m-0 mt-1 text-sm text-text-muted">
            Share card — copy PNG or screenshot below.
          </p>
        </div>
        <CopyCardPngButton
          exportRef={exportRef}
          filename="bulk-pre-deposits-recap"
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-bulk-base)] px-3 py-2"
        />
      </div>

      <div className="overflow-x-auto pb-4">
        <div ref={exportRef}>
          <PreDepositsRecapCard />
        </div>
      </div>
    </div>
  );
}
