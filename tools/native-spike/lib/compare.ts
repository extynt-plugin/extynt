/** Compares a native snapshot with a probe snapshot. */
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { compareFields, newReport } from "./compare-core.ts";
import type { BucketGroup, CompareReport, CompareTally, DetailsStats, Headline, ReportOptions, Verdict } from "./compare-core.ts";
import { mergeDetails } from "./compare-details.ts";
import type { DetailsAnswer } from "./compare-details.ts";
import { compareCompositions, compareItems, compareSources } from "./compare-entities.ts";
import type { ProbeGaps } from "./compare-entities.ts";
import { objectAt, rowsAt } from "./json-access.ts";

export type { CompareReport } from "./compare-core.ts";

/** What shapes a comparison: the example cap, the debug-flags section, the probe's name and the parsed details answer. */
export interface CompareOptions extends ReportOptions {
  readonly probeInput?: string | null | undefined;
  readonly details?: DetailsAnswer | null | undefined;
}

function idTexts(list: JsonValue | undefined): string[] {
  return isJsonArray(list) ? list.map(String) : [];
}

function partialIds(list: JsonValue | undefined): string[] {
  if (!isJsonArray(list)) return [];
  return list.map((entry) => String((isJsonObject(entry) ? entry.id : undefined) ?? entry));
}

/** Which compositions the probe's own paging says it did not fully read (a merged or capped "latest" snapshot). */
export function probeGaps(probeResult: JsonObject): ProbeGaps {
  const pages = objectAt(probeResult, "compositionPages");
  return {
    capped: pages.capped === true,
    unread: new Set([...idTexts(pages.unread), ...idTexts(pages.oversized)]),
    partial: new Set(partialIds(pages.partial)),
  };
}

function compareProject(report: CompareTally, probe: JsonObject, native: JsonObject): void {
  const where = "project";
  const fields = { scope: "project", where, informational: true };
  compareFields(report, { ...fields, probe: objectAt(probe, "project"), native: objectAt(native, "project"), fields: ["name", "filePath"] });
  compareFields(report, { ...fields, probe, native, fields: ["itemCount", "activeCompositionId"] });
}

function count<Example>(group: BucketGroup<Example>): number {
  return Object.values(group).reduce((total, entry) => total + entry.count, 0);
}

function idsMatch(report: CompareTally, scope: string, compared: number): Headline {
  const missing = (report.missing[`${scope}:missing-in-native`]?.count ?? 0) + (report.missing[`${scope}:missing-in-probe`]?.count ?? 0);
  const exempt = Object.entries(report.exempt).filter(([key]) => key.startsWith(`${scope}:`)).reduce((total, [, value]) => total + value, 0);
  return { match: missing === 0, compared, missing, exempt };
}

function verdictOf(report: CompareTally): Verdict {
  const reasons: string[] = [];
  if (count(report.missing)) reasons.push(`${count(report.missing)} entities exist on one side only`);
  if (count(report.diffs)) reasons.push(`${count(report.diffs)} field differences`);
  if (report.compared.layers === 0) reasons.push("no layers were compared (nothing proves parity)");
  return { pass: reasons.length === 0, reasons };
}

interface NativeRows {
  readonly native: JsonObject;
  readonly stats: DetailsStats | null;
}

function mergedNative(nativeRead: JsonObject, details: DetailsAnswer | null | undefined): NativeRows {
  return details ? mergeDetails(nativeRead, details) : { native: nativeRead, stats: null };
}

/**
 * Compares a native read_project full result with a probe snapshot result (the probe envelope's `result`). With `options.details`
 * (the parsed aeReadPropertyDetails answer) text documents and key digests are folded into the native rows first and compared too.
 * Returns the report with headlines and verdict filled in.
 */
export function compareSnapshots(nativeRead: JsonObject, probe: JsonObject, options: CompareOptions = {}): CompareReport {
  const tally = newReport(options);
  const { native, stats } = mergedNative(nativeRead, options.details);
  const gaps = probeGaps(probe);
  compareProject(tally, probe, native);
  compareItems(tally, rowsAt(probe, "items"), rowsAt(native, "items"));
  compareSources(tally, rowsAt(probe, "sources"), rowsAt(native, "sources"));
  compareCompositions(tally, { probeComps: rowsAt(probe, "compositions"), nativeComps: rowsAt(native, "compositions"), gaps });
  return {
    ...tally,
    details: stats,
    headlines: { itemIds: idsMatch(tally, "item", tally.compared.items), layerIds: idsMatch(tally, "layer", tally.compared.layers) },
    probeInput: options.probeInput ?? null,
    probeGaps: { capped: gaps.capped, unread: [...gaps.unread], partial: [...gaps.partial] },
    verdict: verdictOf(tally),
  };
}
