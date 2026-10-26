// The gate runs on the Node release the product ships: packaging/macos/node-runtime.env is the single source of that version.
// Older 24.x releases fail for real reasons (24.3.0's node:sqlite cannot bind positional ?1/?2 parameters), so the gate stops early.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RUNTIME_ENV = join("packaging", "macos", "node-runtime.env");

export function parseVersion(text: string): readonly [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** True when `version` is at least `minimum`; both are "major.minor.patch" strings, an optional leading "v" allowed. */
export function atLeast(version: string, minimum: string): boolean {
  const have = parseVersion(version);
  const need = parseVersion(minimum);
  if (!have || !need) return false;
  const index = have.findIndex((part, position) => part !== need[position]);
  return index < 0 || (have[index] ?? 0) > (need[index] ?? 0);
}

export function minimumNodeVersion(root: string): string {
  const text = readFileSync(join(root, RUNTIME_ENV), "utf8");
  const match = /^NODE_VERSION=(\S+)\s*$/m.exec(text);
  if (!match || !parseVersion(match[1] ?? "")) throw new Error(`${RUNTIME_ENV} has no NODE_VERSION=major.minor.patch line`);
  return match[1] ?? "";
}

/** A one-paragraph failure message when the running Node is older than the shipped runtime, else undefined. */
export function nodeVersionProblem(version: string, root: string): string | undefined {
  const minimum = minimumNodeVersion(root);
  if (atLeast(version, minimum)) return undefined;
  return `pnpm check needs Node ${minimum} or newer (the runtime in ${RUNTIME_ENV}); this is ${version}. Older releases fail the sidecar tests (24.3.0's node:sqlite cannot bind positional ?1/?2 parameters). Install it (macOS: brew install node@26, or put ~/Library/Application Support/extynt/runtime/bin first on PATH) and run again.`;
}
