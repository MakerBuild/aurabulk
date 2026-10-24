import { SwapValue } from "@/components/ui/SwapValue";
import { cn } from "@/lib/utils";

export interface FootStat {
  /** Text, or a node when part of it slides on a switch (SwapValue). */
  label: React.ReactNode;
  /** A shorter label for phones, where a column is a third of the card. */
  phoneLabel?: React.ReactNode;
  /** The figure itself; a unit, when it has one, goes in `unit`. */
  value: string;
  unit?: string;
  tone?: "accent" | "up";
}

/**
 * The row of small figures that closes every Challenger Series card, laid
 * out one way everywhere: a label over a figure and its muted unit, every
 * column reading from its left edge. With a lone figure and an `aside`, the
 * figure takes the left and the aside the right.
 *
 * Every column sits on the row's bottom edge, so figures share one baseline
 * across cards of the same height even when one row holds something taller
 * (the reveal countdown).
 */
export function FootStats({
  stats,
  aside,
  swap = false,
}: {
  stats: FootStat[];
  aside?: React.ReactNode;
  /** Slide each figure and its unit over when the SwapProvider around them
   *  switches, as Execution's values do on a new market. */
  swap?: boolean;
}) {
  const slide = (content: React.ReactNode) => (swap ? <SwapValue>{content}</SwapValue> : content);
  return (
    <div
      className={cn(
        "grid items-end gap-2 border-t border-[var(--color-line)] pt-3",
        aside || stats.length === 3 ? "grid-cols-3" : stats.length === 2 ? "grid-cols-2" : "grid-cols-1",
      )}
    >
      {/* Keyed by column, not label, so a switch keeps the column and only
          slides what is in it. */}
      {stats.map((stat, i) => (
        <div key={i} className="min-w-0 text-left">
          {/* The space under the label is padding, not the figure's margin:
              truncate-safe sets the figure's own block margin and wins. One
              line always: a label wrapping to two stood up over its row on a
              phone, so a long one carries a short phone version instead. */}
          <p className="font-label m-0 truncate pb-2.5 text-text-dim">
            {stat.phoneLabel ? (
              <>
                <span className="sm:hidden">{stat.phoneLabel}</span>
                <span className="hidden sm:inline">{stat.label}</span>
              </>
            ) : (
              stat.label
            )}
          </p>
          <p className="font-data m-0 truncate-safe text-[12px] leading-none tabular-nums">
            {slide(
              <>
                <span
                  className={cn(
                    stat.tone === "accent" && "text-accent",
                    stat.tone === "up" && "text-[var(--color-bid-green)]",
                    !stat.tone && "text-text-primary",
                  )}
                >
                  {stat.value}
                </span>
                {stat.unit && <span className="ml-1 text-text-muted">{stat.unit}</span>}
              </>,
            )}
          </p>
        </div>
      ))}
      {aside && <div className="col-span-2 flex min-w-0 justify-end">{aside}</div>}
    </div>
  );
}
