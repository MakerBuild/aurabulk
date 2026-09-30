/**
 * One-off seed for data/oi-history.json, before the hourly levels cron took
 * it over. Every version of data/exchange-levels.json in git history kept a
 * rolling 24h of cron snapshots, so together they hold every OI vertex we
 * ever recorded, from Sep 6.
 *
 * Versions committed before 4ca846d ("Stop doubling open interest") stored
 * longs plus shorts, twice the one-sided figure the exchange shows. That
 * commit only halved the 24h still in the file, so the older versions are
 * halved here. DefiLlama's daily series carries the same doubling up to
 * Sep 14 on its side, which is why it is not used.
 *
 *   npm run backfill:oi
 */
import { execFileSync } from "child_process";
import type { LevelPoint } from "../lib/exchange-level-history";
import { readOiHistoryFile, writeOiHistoryFile } from "../lib/oi-history-store";

const LEVELS_PATH = "data/exchange-levels.json";
const STOP_DOUBLING_COMMIT = "4ca846d";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
}

function shas(range: string): string[] {
  return git(["rev-list", range, "--", LEVELS_PATH]).split("\n").filter(Boolean);
}

function recordedFromGit(): LevelPoint[] {
  const doubled = new Set(shas(`${STOP_DOUBLING_COMMIT}^`));
  // Oldest first, so a newer version's reading of the same hour wins the merge.
  const points: LevelPoint[] = [];
  for (const sha of shas("HEAD").reverse()) {
    try {
      const file = JSON.parse(git(["show", `${sha}:${LEVELS_PATH}`])) as { oi?: LevelPoint[] };
      if (!Array.isArray(file.oi)) continue;
      const scale = doubled.has(sha) ? 0.5 : 1;
      points.push(...file.oi.map((p) => ({ t: p.t, value: p.value * scale })));
    } catch {
      // A version that predates the oi field.
    }
  }
  return points;
}

function main() {
  const recorded = recordedFromGit();
  const next = writeOiHistoryFile([...recorded, ...readOiHistoryFile().oi]);
  const first = new Date(next.oi[0].t).toISOString().slice(0, 10);
  console.log(`[oi-backfill] recorded=${recorded.length} total=${next.oi.length} from=${first}`);
}

main();
