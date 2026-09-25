"use client";

import { useRef, useState } from "react";
import { Search, Loader2, X } from "lucide-react";
import type { WalletData } from "@/types";
import { PanelCard } from "@/components/overview/PanelCard";
import { cn } from "@/lib/utils";

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

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
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
      <form
        onSubmit={handleSearch}
        className="mx-auto flex w-full min-w-0 max-w-xl items-center gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Track any wallet…"
            aria-label="Wallet address"
            className={cn(
              "input-field w-full text-[13px]",
              showClear && "hunter-query"
            )}
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="search"
          />
          {showClear && (
            <button
              type="button"
              onClick={clear}
              className="hunter-clear"
              aria-label="Clear wallet"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="btn-primary hunter-search flex shrink-0 items-center justify-center"
          disabled={loading || !address.trim()}
          aria-label="Search wallet"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </button>
      </form>

      {error && (
        <p className="mt-3 text-center font-data text-[13px] text-ask-red">
          {error}
        </p>
      )}
    </PanelCard>
  );
}
