"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Check, Download, X } from "lucide-react";
import { buildSnapshotPng, findSnapshotBlocks, type SnapshotBlock } from "@/components/snapshot/snapshot-image";
import { cn } from "@/lib/utils";

type Status = "idle" | "working" | "copied" | "saved" | "failed";

/** Fired by the phone menu's Snapshot item, where the header has no room
 *  for the button itself. */
export const SNAPSHOT_OPEN_EVENT = "bulk:snapshot-open";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function download(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bulk-intelligence-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.png`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Snapshot: pick any cards on the page and get them as one PNG, copied to
 * the clipboard (or saved, where the browser will not allow the copy).
 *
 * The button in the header puts the page into a picking mode: every card
 * gets a selectable frame drawn over it, and a bar at the bottom holds the
 * count and the actions. The frames are an overlay, not styles on the cards,
 * so nothing of the picking UI ends up in the image.
 */
export function SnapshotButton() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [blocks, setBlocks] = useState<SnapshotBlock[]>([]);
  const [selected, setSelected] = useState<Set<HTMLElement>>(new Set());
  const [status, setStatus] = useState<Status>("idle");
  const [, setFrame] = useState(0);
  const [mounted, setMounted] = useState(false);
  const statusTimer = useRef(0);

  useEffect(() => setMounted(true), []);
  useEffect(() => () => window.clearTimeout(statusTimer.current), []);

  const close = useCallback(() => {
    setActive(false);
    setSelected(new Set());
    setStatus("idle");
  }, []);

  // A new page is a new set of cards.
  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    const open = () => setActive(true);
    window.addEventListener(SNAPSHOT_OPEN_EVENT, open);
    return () => window.removeEventListener(SNAPSHOT_OPEN_EVENT, open);
  }, []);

  // While picking: find the cards, keep the frames on them through scroll
  // and resize, and let Escape leave.
  useEffect(() => {
    if (!active) return;
    setBlocks(findSnapshotBlocks());
    let raf = 0;
    const redraw = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setFrame((n) => n + 1);
      });
    };
    const rescan = () => {
      setBlocks(findSnapshotBlocks());
      redraw();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", redraw, { passive: true });
    window.addEventListener("resize", rescan);
    document.addEventListener("keydown", onKey);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", redraw);
      window.removeEventListener("resize", rescan);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, close]);

  function toggle(el: HTMLElement) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(el)) next.delete(el);
      else next.add(el);
      return next;
    });
  }

  // Page order, whatever order they were picked in.
  const picked = blocks.filter((b) => selected.has(b.el)).map((b) => b.el);
  const allPicked = blocks.length > 0 && picked.length === blocks.length;

  function settle(next: Status, thenClose: boolean) {
    setStatus(next);
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => {
      if (thenClose) close();
      else setStatus("idle");
    }, 1400);
  }

  async function copy() {
    if (!picked.length || status === "working") return;
    setStatus("working");
    // Handed to the clipboard as a promise, inside the click: Safari only
    // allows a clipboard write from the gesture itself, and the image takes
    // longer than that to draw.
    const png = buildSnapshotPng(picked);
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      settle("copied", true);
      return;
    } catch {
      // Some browsers want the blob itself, not a promise of it.
    }
    try {
      const blob = await png;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        settle("copied", true);
      } catch {
        download(blob);
        settle("saved", true);
      }
    } catch {
      settle("failed", false);
    }
  }

  async function save() {
    if (!picked.length || status === "working") return;
    setStatus("working");
    try {
      download(await buildSnapshotPng(picked));
      settle("saved", true);
    } catch {
      settle("failed", false);
    }
  }

  const copyLabel =
    status === "working"
      ? "Rendering…"
      : status === "copied"
        ? "Copied"
        : status === "saved"
          ? "Saved"
          : status === "failed"
            ? "Failed"
            : "Copy PNG";

  return (
    <>
      <button
        type="button"
        onClick={() => (active ? close() : setActive(true))}
        aria-pressed={active}
        title="Snapshot: copy cards from this page as an image"
        className={cn(
          // Not on the narrowest phones: there the wordmark needs the room,
          // and Snapshot lives in the Menu instead.
          "hidden h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-lg border transition-colors sm:inline-flex lg:h-auto lg:w-auto lg:border-0 lg:px-0",
          "font-sans text-[12px] font-semibold uppercase tracking-[0.14em]",
          active
            ? "border-accent bg-[rgb(var(--t-accent-rgb)/0.14)] text-accent lg:bg-transparent"
            : "border-[rgb(var(--t-accent-rgb)/0.4)] text-accent lg:text-text-muted lg:hover:text-text-primary",
        )}
      >
        <Camera className="h-[15px] w-[15px]" strokeWidth={2.2} />
        <span className="hidden lg:inline">Snapshot</span>
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {active && (
              <motion.div
                key="snapshot-layer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Frames over each card. Under the sticky header (z-50) so
                    they slide beneath it on scroll like the cards do. */}
                {blocks.map((b) => {
                  const r = b.el.getBoundingClientRect();
                  const on = selected.has(b.el);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggle(b.el)}
                      aria-pressed={on}
                      aria-label={`${on ? "Remove" : "Add"} ${b.label}`}
                      className={cn(
                        "fixed z-40 rounded-[10px] transition-[background-color,box-shadow] duration-200",
                        on
                          ? "bg-[rgb(var(--t-accent-rgb)/0.05)] shadow-[inset_0_0_0_2px_var(--t-accent)]"
                          : "bg-[rgb(var(--t-base-rgb)/0.45)] shadow-[inset_0_0_0_1px_var(--t-line-strong)] hover:bg-[rgb(var(--t-base-rgb)/0.25)]",
                      )}
                      style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
                    >
                      <span
                        className={cn(
                          "absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors",
                          on ? "border-accent bg-accent text-bulk-base" : "border-[var(--t-text-muted)] bg-[var(--t-bg-raised)]",
                        )}
                      >
                        {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}

                <motion.div
                  initial={{ y: 24, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 24, opacity: 0 }}
                  transition={{ duration: 0.36, ease: EASE }}
                  className="fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4"
                >
                  <div className="flex max-w-full items-center gap-2 rounded-full border border-[var(--color-line-strong)] bg-[var(--t-bg-raised)] p-1.5 pl-4 shadow-[0_18px_44px_rgba(0,0,0,0.45)]">
                    <span className="font-label whitespace-nowrap text-text-muted">
                      {picked.length ? `${picked.length} selected` : "Pick cards"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected(allPicked ? new Set() : new Set(blocks.map((b) => b.el)))
                      }
                      className="h-8 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {allPicked ? "None" : "All"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={!picked.length || status === "working"}
                      aria-label="Download PNG"
                      title="Download PNG"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void copy()}
                      disabled={!picked.length || status === "working"}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[12px] font-semibold transition-colors disabled:opacity-40",
                        status === "failed" ? "bg-ask-red text-white" : "bg-accent text-bulk-base",
                      )}
                    >
                      {status === "copied" || status === "saved" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                      {copyLabel}
                    </button>
                    <button
                      type="button"
                      onClick={close}
                      aria-label="Close snapshot"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-primary"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
