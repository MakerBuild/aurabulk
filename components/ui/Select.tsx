"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { RowHighlight } from "@/components/ui/RowHighlight";
import { dropdownMotion, dropdownRow } from "@/components/ui/dropdown-motion";

export interface SelectOption {
  value: string;
  label: string;
}

interface CommonProps {
  options: SelectOption[];
  className?: string;
  compact?: boolean;
  /** Just the label and its chevron, no box, set in the site's label type:
   *  for a setting sat in a heading among other labels.
   *  The list then opens at least LIST_MIN_WIDTH wide, aligned to the
   *  trigger's right edge. */
  bare?: boolean;
}

/** One value: picking an option closes the list. */
interface SingleProps extends CommonProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}

/** Any number of values: picking an option ticks or unticks it and the list
 *  stays open. The trigger shows `summary`, since no one label names the
 *  choice. */
interface MultipleProps extends CommonProps {
  multiple: true;
  values: string[];
  onChange: (values: string[]) => void;
  summary: string;
}

type SelectProps = SingleProps | MultipleProps;

/** The narrowest a bare trigger's list opens, so its options are not cut to
 *  the width of a short label. */
const LIST_MIN_WIDTH = 168;

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
export function Select(props: SelectProps) {
  const { options, className, compact, bare } = props;
  const isPicked = (o: SelectOption) => (props.multiple ? props.values.includes(o.value) : o.value === props.value);
  const [open, setOpen] = useState(false);
  // The option the keyboard (or pointer) is on while the list is open.
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const opensUpward = coords?.bottom != null;
  const rowVariants = dropdownRow(opensUpward);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const optionEls = useRef<(HTMLLIElement | null)[]>([]);

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
      const width = bare ? Math.max(t.width, LIST_MIN_WIDTH) : t.width;
      const left = Math.max(margin, Math.min(bare ? t.right - width : t.left, vw - width - margin));
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
  }, [open, options.length, bare]);

  const selectedIndex = props.multiple ? 0 : options.findIndex((o) => o.value === props.value);
  const selected = props.multiple ? undefined : options[selectedIndex];

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
    if (props.multiple) {
      if (!option) return;
      const on = props.values.includes(option.value);
      // Kept in the options' order, whatever order they were ticked in.
      props.onChange(options.filter((o) => (o === option ? !on : props.values.includes(o.value))).map((o) => o.value));
      return;
    }
    if (option) props.onChange(option.value);
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
          bare
            ? "group gap-1 py-1 focus-visible:text-accent"
            : compact
              ? "rounded-[10px] border bg-[var(--color-bulk-base)] px-2.5 py-1.5 text-[13px]"
              : "input-field",
          !bare &&
            (open
              ? "border-accent"
              : compact
                ? "border-[var(--color-line-strong)] hover:border-[rgb(var(--t-accent-rgb)/0.4)]"
                : undefined)
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate transition-colors",
            bare
              ? cn("font-label leading-none", open ? "text-accent" : "text-text-muted group-hover:text-text-primary")
              : "text-text-primary"
          )}
        >
          {props.multiple ? props.summary : (selected?.label ?? "Select...")}
        </span>
        <ChevronDown
          className={cn(
            "shrink-0 transition-transform duration-200",
            bare ? "h-3 w-3" : "h-4 w-4",
            bare && open ? "text-accent" : "text-text-muted",
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
                aria-multiselectable={props.multiple || undefined}
                tabIndex={-1}
                aria-activedescendant={`${listId}-${activeIndex}`}
                onKeyDown={onListKeyDown}
                // The site's dropdown motion: the panel drifts in from the
                // edge it hangs off and the options step down after it.
                {...dropdownMotion(opensUpward)}
                style={{
                  position: "fixed",
                  top: coords?.top,
                  bottom: coords?.bottom,
                  left: coords?.left ?? 0,
                  width: coords?.width,
                  maxHeight: coords?.maxHeight,
                  visibility: coords ? "visible" : "hidden",
                }}
                className={cn(
                  "isolate z-50 overflow-x-hidden overflow-y-auto rounded-[10px] outline-none border border-[var(--color-line-strong)] bg-[var(--color-bulk-base)] p-1 font-sans shadow-[var(--t-shadow-pop)]",
                  compact ? "text-[13px]" : "text-sm"
                )}
              >
                {/* The same sliding box the tables use: it glides to the option
                    the pointer or the arrows are on instead of each option
                    lighting its own background. */}
                <RowHighlight
                  containerRef={listRef}
                  target={optionEls.current[activeIndex] ?? null}
                />
                {options.map((o, i) => {
                  const selectedOption = isPicked(o);
                  const current = i === activeIndex;
                  return (
                    <li
                      key={o.value}
                      ref={(el) => {
                        optionEls.current[i] = el;
                      }}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={selectedOption}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => choose(i)}
                      className={cn(
                        "flex w-full cursor-pointer items-center justify-between text-left transition-colors",
                        compact ? "h-[30px] px-2.5" : "px-3 py-2",
                        selectedOption
                          ? "text-accent"
                          : current
                            ? "text-text-primary"
                            : "text-text-secondary"
                      )}
                    >
                      {/* The step is on the content, not the option: the
                          highlight measures the option, and has to find it
                          where it will be, not mid-step. */}
                      <motion.span
                        // Nearest the trigger first, whichever way it opens.
                        custom={opensUpward ? options.length - 1 - i : i}
                        variants={rowVariants}
                        className="flex w-full items-center justify-between"
                      >
                        {o.label}
                        {selectedOption && <Check className="h-3.5 w-3.5" />}
                      </motion.span>
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
