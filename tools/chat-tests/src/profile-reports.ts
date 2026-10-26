/** What the live verification reports and a hand-written font census prove about a host: which effects applied, which fonts are installed. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { array, decodeJson, object, optional, string } from "@extynt/decode";
import { wireValue } from "@extynt/fake-plugin";
import { listOf, memberOf } from "./wire-reads.js";
import type { WireValue } from "./wire-types.js";

/** One live report and where it was read from. */
export interface LiveReport { path: string; value: WireValue }

function provenEffectName(step: WireValue): string | undefined {
  const operation = memberOf(step, "operation"), status = memberOf(step, "status"), effectPath = memberOf(step, "effectPath");
  if (operation !== "ensure_effect" || status !== "applied") return undefined;
  return String(typeof effectPath === "string" ? effectPath : "").split("/").filter(Boolean).pop()?.replace(/#\d+$/, "");
}

function phaseEffectNames(phase: WireValue): string[] {
  const steps = listOf(memberOf(memberOf(phase, "response"), "steps"));
  return steps.flatMap((step) => provenEffectName(step) ?? []);
}

function caseEffectNames(entry: WireValue): string[] {
  return listOf(memberOf(entry, "host")).flatMap(phaseEffectNames);
}

/** How many cases proved each effect applied, by effect match name. */
export function effectsProvenApplied(reports: readonly WireValue[]): Map<string, number> {
  const proven = new Map<string, number>();
  for (const report of reports) {
    for (const name of listOf(memberOf(report, "cases")).flatMap(caseEffectNames)) proven.set(name, (proven.get(name) ?? 0) + 1);
  }
  return proven;
}

/**
 * A seeded font census: the family/style/PostScript triples the panel posts, written by hand or
 * taken from a probe report, so the agent's font path runs on a machine with no After Effects.
 */
export interface FontCensusFile {
  note?: string | undefined;
  source?: string | undefined;
  fonts: Array<{ family?: string; style?: string; postScriptName?: string }>;
}

const fontOf = object({ family: optional(string()), style: optional(string()), postScriptName: optional(string()) });
const censusOf = object({ note: optional(string()), source: optional(string()), fonts: array(fontOf) });

/** Reads a font census file, throwing with the expected shape when it has no `fonts` array. */
export function readFontCensus(path: string): FontCensusFile {
  const decoded = decodeJson(readFileSync(path, "utf8"), censusOf);
  if (!decoded.ok) throw new Error(`No "fonts" array in ${path}. Expected {"fonts":[{"family","style","postScriptName"}]}.`);
  return { note: decoded.value.note, source: decoded.value.source, fonts: decoded.value.fonts.map((font) => ({ ...font })) };
}

/** Every `<directory>/<name>/live-report.json` that parses, in name order. */
export function readLiveReports(directory: string): LiveReport[] {
  if (!existsSync(directory)) return [];
  const reports: LiveReport[] = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name, "live-report.json");
    const decoded = existsSync(path) ? decodeJson(readFileSync(path, "utf8"), wireValue) : undefined;
    if (decoded?.ok) reports.push({ path, value: decoded.value });
  }
  return reports;
}
