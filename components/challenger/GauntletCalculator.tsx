"use client";

import { useEffect, useRef, useState } from "react";

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
 *  separators about a third of one. */
function fieldWidth(text: string): string {
  const narrow = text.replace(/[^.,]/g, "").length;
  return `calc(${text.length - narrow}ch + ${narrow * 0.34}ch + 1px)`;
}

/** The figure every column shares: the stats' own from sm up, so the
 *  calculator and the row under it read at one size. On a phone 20px, big
 *  enough to type into and over the 16px below which iOS zooms into a field. */
const FIGURE = "font-figure text-[20px] leading-none tracking-[0.01em] tabular-nums sm:text-[13px]";
/** Each column's value row: one fixed height with its hairline at the
 *  bottom, so the three lines under it start on one level whatever a field
 *  renders at. A thumb's height on a phone; the whole row takes the tap. */
const VALUE_ROW = "flex h-12 min-w-0 items-end gap-1 border-b pb-2 sm:h-6 sm:pb-1.5";

/** One column: a label over a figure over one short line, as the stats below
 *  are laid out, so the calculator sits on the same three columns. */
function Column({
  label,
  aside,
  children,
  note,
  className,
}: {
  className?: string;
  label: string;
  /** A control set just after the label, clear of the next column. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  note: React.ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col ${className ?? ""}`}>
      {/* One fixed height, whatever stands in it: the unit switch's larger
          word made the Hold row taller than its neighbours on iOS. */}
      <div className="mb-2.5 flex h-3 min-w-0 items-center gap-3">
        <p className="font-label m-0 truncate leading-none text-text-dim">{label}</p>
        {aside}
      </div>
      {children}
      <p className="font-figure m-0 mt-2 flex min-w-0 items-center gap-1.5 truncate text-[15px] leading-none tracking-[0.01em] text-text-muted tabular-nums sm:text-[13px]">
        {note}
      </p>
    </div>
  );
}

/**
 * A column's figure: no box, a hairline under it that lights on focus. The
 * estimate is one too, read-only, so all three sit on one baseline and one
 * hairline. A currency sign is part of the figure, as "$15.14M" is in the
 * stats below; a unit follows it small and muted, the same for every column.
 */
function FigureInput({
  value,
  onChange,
  prefix,
  suffix,
  label,
  readOnly = false,
  accent = false,
}: {
  value: string;
  onChange?: (text: string) => void;
  prefix?: string;
  suffix?: string;
  label: string;
  readOnly?: boolean;
  accent?: boolean;
}) {
  return (
    <label
      className={`${VALUE_ROW} border-[var(--color-line-strong)] transition-colors ${readOnly ? "" : "focus-within:border-[var(--color-accent)]"}`}
    >
      {/* Bottom-aligned boxes of line-height 1, not baselines: Safari puts an
          input's baseline elsewhere than Chrome, so a field without a "$"
          before it (the hold) sat lower on an iPhone than one with. */}
      <span className="flex min-w-0 items-end gap-1.5">
        <span className={`${FIGURE} flex min-w-0 items-end ${accent ? "text-accent" : "text-text-primary"}`}>
          {prefix && <span className="leading-none">{prefix}</span>}
          <input
            aria-label={label}
            inputMode="decimal"
            value={value}
            placeholder="0"
            readOnly={readOnly}
            tabIndex={readOnly ? -1 : undefined}
            onChange={(e) => onChange?.(e.target.value)}
            // Sized to its text: Safari has no field-sizing, and its
            // \`size\` width left a gap before the unit on an iPhone.
            style={{ width: fieldWidth(value || "0") }}
            className={`${FIGURE} block h-[1em] min-w-0 max-w-full appearance-none rounded-none border-0 bg-transparent p-0 text-inherit shadow-none outline-none [field-sizing:content] placeholder:text-text-dim ${readOnly ? "cursor-default" : ""}`}
          />
        </span>
        {suffix && (
          <span className="font-figure shrink-0 pb-px text-[15px] leading-none tracking-[0.01em] text-text-muted sm:text-[13px]">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

type HoldUnit = "days" | "hours";

/** Days or hours for the hold, in the label row's own type so it sits level
 *  with "Hold". Each option's tap area reaches past its word, padding taken
 *  back by margin so the row keeps its height. */
function UnitSwitch({ unit, onChange }: { unit: HoldUnit; onChange: (unit: HoldUnit) => void }) {
  return (
    <span role="radiogroup" aria-label="Hold unit" className="font-label flex shrink-0 items-center">
      {(["days", "hours"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={unit === option}
          onClick={() => unit !== option && onChange(option)}
          className={`-my-3 cursor-pointer border-0 bg-transparent px-2 py-3 text-[11.5px] leading-none uppercase transition-colors first:-ml-2 sm:-my-1 sm:px-1 sm:py-1 sm:text-[9.5px] sm:first:-ml-1 ${unit === option ? "text-accent" : "text-text-dim hover:text-text-muted"}`}
        >
          {option}
        </button>
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
 * 13:00 to Saturday 13:00 UTC.
 *
 * Laid out on the card's three stat columns: the size, the hold, and the
 * estimate, under which the AURA it earns ticks up live. A phone's third of
 * the card is too narrow to type into, so there the size and hold share a
 * row and the estimate takes the next one whole.
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
  const [size, setSize] = useState("10,000");
  const [hold, setHold] = useState("1");
  const [unit, setUnit] = useState<HoldUnit>("days");
  const askedHours = parse(hold) * (unit === "days" ? 24 : 1);
  const holdHours = Math.min(askedHours, weekHours);
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
    <div className="grid w-full grid-cols-2 items-start gap-x-5 gap-y-5 sm:grid-cols-3 sm:gap-2">
      <Column label="Position" note={`${(share * 100).toFixed(share < 0.01 ? 2 : 1)}% of pool`}>
        <FigureInput label="Position size in USD" prefix="$" value={size} onChange={(text) => setSize(grouped(text))} />
      </Column>
      <Column
        label="Hold"
        aside={
          <UnitSwitch
            unit={unit}
            onChange={(next) => {
              // The same hold in the other unit, so switching keeps the estimate.
              if (hold) setHold(String(+(next === "hours" ? askedHours : askedHours / 24).toFixed(2)));
              setUnit(next);
            }}
          />
        }
        note={
          askedHours > weekHours
            ? "Counts 7 days, the week"
            : unit === "days"
              ? `${+holdHours.toFixed(1)}h of ${weekHours}h`
              : `${+(holdHours / 24).toFixed(2)} of 7 days`
        }
      >
        <FigureInput
          label={`Hold in ${unit}`}
          suffix={parse(hold) === 1 ? unit.slice(0, -1) : unit}
          value={hold}
          onChange={(text) => setHold(text.replace(/[^\d.]/g, ""))}
        />
      </Column>
      <Column
        className="col-span-2 sm:col-span-1"
        label="Est. reward"
        note={
          <>
            <span className="relative flex size-1.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--color-bid-green)] opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[var(--color-bid-green)]" />
            </span>
            <span className="text-[var(--color-bid-green)]" title="AURA earned since you opened the calculator">
              +<span ref={tickRef}>0.000000</span>
            </span>
          </>
        }
      >
        <FigureInput label="Estimated reward in AURA" value={aura(total)} suffix="AURA" readOnly accent />
      </Column>
    </div>
  );
}
