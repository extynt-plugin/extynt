// Removes the graph files of unsaved projects that only accumulate: those past their age, then the oldest beyond the cap.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const UNSAVED = /^unsaved-[a-f0-9]{64}\.extynt$/;
const UNSAVED_GRAPH_MAX_AGE_MS = 14 * 86_400_000;
const UNSAVED_GRAPH_MAX_FILES = 24;
const RECENT_MS = 3_600_000;
const SIDE_FILE_SUFFIXES = ["-wal", "-shm", "-journal", ""];

/** Unsaved projects get a fresh graph per sidecar session. Removes those older than 14 days, then the oldest beyond the cap; files touched within the last hour and `keep` are never removed, and saved project graphs and the host catalogue are never touched. Returns the paths removed. */
export function pruneUnsavedGraphs(directory: string, now: number, keep?: string): string[] {
  let names: string[];
  try { names = readdirSync(directory).filter(name => UNSAVED.test(name)); } catch { return []; }
  const files = names.flatMap(name => {
    const path = join(directory, name);
    try { return [{ path, mtime: statSync(path).mtimeMs }]; } catch { return []; }
  }).filter(file => file.path !== keep && now - file.mtime >= RECENT_MS).sort((a, b) => b.mtime - a.mtime);
  const removed: string[] = [];
  files.forEach((file, index) => {
    if (now - file.mtime < UNSAVED_GRAPH_MAX_AGE_MS && index < UNSAVED_GRAPH_MAX_FILES) return;
    try {
      for (const suffix of SIDE_FILE_SUFFIXES) rmSync(file.path + suffix, { force: true });
      removed.push(file.path);
    } catch { return; }
  });
  return removed;
}
