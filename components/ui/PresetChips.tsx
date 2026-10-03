"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * A row of ready-made values under a figure field (Your Aura, position
 * size), drawn as one seamless tray like the site's segmented toggles
 * (`.term-seg`): no box per value, and the picked one carries the pill,
 * which slides to whichever value is picked next. When the field holds a
 * value none of them match, there is no pill until one is picked again.
 *
 * `className` adds layout to the tray, such as a grid on narrow screens.
 */
export function PresetChips<T extends number>({
  values,
  value,
  onPick,
  format,
  className,
}: {
  values: readonly T[];
  value: number;
  onPick: (value: T) => void;
  format: (value: T) => string;
  className?: string;
}) {
  // One per mounted tray: framer moves the pill between elements sharing an
  // id, and two trays on one page must not trade theirs.
  const layoutId = useId();
  return (
    <div className={cn("term-seg w-full", className)}>
      {values.map((preset) => {
        const on = preset === value;
        return (
          <button
            key={preset}
            type="button"
            onClick={() => onPick(preset)}
            aria-pressed={on}
            className={cn("term-seg-btn min-w-0 tabular-nums", on ? "is-on" : "is-off")}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                className="term-seg-pill"
                aria-hidden="true"
                // The segmented toggles' own spring, so every pill on the
                // site moves alike.
                transition={{ type: "spring", stiffness: 480, damping: 32 }}
              />
            )}
            <span className="relative z-10">{format(preset)}</span>
          </button>
        );
      })}
    </div>
  );
}
