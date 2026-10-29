"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const aura = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: n < 10 ? 2 : 0, maximumFractionDigits: n < 10 ? 2 : 0 });

/** Digits typed into a field, as a number: "25,000" reads 25000. */
function parse(text: string): number {
  const n = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Typed digits regrouped as they are typed: "25000" shows "25,000". */
function grouped(text: string): string {
  const clean = text.replace(/[^\d.]/g, "");
  const [whole, ...rest] = clean.split(".");
  const head = whole ? Number(whole).toLocaleString("en-US") : "";
  return rest.length ? `${head}.${rest.join("").slice(0, 2)}` : head;
}

/** A field's width for its text: tabular digits are a `ch` each, the
 *  separators about a third of one. Safari has no field-sizing, so the width
 *  is set rather than left to the browser. */
function fieldWidth(text: string): string {
  const narrow = text.replace(/[^.,]/g, "").length;
  return `calc(${text.length - narrow}ch + ${narrow * 0.34}ch + 1px)`;
}

/** The site's small capitals, for the boxes' and the strip's labels. */
const LABEL = "font-label m-0 shrink-0 leading-none text-text-dim";

/**
 * One input, both built alike: its label over a box, and in the box the
 * figure at the left and its unit at the right, in the label's small
 * capitals (USD, or the days | hours switch). The box is the field: a tap
 * anywhere in it lands in the input, and its border lights while in use.
 */
function InputBox({
  id,
  label,
  trailing,
  value,
  onChange,
  ariaLabel,
}: {
  id: string;
  label: string;
  /** The unit at the value row's right end. */
  trailing: React.ReactNode;
  value: string;
  onChange: (text: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className={cn(LABEL, "mb-2 flex h-3 cursor-text items-center")}>
        {label}
      </label>
      <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-bulk-base)] px-3 py-3 transition-colors focus-within:border-[var(--color-accent)]">
        {/* 18px and up: below 16px iOS zooms into a field. */}
        <label htmlFor={id} className="flex min-w-0 flex-1 cursor-text items-center">
          <input
            id={id}
            aria-label={ariaLabel}
            inputMode="decimal"
            value={value}
            placeholder="0"
            onChange={(e) => onChange(e.target.value)}
            style={{ width: fieldWidth(value || "0") }}
            className={cn(
              "font-figure block h-5 min-w-0 max-w-full appearance-none rounded-none border-0 bg-transparent p-0 leading-none tracking-[-0.01em] text-text-primary shadow-none outline-none tabular-nums [field-sizing:content] placeholder:text-text-dim",
              value.length > 9 ? "text-[18px]" : "text-[20px]",
            )}
          />
        </label>
        <div className="flex h-5 shrink-0 items-center">{trailing}</div>
      </div>
    </div>
  );
}

type HoldUnit = "days" | "hours";

/** Days | Hours, the same switch as Current | Projected on the pool card:
 *  the lit word is the unit the field reads in. Each word's tap area reaches
 *  past it, given back by margin so the value row keeps its height. */
