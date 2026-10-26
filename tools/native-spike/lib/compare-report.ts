/** Formats a comparison as text. */
import type { JsonValue } from "@extynt/decode";
import { sortedEntries } from "./compare-core.ts";
import type { BucketGroup, ComparedCounts, CompareReport, CountGroup, DetailsStats, DiffExample, Headline, KnownDefectReport, OrderReport, ProbeGapLists } from "./compare-core.ts";
import { flagLines } from "./compare-flags.ts";

const SHOWN_IDS = 12;

const show = (value: JsonValue): string => JSON.stringify(value);

function headline(label: string, entry: Headline): string {
  const status = entry.match ? "YES" : "NO";
  const extra = entry.exempt ? `, ${entry.exempt} native-only exempt` : "";
  const tail = entry.match ? "" : `, ${entry.missing} one-sided`;
  return `${label.padEnd(16)} ${status}  (${entry.compared} matched${tail}${extra})`;
}

function groupLines<Example>(title: string, group: BucketGroup<Example>, formatExample: (example: Example) => string): string[] {
  const entries = sortedEntries(group);
  if (!entries.length) return [];
  const lines = ["", title];
  for (const [key, { count, examples }] of entries) {
    lines.push(`  ${key}: ${count}`);
    for (const example of examples) lines.push(`    ${formatExample(example)}`);
  }
  return lines;
}

const diffExample = (example: DiffExample): string => `${example.where}: probe=${show(example.probe)} native=${show(example.native)}`;

function countLines(title: string, record: CountGroup): string[] {
  const entries = sortedEntries(record);
  return entries.length ? ["", title, ...entries.map(([key, count]) => `  ${key}: ${count}`)] : [];
}

function orderLines(order: OrderReport): string[] {
  const lines = ["", `path order (informational): ${order.layersDiverging} of ${order.layersChecked} layers diverge`];
  for (const example of order.examples) {
    lines.push(`  ${example.where}: first divergence at position ${example.position}: probe=${example.probe} native=${example.native}`);
  }
  return lines;
}

function summaryLines(compared: ComparedCounts): string[] {
  const parts = Object.entries(compared).map(([name, count]) => `${name}=${count}`);
  return ["", `compared: ${parts.join(" ")}`];
}

function detailsLines(details: DetailsStats | null): string[] {
  if (!details) return [];
  if (!details.ok) return ["", `details (aeReadPropertyDetails): failed, nothing merged (${details.error})`];
  const unmatched = details.unmatched ? `; ${details.unmatched} detail entries matched no native row` : "";
  return ["", `details (aeReadPropertyDetails): ${details.layers} layers, ${details.textDocuments} text documents and ${details.keyDigests} key digests compared${unmatched}`];
}

function idList(ids: ReadonlyArray<string>): string {
  const shown = ids.slice(0, SHOWN_IDS).join(", ");
  return ids.length > SHOWN_IDS ? `${shown}, ... +${ids.length - SHOWN_IDS} more` : shown;
}

function gapLines(gaps: ProbeGapLists): string[] {
  const notes: string[] = [];
  if (gaps.capped) notes.push("the probe snapshot hit its composition cap (compositionPages.capped)");
  if (gaps.unread.length) notes.push(`the probe left ${gaps.unread.length} composition(s) unread (ids ${idList(gaps.unread)})`);
  if (gaps.partial.length) notes.push(`the probe read ${gaps.partial.length} composition(s) only partially (ids ${idList(gaps.partial)})`);
  return notes.length ? ["", `note: ${notes.join("; ")}; native-only comparisons there are exempt.`] : [];
}

function defectCount(defect: KnownDefectReport): number {
  return Object.values(defect.categories).reduce((total, group) => total + group.count, 0);
}

function resultLines(report: CompareReport): string[] {
  const { pass, reasons } = report.verdict;
  const lines = ["", pass ? "RESULT: PASS" : `RESULT: FAIL (${reasons.join("; ")})`];
  const defects = defectCount(report.knownProbeDefect);
  if (defects) lines.push(`known probe defect differences (not counted): ${defects}`);
  return lines;
}

/** The human-readable text of a finished comparison. */
export function formatCompare(report: CompareReport): string {
  const lines = ["native vs probe"];
  if (report.probeInput) lines.push(`probe input: ${report.probeInput}`);
  lines.push("", headline("item ids match:", report.headlines.itemIds), headline("layer ids match:", report.headlines.layerIds));
  lines.push(...summaryLines(report.compared), ...detailsLines(report.details), ...gapLines(report.probeGaps));
  lines.push(...groupLines("missing (one side only):", report.missing, (example) => example));
  lines.push(...groupLines("field differences:", report.diffs, diffExample));
  lines.push(...groupLines(`${report.knownProbeDefect.title}:`, report.knownProbeDefect.categories, diffExample));
  lines.push(...groupLines("project-level differences (informational):", report.info, diffExample));
  lines.push(...countLines("skipped, native value unsupported (by type):", report.skipped));
  lines.push(...countLines("exempt native-only / probe-only entries:", report.exempt));
  lines.push(...orderLines(report.order), ...flagLines(report), ...resultLines(report));
  return lines.join("\n");
}
