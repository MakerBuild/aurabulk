"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  type Theme,
} from "@/lib/theme";

/**
 * How long the page takes to come up through the ground it is leaving. Has
 * to cover the wave in globals.css that this mounts — unmounting early would
 * cut the front off mid-travel and snap the rest of the palette in.
 */
const SHIFT_MS = 1450;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}

interface Shift {
  /** Fresh per swap, so each overlay is a new element and restarts its run. */
  key: number;
  /** The base colour the page is leaving, as the veil paints it. */
  from: string;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Server renders the default; the pre-paint script in <head> has already
  // put the real theme on <html>. Reading it back in an effect keeps React's
  // state in step without making the first paint depend on hydration.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [shift, setShift] = useState<Shift | null>(null);
  const shiftKey = useRef(0);
  const shiftTimer = useRef(0);

  useEffect(() => {
    const onElement = document.documentElement.dataset.theme;
    if (isTheme(onElement)) setThemeState(onElement);
  }, []);

  useEffect(() => () => window.clearTimeout(shiftTimer.current), []);

  /**
   * Swap the palette under a veil of the colour being left, rather than in
   * one frame. Black to white in a single frame is the whole complaint: the
   * eye has nothing to follow and has to re-adapt from scratch.
   *
   * The obvious way to do this is a transition on the colours themselves,
   * and that was the first attempt. It is far too expensive: every element
   * on the page interpolating a colour at once took the switch from ~90fps
   * down to about 20, which is worse to look at than the snap it replaced.
   * Fading one full-screen layer instead is a single composited animation —
   * measured free — and the eye reads it the same way, because what it is
   * actually following is the change in overall brightness.
   */
  const crossFadeTo = useCallback((next: Theme) => {
    // Read before the swap: this is the ground the new page rises through.
    const from = getComputedStyle(document.body).backgroundColor;

    setThemeState(next);
    applyTheme(next);
    setShift({ key: (shiftKey.current += 1), from });

    // Both of those land in this same task, and the browser cannot paint in
    // the middle of one — so the veil is up in the very frame the palette
    // flips, and there is no bare frame of the new theme before it.
    window.clearTimeout(shiftTimer.current);
    shiftTimer.current = window.setTimeout(() => setShift(null), SHIFT_MS + 60);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      crossFadeTo(next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Private mode or blocked storage — the choice just won't outlive the tab.
      }
    },
    [crossFadeTo],
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light");
  }, [setTheme, theme]);

  // Follow the OS only while the visitor has never chosen for themselves.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (event: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(THEME_STORAGE_KEY)) return;
      } catch {
        return;
      }
      crossFadeTo(event.matches ? "light" : "dark");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [crossFadeTo]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
      {shift && (
        <span key={shift.key} aria-hidden>
          <span className="theme-veil" style={{ backgroundColor: shift.from }} />
        </span>
      )}
    </ThemeContext.Provider>
  );
}
