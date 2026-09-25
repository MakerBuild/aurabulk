import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { SiteNav } from "@/components/layout/SiteNav";
import { LiveFinancialProvider } from "@/components/live/LiveFinancialProvider";
import { LiveExchangeProvider } from "@/components/live/LiveExchangeProvider";
import { LIVE_FINANCIAL_SEED } from "@/lib/live-financial-seed";
import { buildLiveExchangePayload } from "@/lib/live-exchange-payload";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { HashScrollOnLoad } from "@/components/layout/HashScrollOnLoad";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/** Nav, labels, tier names, big KPI figures. */
const familjenGrotesk = localFont({
  src: "../fonts/FamiljenGrotesk-VariableFont_wght.ttf",
  variable: "--font-familjen",
  weight: "100 900",
  display: "swap",
});

/** Table cells, axis ticks, week markers, TVL deltas. */
const overpassMono = localFont({
  src: "../fonts/OverpassMono-VariableFont_wght.ttf",
  variable: "--font-overpass-mono",
  weight: "100 900",
  display: "swap",
});

const siteUrl = "https://www.aurabulk.xyz";
const siteTitle = "AURA Intelligence | BULK Analytics Terminal";
const siteDescription =
  "Real-time analytics for the BULK AURA pre-deposit campaign. Institutional-grade insights beyond the official interface.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "AURA Analytics Terminal",
    title: siteTitle,
    description: siteDescription,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
    { media: "(prefers-color-scheme: light)", color: "#f9f8ed" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The exchange payload is fetched here so every page's KPIs share one
  // provider without a $0 flash. One hour, matching the pages' revalidate: a
  // shorter fetch window would pin every page to it, and the client provider's
  // first poll corrects the figures regardless.
  const exchange = await buildLiveExchangePayload(3600);

  return (
    <html
      lang="en"
      // Server default; the head script below replaces it before first paint.
      data-theme="dark"
      className={`${familjenGrotesk.variable} ${overpassMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Blocking on purpose: the stored theme must land on <html> before
            anything paints, or a light-mode visitor gets a dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <LiveFinancialProvider initial={LIVE_FINANCIAL_SEED}>
            <LiveExchangeProvider initial={exchange}>
              <HashScrollOnLoad />
              <SiteNav />
              <main>{children}</main>
              <ScrollToTop />
            </LiveExchangeProvider>
          </LiveFinancialProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
