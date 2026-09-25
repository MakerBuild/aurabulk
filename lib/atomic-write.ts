import fs from "fs";
import path from "path";

/**
 * Write via a temp file in the same directory and rename it into place, so a
 * reader — or the next cron run — never sees a half-written JSON file.
 */
export function writeFileAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, contents);
  fs.renameSync(temp, file);
}
