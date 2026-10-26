// The build id the served panel bundle announces on its first line, cached by file identity.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

const BUILD_LINE = /^\/\* extynt-panel-build:([a-f0-9]{16}) \*\//;
const MAX_CACHED = 8;
const cache = new Map<string, { identity: string; build: string | null }>();

function firstBytes(file: string): string {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(128);
    return buffer.toString("utf8", 0, readSync(fd, buffer, 0, buffer.length, 0));
  } finally { closeSync(fd); }
}

function rememberBuild(file: string, identity: string): string | null {
  const build = BUILD_LINE.exec(firstBytes(file).split("\n", 1)[0] ?? "")?.[1] ?? null;
  cache.delete(file);
  cache.set(file, { identity, build });
  while (cache.size > MAX_CACHED) { const oldest = cache.keys().next(); if (oldest.done) break; cache.delete(oldest.value); }
  return build;
}

/** Null when main.js is absent or does not start with the build marker. */
export function uiBuildOf(directory: string): string | null {
  const file = join(directory, "main.js");
  try {
    const stat = statSync(file), identity = `${stat.mtimeMs}:${stat.size}`, cached = cache.get(file);
    if (cached?.identity === identity) return cached.build;
    return rememberBuild(file, identity);
  } catch { return null; }
}
