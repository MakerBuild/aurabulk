"use client";

import { createContext, useContext, type ReactNode } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";

interface SwapState {
  /** What the values on screen belong to — a market, here. A change of key
   *  is what slides them; a value changing under the same key just updates. */
  swapKey: string;
  /** Where the next values come from: 1 enters from the right and travels
   *  left, −1 enters from the left and travels right. */
  direction: 1 | -1;
  /** The next key's values are on their way; the current ones fade back. */
  pending: boolean;
}

const SwapContext = createContext<SwapState>({ swapKey: "", direction: 1, pending: false });

export function SwapProvider({ children, ...state }: SwapState & { children: ReactNode }) {
  return <SwapContext.Provider value={state}>{children}</SwapContext.Provider>;
}

const DISTANCE = 14;
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Out quick and short, then in with the full glide. The old value is gone
 *  before the new one appears, so the two never overlap and blur together. */
const variants: Variants = {
  enter: (dir: number) => ({ x: dir * DISTANCE, opacity: 0 }),
  center: {
    x: 0,
    opacity: 1,
    transition: { x: { duration: 0.34, ease: EASE }, opacity: { duration: 0.22, ease: "easeOut" } },
  },
  exit: (dir: number) => ({
    x: -dir * (DISTANCE * 0.6),
    opacity: 0,
    transition: { duration: 0.14, ease: "easeIn" },
  }),
};

/**
 * One value that slides over when what it describes changes: the old
 * figure leaves one way, then the new one arrives from the other. Only the
 * value moves; the label, the chart and the layout around it stay still.
 *
 * The swap is sequential ("wait"): old values drawn on top of new ones read
 * as a smear of two numbers. The value sits in a one-cell grid so it keeps
 * its alignment (left, right or centred) on the way in and out.
 */
export function SwapValue({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode;
  className?: string;
  /** Layout for the moving content itself, e.g. a flex row with an icon. */
  innerClassName?: string;
}) {
  const { swapKey, direction, pending } = useContext(SwapContext);
  return (
    <span className={cn("inline-grid min-w-0 transition-opacity duration-200", pending && "opacity-50", className)}>
      <AnimatePresence initial={false} custom={direction} mode="wait">
        <motion.span
          key={swapKey}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          className={cn("[grid-area:1/1] min-w-0", innerClassName)}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
