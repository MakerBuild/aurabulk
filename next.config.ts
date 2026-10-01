import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server build (deploy/update.sh) sets this to get a self-contained
  // release folder it can swap in while the old one keeps serving.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      { source: "/aura/sources", destination: "/aura", permanent: true },
      { source: "/aura/distribution", destination: "/aura", permanent: true },
      // The page was launched as Stats; links shared under that name still land.
      { source: "/stats", destination: "/execution", permanent: true },
    ];
  },
  // Keep the last page around so Overview ↔ Aura ↔ Tools feel instant.
  experimental: {
    staleTimes: {
      dynamic: 180,
      static: 300,
    },
  },
  // leaderboard.json is tens of thousands of rows. Watching it (and the rest
  // of data/) makes Fast Refresh stall or never finish on this machine.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/data/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
