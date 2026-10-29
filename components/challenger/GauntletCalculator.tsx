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

/** The figure every column shares: the stats' own, so the calculator and the
 *  row under it read at one size. */
const FIGURE = "font-figure text-[13px] leading-none tracking-[0.01em] tabular-nums";
/** Each column's value row: one fixed height with its hairline at the
 *  bottom, so the three lines under it start on one level whatever a field
 *  renders at. */
const VALUE_ROW = "flex h-6 min-w-0 items-end gap-1 border-b pb-1.5";

/** One column: a label over a figure over one short line, as the stats below
 *  are laid out, so the calculator sits on the same three columns. */
function Column({
  label,
  aside,
  children,
  note,
}: {
  label: string;
  /** A control set just after the label, clear of the next column. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  note: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-baseline gap-3 pb-2.5">
        <p className="font-label m-0 truncate text-text-dim">{label}</p>
        {aside}
      </div>
      {children}
      <p className="font-figure m-0 mt-2 flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-none tracking-[0.01em] text-text-muted tabular-nums">
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
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={`${FIGURE} flex min-w-0 items-baseline ${accent ? "text-accent" : "text-text-primary"}`}>
          {prefix}
          <input
            aria-label={label}
            inputMode="decimal"
            value={value}
            placeholder="0"
            readOnly={readOnly}
            tabIndex={readOnly ? -1 : undefined}
            onChange={(e) => onChange?.(e.target.value)}
            size={Math.max(1, value.length)}
            className={`${FIGURE} min-w-0 max-w-full border-0 bg-transparent p-0 text-inherit outline-none [field-sizing:content] placeholder:text-text-dim ${readOnly ? "cursor-default" : ""}`}
          />
        </span>
        {suffix && <span className="font-figure shrink-0 text-[13px] tracking-[0.01em] text-text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

type HoldUnit = "days" | "hours";

/** Days or hours for the hold, in the label row's own type so it sits level
 *  with "Hold". A phone's third of the card shows the initials. */
function UnitSwitch({ unit, onChange }: { unit: HoldUnit; onChange: (unit: HoldUnit) => void }) {
  return (
    <span role="radiogroup" aria-label="Hold unit" className="font-label flex shrink-0 items-baseline gap-1.5">
      {(["days", "hours"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={unit === option}
          onClick={() => unit !== option && onChange(option)}
          className={`cursor-pointer border-0 bg-transparent p-0 uppercase transition-colors ${unit === option ? "text-accent" : "text-text-dim hover:text-text-muted"}`}
        >
          <span className="sm:hidden">{option[0]}</span>
          <span className="hidden sm:inline">{option}</span>
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
 * estimate, under which the AURA it earns ticks up live.
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
    <div className="grid w-full grid-cols-3 items-start gap-2">
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
