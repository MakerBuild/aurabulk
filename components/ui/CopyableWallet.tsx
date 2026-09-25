"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders `display` text with a copy-on-hover button that copies the full
 * `wallet` address. Relies on an ancestor with `className="group"` to reveal
 * the button on hover.
 */
export function CopyableWallet({
  wallet,
  display,
  className,
}: {
  wallet: string;
  display: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied or unavailable — nothing to recover.
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {display}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Wallet address copied" : "Copy wallet address"}
        title={copied ? "Copied!" : "Copy wallet address"}
        className={cn(
          "shrink-0 rounded p-0.5 text-text-secondary opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100",
          copied && "!opacity-100 !text-bid-green"
        )}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}
