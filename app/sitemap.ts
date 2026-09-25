import type { MetadataRoute } from "next";

const SITE_URL = "https://www.aurabulk.xyz";

const ROUTES: { path: string; priority: number }[] = [
  { path: "", priority: 1 },
  { path: "/aura", priority: 0.8 },
  { path: "/leaderboards", priority: 0.8 },
  { path: "/tools", priority: 0.6 },
  { path: "/trade", priority: 0.4 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency: "hourly",
    priority,
  }));
}
