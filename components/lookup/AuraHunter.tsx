"use client";

import { useRef, useState } from "react";
import type { WalletData } from "@/types";
import { PanelCard } from "@/components/overview/PanelCard";
import { WalletSearchField } from "@/components/ui/WalletSearchField";

/**
 * Wallet lookup that drives the Aura analytics panel transform —
 * personal donut + Aura Stats replace the global charts on success.
 */
export function AuraHunter({
  onResult,
  result,
}: {
  onResult: (data: WalletData | null) => void;
  result: WalletData | null;
}) {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the newest lookup may write; an older one finishing late is dropped.
  const requestId = useRef(0);

  const showClear = Boolean(address.trim() || result);

  async function handleSearch() {
    if (!address.trim()) return;

    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    onResult(null);

    try {
      const res = await fetch(
        `/api/wallet?address=${encodeURIComponent(address.trim())}`
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? (res.status === 404 ? "Wallet not found" : "Lookup failed"));
      }
      const data = (await res.json()) as WalletData;
      if (id === requestId.current) onResult(data);
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof Error && !(err instanceof SyntaxError) ? err.message : "Lookup failed");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function clear() {
    requestId.current += 1;
    setLoading(false);
    setAddress("");
    setError(null);
    onResult(null);
  }

  return (
    <PanelCard glossy glossDelay={-3}>
      <WalletSearchField
        value={address}
        onChange={setAddress}
        onSubmit={() => void handleSearch()}
        onClear={clear}
        loading={loading}
        showClear={showClear}
        className="mx-auto max-w-xl"
      />

      {error && (
        <p className="mt-3 text-center font-data text-[13px] text-ask-red">
          {error}
        </p>
      )}
    </PanelCard>
  );
}
