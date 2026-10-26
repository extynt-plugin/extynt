/** Decodes and compares property dynamic flags. */
import type { JsonObject } from "@extynt/decode";
import { fieldText } from "./compare-core.ts";
import type { CompareTally, FlagGroup } from "./compare-core.ts";
import { flagAt, numberAt } from "./json-access.ts";
import { formatTable } from "./format.ts";

const FLAG_BITS = [
  [1, "ACTIVE_EYEBALL"],
  [2, "HIDDEN"],
  [8, "bit3(undocumented)"],
  [16, "DISABLED"],
  [32, "ELIDED"],
  [1024, "SHOWN_WHEN_EMPTY"],
] as const;

/** A matched property pair whose dynamic flags are recorded. */
export interface FlagPair {
  readonly where: string;
  readonly probe: JsonObject;
  readonly native: JsonObject;
}

export const FLAG_TITLE = "enabled vs raw flags (debugFlags)";

/** Names the set bits of a raw dynFlags value; bits outside the known list are shown as one hex remainder. */
export function decodeDynFlags(flags: number): string {
  if (flags === 0) return "(none)";
  const names: string[] = FLAG_BITS.filter(([bit]) => (flags & bit) !== 0).map(([, name]) => name);
  const known = FLAG_BITS.reduce((mask, [bit]) => mask | bit, 0);
  const rest = flags & ~known;
  if (rest !== 0) names.push(`0x${rest.toString(16)}`);
  return names.join("|");
}

/**
 * Records one matched property pair under its (probe.enabled, native dynFlags) group. Only entries where the probe
 * gave a boolean `enabled` and the native side carried dynFlags (a debugFlags read) take part.
 */
export function recordFlags(report: CompareTally, spec: FlagPair): void {
  const { probe, native, where } = spec;
  const probeEnabled = flagAt(probe, "enabled");
  const dynFlags = numberAt(native, "dynFlags");
  if (probeEnabled === undefined || dynFlags === undefined || !Number.isInteger(dynFlags)) return;
  const key = `${probeEnabled}|${dynFlags}`;
  const group: FlagGroup = report.enabledFlags[key] ?? { probeEnabled, dynFlags, count: 0, nativeMatch: 0, nativeMismatch: 0, examples: [] };
  report.enabledFlags[key] = group;
  group.count += 1;
  if (native.enabled === probeEnabled) group.nativeMatch += 1;
  else group.nativeMismatch += 1;
  if (group.examples.length < report.maxExamples) group.examples.push(`${where} / ${fieldText(probe, "path")}`);
}

function sortedGroups(enabledFlags: CompareTally["enabledFlags"]): FlagGroup[] {
  return Object.values(enabledFlags).sort((a, b) => Number(b.probeEnabled) - Number(a.probeEnabled) || a.dynFlags - b.dynFlags);
}

function matchText(group: FlagGroup): string {
  if (group.nativeMismatch === 0) return "native.enabled matched in all";
  if (group.nativeMatch === 0) return "native.enabled never matched";
  return `native.enabled matched ${group.nativeMatch}, differed ${group.nativeMismatch}`;
}

function groupRow(group: FlagGroup): string[] {
  return [String(group.probeEnabled), String(group.dynFlags), decodeDynFlags(group.dynFlags), String(group.count), matchText(group)];
}

/** The report section for --debug-flags, or nothing when it was not requested. */
export function flagLines(report: Pick<CompareTally, "enabledFlags" | "debugFlagsRequested">): string[] {
  const groups = sortedGroups(report.enabledFlags);
  if (!groups.length) {
    return report.debugFlagsRequested ? ["", `${FLAG_TITLE}: no compared native entry carried dynFlags (plugin without debugFlags support?)`] : [];
  }
  const lines: string[] = ["", `${FLAG_TITLE}: grouped by probe.enabled and native dynFlags`];
  lines.push(formatTable(["probe.enabled", "dynFlags", "decoded", "entries", "native.enabled"], groups.map(groupRow)));
  lines.push("flag bits: ACTIVE_EYEBALL=1 HIDDEN=2 bit3(undocumented)=8 DISABLED=16 ELIDED=32 SHOWN_WHEN_EMPTY=1024");
  for (const group of groups) {
    lines.push(`  probe.enabled=${group.probeEnabled} dynFlags=${group.dynFlags}:`);
    for (const example of group.examples) lines.push(`    ${example}`);
  }
  return lines;
}
