"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  compact?: boolean;
}

interface MenuCoords {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

/**
 * A listbox styled to match the site. The list is portaled to <body> so no
 * card's overflow clips it — which also puts it at the far end of the Tab
 * order, so keyboard use can't rely on tabbing into it. Instead the open list
 * takes focus itself and is driven with the arrow keys, the WAI-ARIA listbox
 * pattern: the list holds focus and `aria-activedescendant` names the option
 * the arrows are on.
 */
export function Select({ value, onChange, options, className, compact }: SelectProps) {
  const [open, setOpen] = useState(false);
  // The option the keyboard (or pointer) is on while the list is open.
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const t = trigger.getBoundingClientRect();
      const margin = 8;
      const gap = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = t.width;
      const left = Math.max(margin, Math.min(t.left, vw - width - margin));
      const spaceBelow = vh - t.bottom - gap - margin;
      const spaceAbove = t.top - gap - margin;
      const openDown = spaceBelow >= 200 || spaceBelow >= spaceAbove;

      setCoords(
        openDown
          ? { top: t.bottom + gap, left, width, maxHeight: Math.max(160, spaceBelow) }
          : { bottom: vh - t.top + gap, left, width, maxHeight: Math.max(160, spaceAbove) }
      );
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, options.length]);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const openList = (index = selectedIndex) => {
    setActiveIndex(Math.max(0, index));
    setOpen(true);
  };

  // Closing from the keyboard hands focus back to the trigger, so it isn't
  // left on a list that is about to unmount.
  const closeList = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    closeList();
  };

  // Focus moves into the list once it is placed: until `coords` lands it is
  // visibility:hidden, and a hidden element refuses focus.
  const placed = coords != null;
  useEffect(() => {
    if (open && placed) listRef.current?.focus({ preventScroll: true });
  }, [open, placed]);

  // Keep the active option in view when the arrows walk past the list's edge.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
        e.preventDefault();
        closeList();
        break;
      case "Tab":
        // Tab leaves the control rather than walking the options.
        e.preventDefault();
        closeList();
        break;
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={cn(
          "flex w-full items-center justify-between gap-2 text-left font-sans transition-colors outline-none",
          compact
            ? "rounded-[10px] border bg-[var(--color-bulk-base)] px-2.5 py-1.5 text-[13px]"
            : "input-field",
          open
            ? "border-accent"
            : compact
              ? "border-[var(--color-line-strong)] hover:border-[rgb(var(--t-accent-rgb)/0.4)]"
              : undefined
        )}
      >
        <span className="min-w-0 truncate text-text-primary">{selected?.label ?? "Select..."}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-text-muted transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.ul
                ref={listRef}
                id={listId}
                role="listbox"
                tabIndex={-1}
                aria-activedescendant={`${listId}-${activeIndex}`}
                onKeyDown={onListKeyDown}
                initial={{ opacity: 0, y: coords?.bottom != null ? 8 : -8, scaleY: 0.96 }}
                animate={{ opacity: 1, y: 0, scaleY: 1 }}
                exit={{ opacity: 0, y: coords?.bottom != null ? 8 : -8, scaleY: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: "fixed",
                  top: coords?.top,
                  bottom: coords?.bottom,
                  left: coords?.left ?? 0,
                  width: coords?.width,
                  maxHeight: coords?.maxHeight,
                  visibility: coords ? "visible" : "hidden",
                  transformOrigin: coords?.bottom != null ? "bottom" : "top",
                }}
                className={cn(
                  "z-50 overflow-x-hidden overflow-y-auto rounded-[10px] outline-none border border-[var(--color-line-strong)] bg-[var(--color-bulk-base)] p-1 font-sans shadow-[0_12px_30px_rgba(0,0,0,0.45)]",
                  compact ? "text-[13px]" : "text-sm"
                )}
              >
                {options.map((o, i) => {
                  const selectedOption = o.value === value;
                  const current = i === activeIndex;
                  return (
                    <li
                      key={o.value}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={selectedOption}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => choose(i)}
                      className={cn(
                        "flex w-full cursor-pointer items-center justify-between rounded-md text-left transition-colors",
                        compact ? "h-[30px] px-2.5" : "px-3 py-2",
                        selectedOption
                          ? "bg-[rgb(var(--t-accent-rgb)/0.12)] text-accent"
                          : current
                            ? "bg-[rgb(var(--t-accent-rgb)/0.06)] text-text-primary"
                            : "text-text-secondary"
                      )}
                    >
                      {o.label}
                      {selectedOption && <Check className="h-3.5 w-3.5" />}
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
