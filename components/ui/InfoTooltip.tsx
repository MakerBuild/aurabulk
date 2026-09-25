"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  text: ReactNode;
  panelClassName?: string;
  /** The panel is always portaled, fixed and clamped to the viewport. Still
   * accepted because existing callers pass it; it changes nothing. */
  floating?: true;
}

export function InfoTooltip({ text, panelClassName }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const touchPointer = useRef(false);
  const panelId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const reposition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      const margin = 8;
      const t = trigger.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = t.left + t.width / 2 - p.width / 2;
      left = Math.max(margin, Math.min(left, vw - p.width - margin));

      // Prefer above the trigger; if it would clip, drop below; then clamp.
      let top = t.top - p.height - margin;
      if (top < margin) top = t.bottom + margin;
      if (top + p.height > vh - margin) {
        top = Math.max(margin, vh - p.height - margin);
      }

      setCoords({ top, left });
    };

    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, text]);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={triggerRef}
        type="button"
        aria-label="More information"
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onPointerDown={(event) => {
          touchPointer.current = event.pointerType !== "mouse";
          if (!touchPointer.current) return;
          event.preventDefault();
          setOpen((wasOpen) => !wasOpen);
        }}
        onMouseEnter={() => {
          if (!touchPointer.current) show();
        }}
        onMouseLeave={() => {
          if (!touchPointer.current) hide();
        }}
        onFocus={() => {
          if (!touchPointer.current) show();
        }}
        onBlur={() => {
          if (!touchPointer.current) hide();
        }}
        onClick={(event) => {
          if (event.detail !== 0) return;
          setOpen((wasOpen) => !wasOpen);
        }}
        className="help-dot flex h-[17px] w-[17px] cursor-default items-center justify-center rounded-full border text-[10.5px] font-semibold leading-none transition-colors focus:outline-none"
      >
        ?
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.span
                ref={panelRef}
                id={panelId}
                role="tooltip"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                style={{
                  position: "fixed",
                  top: coords?.top ?? -9999,
                  left: coords?.left ?? -9999,
                  visibility: coords ? "visible" : "hidden",
                }}
                className={cn(
                  "z-50 w-60 rounded-lg border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] p-3 text-left text-xs font-normal leading-relaxed text-text-secondary shadow-[0_12px_30px_rgba(0,0,0,0.45)]",
                  panelClassName
                )}
              >
                {text}
              </motion.span>
            )}
          </AnimatePresence>,
          document.body
        )}
    </span>
  );
}
