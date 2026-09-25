"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The sliding-pill toggle used across Overview (`.term-seg` in globals.css).
 * `layoutId` must be unique per mounted toggle: framer-motion animates between
 * any two elements sharing one, so a shared id would fling the pill across
 * the page toward the other toggle.
 */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  className,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  className?: string;
}) {
  return (
    <div className={cn("term-seg", className)}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={on}
            className={cn("term-seg-btn", on ? "is-on" : "is-off")}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                className="term-seg-pill"
                aria-hidden="true"
                transition={{ type: "spring", stiffness: 480, damping: 32 }}
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
