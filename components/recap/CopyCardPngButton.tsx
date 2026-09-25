"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, Copy } from "lucide-react";
import { toPng } from "html-to-image";
import { cn } from "@/lib/utils";

interface CopyCardPngButtonProps {
  exportRef: RefObject<HTMLElement | null>;
  filename: string;
  className?: string;
}

type CopyStatus = "idle" | "copying" | "copied" | "failed";

export function CopyCardPngButton({ exportRef, filename, className }: CopyCardPngButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  async function copyPng() {
    if (!exportRef.current || status === "copying") return;

    window.clearTimeout(resetTimer.current);
    setStatus("copying");

    let next: CopyStatus = "copied";
    try {
      // Match the live theme rather than a baked-in dark, so a light-mode
      // export does not come back on a near-black plate.
      const themeBg = getComputedStyle(document.documentElement)
        .getPropertyValue("--t-base")
        .trim();
      const dataUrl = await toPng(exportRef.current, {
        pixelRatio: 2,
        backgroundColor: themeBg || "#1b1a14",
        cacheBust: true,
        skipFonts: true,
      });
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch {
      next = "failed";
    }
    setStatus(next);
    resetTimer.current = window.setTimeout(
      () => setStatus("idle"),
      next === "copied" ? 2000 : 2500
    );
  }

  const copied = status === "copied";
  const label = copied ? "Copied!" : status === "failed" ? "Copy failed" : "Copy PNG";

  return (
    <button
      type="button"
      onClick={copyPng}
      disabled={status === "copying"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:text-text-primary",
        className
      )}
      title={`Copy ${filename} as PNG`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-bid-green" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}