function UnitSwitch({ unit, onChange }: { unit: HoldUnit; onChange: (unit: HoldUnit) => void }) {
  return (
    <span role="radiogroup" aria-label="Hold unit" className="-mr-1 flex shrink-0 items-center sm:-mr-1.5">
      {(["days", "hours"] as const).map((option, i) => (
        <span key={option} className="contents">
          {i > 0 && (
            <span className="font-label leading-none text-text-dim" aria-hidden>
              |
            </span>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={unit === option}
            onClick={() => unit !== option && onChange(option)}
            className={cn(
              "font-label -my-2.5 cursor-pointer border-0 bg-transparent px-1 py-2.5 leading-none transition-colors sm:px-1.5",
              unit === option ? "volume-mode-on" : "volume-mode-off text-text-muted hover:text-text-secondary",
            )}
          >
            {option}
          </button>
        </span>
      ))}
    </span>
  );
}

/**
 * What a position earns from the Open Interest Gauntlet. The
 * reward is split pro rata over $1,000-hours of open interest, and the
 * position joins the pool it is split over: its share is its own $1K-hours
 * over the week's projected eligible $1K-hours plus its own. So a bigger
 * position earns less per dollar, and none takes more than the whole reward.
 * A hold is typed in days or hours and counts up to the whole week, Saturday
 * 13:00 to Saturday 13:00 UTC; a longer one is taken back to the week.
 *
 * The two inputs as boxes side by side, and under them a gold-washed strip
 * with the answer: its label and live tick at the left, the figure at the
 * right. The same at every width.
 */
export function GauntletCalculator({
  reward,
  poolKiloHours,
  weekHours,
}: {
  /** The Gauntlet's whole reward, AURA. */
  reward: number;
  /** The week's projected eligible open interest, in $1,000-hours. */
  poolKiloHours: number;
  /** The longest hold that counts: the whole Gauntlet week. */
  weekHours: number;
}) {
  const sizeId = useId();
  const holdId = useId();
  const [size, setSize] = useState("10,000");
  const [hold, setHold] = useState("1");
  const [unit, setUnit] = useState<HoldUnit>("days");
  const perUnit = unit === "days" ? 24 : 1;
  const holdHours = Math.min(parse(hold) * perUnit, weekHours);
  const yours = (parse(size) / 1000) * holdHours;
  const total = yours > 0 ? (reward * yours) / (poolKiloHours + yours) : 0;
  const share = total / reward;
  const perSecond = holdHours > 0 ? total / (holdHours * 3600) : 0;

  // The live count, written straight to the element each frame rather than
  // through React: it restarts from zero whenever the rate changes.
  const tickRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const started = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const el = tickRef.current;
      if (el) el.textContent = ((perSecond * (now - started)) / 1000).toFixed(6);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [perSecond]);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <InputBox
          id={sizeId}
          label="Position"
          ariaLabel="Position size in USD"
          trailing={<span className="font-label leading-none text-text-muted">USD</span>}
          value={size}
          onChange={(text) => setSize(grouped(text))}
        />
        <InputBox
          id={holdId}
          label="Hold"
          ariaLabel={`Hold in ${unit}`}
          trailing={
            <UnitSwitch
              unit={unit}
              onChange={(next) => {
                // The same hold in the other unit, so switching keeps the estimate.
                if (hold) setHold(String(+(next === "hours" ? holdHours : holdHours / 24).toFixed(2)));
                setUnit(next);
              }}
            />
          }
          value={hold}
          onChange={(text) => {
            const clean = text.replace(/[^\d.]/g, "");
            // Past the week counts as the week, so the field says so.
            const most = weekHours / perUnit;
            setHold(parse(clean) > most ? String(most) : clean);
          }}
        />
      </div>

      {/* The answer, on the boxes' own grid: the same inset, the label in
          their small capitals, and the figure standing on the line the tick
          sits on, its unit in the same capitals as USD. */}
      <div className="flex min-w-0 items-end justify-between gap-3 rounded-lg bg-[rgb(var(--t-accent-rgb)/0.07)] px-3 py-3">
        <div className="flex min-w-0 flex-col">
          <p className={LABEL}>Est. reward</p>
          <p className="font-figure m-0 mt-2 flex min-w-0 items-center gap-2 truncate text-[13px] leading-none tracking-[0.02em] tabular-nums">
            <span className="inline-flex items-center gap-1.5 text-[var(--color-bid-green)]" title="AURA earned since you opened the calculator">
              <span className="relative flex size-1.5 shrink-0" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--color-bid-green)] opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-[var(--color-bid-green)]" />
              </span>
              <span>
                +<span ref={tickRef}>0.000000</span>
              </span>
            </span>
            <span className="h-3 w-px shrink-0 bg-[var(--t-text-dim)]" aria-hidden />
            <span className="text-text-muted">{`${(share * 100).toFixed(share < 0.01 ? 2 : 1)}% of pool`}</span>
          </p>
        </div>
        {/* Its baseline sits 0.1em over its box's foot, the tick's 1.3px:
            the margin lowers it the difference, onto the tick's line. */}
        <p className="m-0 -mb-[1.7px] flex shrink-0 items-baseline gap-2 leading-none">
          <span className="font-figure text-[28px] font-semibold leading-none tracking-[-0.02em] text-accent tabular-nums sm:text-[30px]">
            {aura(total)}
          </span>
          <span className="font-label leading-none text-text-muted">AURA</span>
        </p>
      </div>
    </div>
  );
}
