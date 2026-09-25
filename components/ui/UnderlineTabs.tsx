"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Page-level view switch for a PageHeading card: underlined labels with the
 * same fading 2px accent rule the site nav marks its active section with. */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  // Bumped on every press and used as the underline's key, so the fade
  // restarts even when the tab pressed is the one already open.
  const [pressCount, setPressCount] = useState(0);

  return (
    <div className="flex flex-wrap items-center justify-center gap-7">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              onChange(t.id);
              setPressCount((n) => n + 1);
            }}
            aria-pressed={on}
            className={cn(
              "relative cursor-pointer pb-2.5 text-[13px] font-medium transition-colors",
              on ? "text-accent" : "text-text-muted hover:text-text-primary"
            )}
          >
            {t.label}
            {on && (
              <span
                key={pressCount}
                className="switch-underline pointer-events-none absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[linear-gradient(90deg,transparent_0%,var(--color-accent)_22%,var(--color-accent)_78%,transparent_100%)]"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
