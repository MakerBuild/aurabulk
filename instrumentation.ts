/**
 * Runs once when the server process starts. Production only: in dev every
 * restart would fan out to the exchange for ranges nobody is looking at.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { keepVolumeHistoryWarm } = await import("@/lib/volume-history");
  keepVolumeHistoryWarm();
}
