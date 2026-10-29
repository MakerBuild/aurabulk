import Link from "next/link";
import { MoveRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The gold arrow in an Overview card's corner that opens the page the card
 * summarises. It nudges toward where it goes while hovered or focused, and
 * its tap area reaches past the mark, given back by margin.
 */
export function CardLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label={`Open ${label}`}
      title={label}
      className={cn("group -m-3 flex p-3 text-[var(--t-accent)] transition-colors hover:text-text-primary", className)}
    >
      <MoveRight
        className="h-4 w-6 group-hover:animate-[arrow-nudge_0.9s_ease-in-out_infinite] group-focus-visible:animate-[arrow-nudge_0.9s_ease-in-out_infinite]"
        strokeWidth={2}
        aria-hidden
      />
    </Link>
  );
}
