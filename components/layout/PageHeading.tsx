import { cn } from "@/lib/utils";
import { PanelCard } from "@/components/overview/PanelCard";

/** Centred heading card that opens every section page: large title, the
 * eyebrow as a faint watermark behind it, and optional controls under it. */
export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  /** Rendered inside the card, under the title — for a control that belongs
   * to the heading rather than to the content below it, such as the tabs
   * choosing which tool the page is showing. */
  children?: React.ReactNode;
}) {
  // No bottom margin on the wrapper: this card sits in a flex column that
  // already sets the gap between blocks, and a margin stacked on top of that
  // made the space under the heading wider than the one between the cards
  // below it.
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {/* The same shell every panel on the site uses — PanelCard, not a
          hand-rolled box: one border colour, one radius, one background, and
          the drifting highlight already clipped to the card by its own
          overflow. Built by hand this block ended up with a gloss layer
          whose edges showed as seams the other cards do not have.

          The watermark is clipped by the card (overflow-hidden), so the
          big word never bleeds under the nav or past the block's edges. */}
      <PanelCard glossy glossDelay={-16} className="w-full overflow-hidden py-8 text-center sm:py-8">
        {/* The watermark is centred on the title itself, not on the card: a
            card with tabs under its title is taller, and centring on the card
            dropped TOOLS below the heading it belongs to. */}
        <div className="relative">
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
              "whitespace-nowrap font-semibold uppercase tracking-[0.02em]",
              // Faint enough that the big shape stays texture, not a second
              // headline. Trimmed to its capitals so it is the letters, not
              // the line box around them, that sit on the title's centre.
              // On a phone the word is limited by width, not height: sized to
              // fit, its capitals are no taller than a two-line title and the
              // title hides it. So it goes bigger than the card there and
              // bleeds off both edges, clipped, to stand clear above and
              // below the title.
              "text-[150px] sm:text-[clamp(108px,22.5vw,285px)] text-[rgb(var(--t-accent-rgb)/0.05)] [text-box:trim-both_cap_alphabetic]"
            )}
            // Inline, not utilities: tailwind-merge drops `leading-none`
            // next to an arbitrary text-[…] size. The negative margin cancels
            // the trailing letter-spacing so the glyphs, not the space after
            // the last letter, are what gets centred.
            style={{ lineHeight: 1, marginRight: "-0.02em" }}
          >
            {eyebrow}
          </span>
          {/* Fluid from sm up: at the top of the range this is the largest
              solid type on the site. On a phone it steps down so a two-line
              title covers less of the watermark than the watermark's own
              height — it shows above and below, as it does on a desktop.
              Uppercase, so the tracking goes positive. */}
          <h1 className="relative m-0 text-center text-[24px] font-semibold uppercase leading-tight tracking-[0.01em] text-text-primary sm:text-[clamp(32px,3.2vw,44px)]">
            {title}
          </h1>
        </div>
        {/* Tab strip only when the page actually has switches (Tools /
            Leaderboards). An empty reserve left Aura / Trade with a dead
            band under the title and made those headers look inflated. */}
        {children ? (
          <div className="relative mt-7 -mb-8 flex min-h-[30px] items-end justify-center">
            {children}
          </div>
        ) : null}
      </PanelCard>
    </div>
  );
}
