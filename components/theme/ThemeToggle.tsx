"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";

/**
 * The sky's half-disc, with the horizon running along its flat edge. The
 * height is exactly half the width — anything else and the arc the bodies
 * ride stops matching the shape they ride inside.
 */
const SKY_W = 48;
const SKY_H = SKY_W / 2;
/** Sun and moon discs. */
const BODY = 15;
/**
 * How far each body rides from the horizon's centre. Its outer edge lands
 * another BODY/2 out, so this plus that has to stay under SKY_H or the body
 * scrapes along the arc instead of travelling inside it.
 */
const ORBIT = 13;

/**
 * Where the two bodies sit on the rotor. The rotor is SKY_W square with the
 * horizon's centre at its own middle, so these put one body directly
 * overhead and the other directly underfoot, half a turn apart.
 */
const BODY_X = (SKY_W - BODY) / 2;
const OVERHEAD_Y = SKY_H - ORBIT - BODY / 2;
const UNDERFOOT_Y = SKY_H + ORBIT - BODY / 2;

function SkyBody({ body, top }: { body: "sun" | "moon"; top: number }) {
  const Icon = body === "sun" ? Sun : Moon;
  return (
    <span
      // Counter-rotates against the rotor, so the crescent stays upright the
      // whole way round instead of arriving on its head.
      //
      // The glow is the only hover the control has left now that there is no
      // edge to light up, and the risen body is the right thing to put it on:
      // it is what the cursor came for.
      className={cn(
        "theme-sky-body absolute flex items-center justify-center rounded-full bg-accent",
        "group-hover:shadow-[0_0_9px_rgb(var(--t-accent-rgb)/0.6)]",
      )}
      style={{ width: BODY, height: BODY, left: BODY_X, top }}
    >
      <Icon size={9} strokeWidth={2.4} className="text-bulk-base" />
    </span>
  );
}

/**
 * Theme switch, as a piece of sky.
 *
 * Both bodies ride one rotor whose centre sits on the horizon, half a turn
 * apart, so one is always overhead and the other always below ground. A
 * click turns the rotor 180°: whichever body is up walks down its own side
 * of the arc until the horizon cuts it off, while the other climbs the
 * opposite side. The sun keeps the right-hand side and the moon the left, in
 * both directions — each rises where it last set.
 *
 * The turn is CSS keyed off `data-theme`, not React state. The blocking
 * script in <head> puts that attribute on <html> before the first paint, so
 * a light-theme visitor's sun is already up when the page appears. Driven
 * from state it could not be: the server has no way to know the theme, so
 * every load would paint the dark sky first and then spin it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isLight}
      // A switch's name stays fixed; aria-checked carries the state.
      aria-label="Light theme"
      title={isLight ? "Dark theme" : "Light theme"}
      onClick={toggleTheme}
      className={cn(
        // overflow-hidden is the horizon: it is what makes a body sink out of
        // sight rather than hang below the flat edge.
        "group relative inline-block shrink-0 overflow-hidden [isolation:isolate]",
        // No outline of its own. The sky is a piece of the page with a well
        // sunk into it, not a control sitting on top of one — an edge drawn
        // round it turns it straight back into a widget.
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      style={{
        width: SKY_W,
        height: SKY_H,
        // Half the width as the top radius, none at the bottom: a true
        // semicircle standing on its diameter.
        borderRadius: `${SKY_H}px ${SKY_H}px 0 0`,
      }}
    >
      {/* All that is left of the container, and all that is needed: the well
          is a shade deeper than the page at the top and meets it at the
          horizon, which is what tells the eye a body is going *behind*
          something rather than being cut in half. The veil token is white on
          the dark theme and near-black on the light one, so one gradient
          serves both. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgb(var(--t-veil-rgb)/0.07), rgb(var(--t-veil-rgb)/0))",
        }}
      />

      {/* The rotor, its centre on the horizon's centre — with no border in
          the way, the padding box its children are placed in is the border
          box, so this needs no correction. */}
      <span
        aria-hidden
        className="theme-sky-rotor pointer-events-none absolute block"
        style={{ width: SKY_W, height: SKY_W, left: 0, top: 0 }}
      >
        {/* Moon overhead at rest: rest is 0°, and 0° is the dark theme. */}
        <SkyBody body="moon" top={OVERHEAD_Y} />
        <SkyBody body="sun" top={UNDERFOOT_Y} />
      </span>
    </button>
  );
}
