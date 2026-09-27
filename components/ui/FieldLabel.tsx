import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { cn } from "@/lib/utils";

/** The eyebrow over an input — the calculators' and the Stats page's, so a
 *  field reads the same wherever it sits. */
export function FieldLabel({
  label,
  info,
  accent,
  htmlFor,
}: {
  label: string;
  info?: string;
  accent?: boolean;
  htmlFor?: string;
}) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Tag
        htmlFor={htmlFor}
        className={cn("font-label leading-none", accent ? "text-accent" : "text-text-muted")}
      >
        {label}
      </Tag>
      {info ? <InfoTooltip text={info} floating panelClassName="w-64" /> : null}
    </span>
  );
}
