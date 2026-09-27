"use client";

import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The wallet input with the gold search square and its spinning ring — the
 * Aura page's lookup, shared so every wallet field on the site is this one.
 * The form is the caller's: it decides what a search does.
 */
export function WalletSearchField({
  value,
  onChange,
  onSubmit,
  onClear,
  loading,
  showClear,
  placeholder = "Track any wallet…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  loading: boolean;
  /** The clear button shows while there is a query or a result to drop. */
  showClear: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit();
      }}
      className={cn("flex w-full min-w-0 items-center gap-2", className)}
    >
      <div className="relative min-w-0 flex-1">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Wallet address"
          className={cn("input-field w-full text-[13px]", showClear && "hunter-query")}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
        />
        {showClear && (
          <button type="button" onClick={onClear} className="hunter-clear" aria-label="Clear wallet">
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>
      <button
        type="submit"
        className="btn-primary hunter-search flex shrink-0 items-center justify-center"
        disabled={loading || !value.trim()}
        aria-label="Search wallet"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
      </button>
    </form>
  );
}
