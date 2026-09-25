"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { HeaderCampaignStatus } from "@/components/layout/HeaderCampaignStatus";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
}

/** Every entry is a plain link now. Aura and Tools used to open submenus; the
 * Tools one pointed at #anchors this site never had, and both put a second
 * layer of navigation over pages that each hold one screen of content. */
const NAV: NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/aura", label: "Aura" },
  { href: "/tools", label: "Tools" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/trade", label: "Trade" },
];

/** A section is active for its own route and anything nested beneath it. */
function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  const section = `/${item.href.split("/")[1]}`;
  return pathname === section || pathname.startsWith(`${section}/`);
}

export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Hidden mobile-menu links are out of the viewport, so Next does not
  // prefetch them on its own. Warm every section once the shell is up.
  useEffect(() => {
    for (const item of NAV) {
      router.prefetch(item.href);
    }
  }, [router]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-line)] bg-[rgb(var(--t-base-rgb)/0.92)] backdrop-blur-[10px]">
      <div className="shell flex min-h-[60px] items-center justify-between gap-x-3 py-[11px] sm:gap-x-[26px]">
        <div className="flex min-w-0 items-center gap-[26px]">
          <Link href="/" className="flex min-w-0 items-center gap-[11px] text-text-primary">
            {/* Both marks ship; CSS shows the one the theme calls for. */}
            <span className="hidden sm:block">
              <Image
                src="/logos/bulkx-logo-light.svg"
                alt="BULK"
                width={83}
                height={32}
                priority
                className="logo-ink-light"
              />
              <Image
                src="/logos/bulkx-logo-dark.svg"
                alt=""
                aria-hidden
                width={83}
                height={32}
                priority
                className="logo-ink-dark"
              />
            </span>
            {/* Truncates rather than holding its width. The corner opposite
                carries the switch, the week clock and the Menu button, none
                of which shrink; without this the wordmark keeps its full
                length and that row rides over it instead of pushing it. */}
            <span className="font-sans truncate text-[14px] font-semibold tracking-[-0.02em] text-text-secondary sm:text-[17px]">
              INTELLIGENCE
            </span>
          </Link>

          <span className="hidden h-[22px] w-px shrink-0 bg-[var(--color-line-strong)] lg:block" aria-hidden />

          <nav className="hidden min-w-0 flex-wrap items-center gap-[26px] lg:flex">
            {NAV.map((item) => {
              const active = isActive(pathname, item);
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "site-nav-link font-sans relative py-[6px] text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors",
                      active ? "text-accent" : "text-text-muted hover:text-text-primary"
                    )}
                    data-active={active || undefined}
                  >
                    {item.label}
                  </Link>
                </div>
              );
            })}
          </nav>
        </div>

        {/* shrink-0 because nothing in here can give: the switch, the ticks
            and the Menu button all hold their size. Without it flexbox still
            hands this side a box narrower than its contents, and `justify-end`
            spills the overflow leftwards over the wordmark. Refusing to shrink
            sends the shortfall to the wordmark instead, which can truncate. */}
        <div className="flex shrink-0 items-center justify-end gap-2.5 sm:gap-[18px]">
          <HeaderCampaignStatus />

          {/* Flattened nav for narrow screens, where the inline bar is hidden. */}
          <div ref={menuRef} className="relative lg:hidden">
            <button
              ref={menuButtonRef}
              type="button"
              aria-expanded={menuOpen}
              aria-controls="site-nav-menu"
              onClick={() => setMenuOpen((open) => !open)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] transition-colors",
                menuOpen
                  ? "border-accent bg-[rgb(var(--t-accent-rgb)/0.14)] text-accent"
                  : "border-[rgb(var(--t-accent-rgb)/0.4)] text-accent"
              )}
            >
              Menu
              <ChevronDown
                className={cn(
                  "h-[13px] w-[13px] transition-transform duration-200",
                  menuOpen && "rotate-180"
                )}
                strokeWidth={2.4}
              />
            </button>
            {/* inert while closed: it is only faded out, and its links must
                not stay reachable by Tab or screen reader. */}
            <nav
              id="site-nav-menu"
              aria-label="Sections"
              inert={!menuOpen}
              className={cn(
                "absolute right-0 top-full z-[60] mt-2 min-w-[220px] origin-top-right rounded-[10px] border border-[rgb(var(--t-accent-rgb)/0.22)] bg-[var(--color-bulk-base)] p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.72)] transition-[opacity,transform] duration-150",
                menuOpen
                  ? "pointer-events-auto scale-100 opacity-100"
                  : "pointer-events-none scale-[0.98] opacity-0"
              )}
            >
              {NAV.map((link) => {
                const active = isActive(pathname, link);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative block rounded-md px-3 py-2.5 text-[13px] transition-colors",
                      active
                        ? "bg-[rgb(var(--t-accent-rgb)/0.12)] font-medium text-accent"
                        : "text-text-primary hover:bg-[rgb(var(--t-accent-rgb)/0.08)] hover:text-accent"
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-full bg-accent"
                      />
                    )}
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
