/** Shared machinery for the native-vs-probe comparison: value equality, the report, and keyed matching. */
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

const TOLERANCE = 1e-6;
const DEFAULT_MAX_EXAMPLES = 5;

/** The probe cannot read isHidden on some AE builds, so these two property fields are not a parity signal there. */
export const KNOWN_DEFECT_TITLE = "known probe defect: isHidden unavailable on this AE";
const KNOWN_DEFECT_KEYS: ReadonlySet<string> = new Set(["property.hidden", "property.canSetValue"]);

/** The kinds of matched pairs counted while comparing. */
export type ComparedCounter = "items" | "sources" | "compositions" | "layers" | "properties";

/** How many pairs of each kind were matched, and how many fields compared. */
export interface ComparedCounts {
  items: number;
  sources: number;
  compositions: number;
  layers: number;
  properties: number;
  fields: number;
}

/** A tally of one category: how often it happened and the first few examples. */
export interface Bucket<Example> {
  count: number;
  examples: Example[];
}

/** Buckets by category name. */
export interface BucketGroup<Example> {
  [category: string]: Bucket<Example>;
}

/** Counts by name. */
export interface CountGroup {
  [name: string]: number;
}

/** One field that differs: where it was found and both values (absent reads as null). */
export interface DiffExample {
  readonly where: string;
  readonly probe: JsonValue;
  readonly native: JsonValue;
}

/** Property entries sharing the probe's `enabled` and the native `dynFlags`. */
export interface FlagGroup {
  readonly probeEnabled: boolean;
  readonly dynFlags: number;
  count: number;
  nativeMatch: number;
  nativeMismatch: number;
  examples: string[];
}

/** The first position where a layer's property paths come in a different order. */
export interface OrderDivergence {
  readonly position: number;
  readonly probe: string | undefined;
  readonly native: string | undefined;
}

/** A layer whose property paths diverge in order. */
export interface OrderExample extends OrderDivergence {
  readonly where: string;
}

/** How many layers had their property order checked and how many diverge. */
export interface OrderReport {
  layersChecked: number;
  layersDiverging: number;
  examples: OrderExample[];
}

/** What folding the details call into the native rows did. */
export interface DetailsStats {
  readonly requested: true;
  readonly ok: boolean;
  readonly error: string | null;
  layers: number;
  textDocuments: number;
  keyDigests: number;
  unmatched: number;
}

/** The known-defect categories under their title. */
export interface KnownDefectReport {
  readonly title: string;
  readonly categories: BucketGroup<DiffExample>;
}

/** Everything the comparison accumulates while it walks the two snapshots. */
export interface CompareTally {
  readonly maxExamples: number;
  readonly compared: ComparedCounts;
  readonly missing: BucketGroup<string>;
  readonly diffs: BucketGroup<DiffExample>;
  readonly info: BucketGroup<DiffExample>;
  readonly knownProbeDefect: KnownDefectReport;
  readonly enabledFlags: { [key: string]: FlagGroup };
  readonly debugFlagsRequested: boolean;
  readonly exempt: CountGroup;
  readonly skipped: CountGroup;
  readonly order: OrderReport;
  readonly details: DetailsStats | null;
}

/** Whether the two sides agree on one kind of id, with the counts behind it. */
export interface Headline {
  readonly match: boolean;
  readonly compared: number;
  readonly missing: number;
  readonly exempt: number;
}

/** Compositions the probe did not fully read. */
export interface ProbeGapLists {
  readonly capped: boolean;
  readonly unread: ReadonlyArray<string>;
  readonly partial: ReadonlyArray<string>;
}

/** The verdict: pass, or the reasons it failed. */
export interface Verdict {
  readonly pass: boolean;
  readonly reasons: ReadonlyArray<string>;
}

/** The finished comparison: the tally plus headlines, probe gaps and the verdict. */
export interface CompareReport extends CompareTally {
  readonly headlines: { readonly itemIds: Headline; readonly layerIds: Headline };
  readonly probeInput: string | null;
  readonly probeGaps: ProbeGapLists;
  readonly verdict: Verdict;
}

/** What `newReport` reads from the caller's options. */
export interface ReportOptions {
  readonly maxExamples?: number | undefined;
  readonly debugFlags?: boolean | undefined;
}

/** One field of a matched pair to compare. */
export interface FieldComparison {
  readonly scope: string;
  readonly where: string;
  readonly field: string;
  readonly probe: JsonValue | undefined;
  readonly native: JsonValue | undefined;
  readonly informational?: boolean | undefined;
}

/** A field name, or a name with the value an absent field is read as. */
export type FieldSpec = string | readonly [string, JsonValue];

/** A list of fields to compare between two matched rows. */
export interface FieldListComparison {
  readonly scope: string;
  readonly where: string;
  readonly probe: JsonObject;
  readonly native: JsonObject;
  readonly fields: ReadonlyArray<FieldSpec>;
  readonly informational?: boolean | undefined;
}

/** Two row lists to match by key, and what to do with the matches and the leftovers. */
export interface KeyedComparison {
  readonly scope: string;
  readonly key: string;
  readonly counter: ComparedCounter;
  readonly probeRows: ReadonlyArray<JsonObject>;
  readonly nativeRows: ReadonlyArray<JsonObject>;
  readonly describe?: ((row: JsonObject) => string) | undefined;
  readonly exemptProbeOnly?: ((row: JsonObject) => string | null) | undefined;
  readonly exemptNativeOnly?: ((row: JsonObject) => string | null) | undefined;
  readonly onPair?: ((probe: JsonObject, native: JsonObject) => void) | undefined;
}

interface OneSided {
  readonly spec: KeyedComparison;
  readonly scopeKey: string;
  readonly row: JsonObject;
  readonly reason: string | null | undefined;
}

/** The field of a row as text, the way a template would print it. */
export function fieldText(row: JsonObject, key: string): string {
  return String(row[key]);
}

/** The kind named by a `{unsupported: kind}` value, or undefined for any other value. */
export function unsupportedKind(value: JsonValue | undefined): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const kind = value.unsupported;
  return typeof kind === "string" ? kind : undefined;
}

/** The entries of a record in key order. */
export function sortedEntries<Entry>(record: { readonly [key: string]: Entry }): Array<[string, Entry]> {
  const entries: Array<[string, Entry]> = [];
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== undefined) entries.push([key, entry]);
  }
  return entries;
}

function normalize(value: JsonValue | undefined): JsonValue {
  return value === undefined ? null : value;
}

function numbersClose(a: number, b: number): boolean {
  const difference = Math.abs(a - b);
  return difference <= TOLERANCE || difference <= TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

function arraysEqual(a: JsonValue, b: JsonValue): boolean {
  return isJsonArray(a) && isJsonArray(b) && a.length === b.length && a.every((entry, index) => valuesEqual(entry, b[index]));
}

function objectsEqual(a: JsonObject, b: JsonObject): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => valuesEqual(a[key], b[key]));
}

/** Numbers match within 1e-6 absolute or relative; arrays elementwise; undefined and null are the same absence. */
export function valuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  const a = normalize(left), b = normalize(right);
  if (typeof a === "number" && typeof b === "number") return numbersClose(a, b);
  if (isJsonArray(a) || isJsonArray(b)) return arraysEqual(a, b);
  return isJsonObject(a) && isJsonObject(b) ? objectsEqual(a, b) : a === b;
}

/** An empty tally for a new comparison. */
export function newReport(options: ReportOptions = {}): CompareTally {
  return {
    maxExamples: options.maxExamples ?? DEFAULT_MAX_EXAMPLES,
    compared: { items: 0, sources: 0, compositions: 0, layers: 0, properties: 0, fields: 0 },
    missing: {},
    diffs: {},
    info: {},
    knownProbeDefect: { title: KNOWN_DEFECT_TITLE, categories: {} },
    enabledFlags: {},
    debugFlagsRequested: options.debugFlags === true,
    exempt: {},
    skipped: {},
    order: { layersChecked: 0, layersDiverging: 0, examples: [] },
    details: null,
  };
}

function bucket<Example>(group: BucketGroup<Example>, key: string, example: Example, limit: number): void {
  const entry: Bucket<Example> = group[key] ?? { count: 0, examples: [] };
  group[key] = entry;
  entry.count += 1;
  if (entry.examples.length < limit) entry.examples.push(example);
}

/** Records something that exists on one side only. */
export function addMissing(report: CompareTally, key: string, example: string): void {
  bucket(report.missing, key, example, report.maxExamples);
}

/** Records a field difference. */
export function addDiff(report: CompareTally, key: string, example: DiffExample): void {
  bucket(report.diffs, key, example, report.maxExamples);
}

/** Records an informational difference that never fails the comparison. */
export function addInfo(report: CompareTally, key: string, example: DiffExample): void {
  bucket(report.info, key, example, report.maxExamples);
}

/** Records a difference caused by the known probe defect. */
export function addKnownDefect(report: CompareTally, key: string, example: DiffExample): void {
  bucket(report.knownProbeDefect.categories, key, example, report.maxExamples);
}

/** Adds one to the count under `key`. */
export function tally(group: CountGroup, key: string): void {
  group[key] = (group[key] ?? 0) + 1;
}

type DiffRecorder = (report: CompareTally, key: string, example: DiffExample) => void;

function diffTarget(spec: FieldComparison, key: string): DiffRecorder {
  if (spec.informational === true) return addInfo;
  return KNOWN_DEFECT_KEYS.has(key) ? addKnownDefect : addDiff;
}

/** Compares one field of a matched pair. A native {unsupported} value is tallied by type, never a diff. */
export function compareValue(report: CompareTally, spec: FieldComparison): void {
  report.compared.fields += 1;
  const unsupported = unsupportedKind(spec.native);
  if (unsupported !== undefined) {
    tally(report.skipped, unsupported);
    return;
  }
  if (valuesEqual(spec.probe, spec.native)) return;
  const key = `${spec.scope}.${spec.field}`;
  diffTarget(spec, key)(report, key, { where: spec.where, probe: normalize(spec.probe), native: normalize(spec.native) });
}

/** Compares a list of fields; an entry may be a name or [name, valueWhenAbsent]. */
export function compareFields(report: CompareTally, spec: FieldListComparison): void {
  for (const entry of spec.fields) {
    const [field, fallback] = typeof entry === "string" ? [entry, undefined] : entry;
    const probe = spec.probe[field] ?? fallback;
    const native = spec.native[field] ?? fallback;
    compareValue(report, { scope: spec.scope, where: spec.where, field, probe, native, informational: spec.informational });
  }
}

function indexBy(rows: ReadonlyArray<JsonObject>, key: string): Map<string, JsonObject> {
  const index = new Map<string, JsonObject>();
  for (const row of rows) index.set(fieldText(row, key), row);
  return index;
}

function describeRow(spec: KeyedComparison, row: JsonObject): string {
  return spec.describe ? spec.describe(row) : fieldText(row, spec.key);
}

function recordOneSided(report: CompareTally, { spec, scopeKey, row, reason }: OneSided): void {
  if (reason) {
    tally(report.exempt, `${spec.scope}: ${reason}`);
    return;
  }
  addMissing(report, scopeKey, describeRow(spec, row));
}

/**
 * Matches two row lists by `spec.key`, records what exists on one side only (unless the exempt callbacks give a reason),
 * counts the matched pairs under `spec.counter` and hands each pair to `spec.onPair`.
 */
export function compareKeyed(report: CompareTally, spec: KeyedComparison): void {
  const probe = indexBy(spec.probeRows, spec.key);
  const native = indexBy(spec.nativeRows, spec.key);
  for (const [id, row] of probe) {
    const mate = native.get(id);
    if (mate) {
      report.compared[spec.counter] += 1;
      spec.onPair?.(row, mate);
      continue;
    }
    recordOneSided(report, { spec, scopeKey: `${spec.scope}:missing-in-native`, row, reason: spec.exemptProbeOnly?.(row) });
  }
  for (const [id, row] of native) {
    if (probe.has(id)) continue;
    recordOneSided(report, { spec, scopeKey: `${spec.scope}:missing-in-probe`, row, reason: spec.exemptNativeOnly?.(row) });
  }
}
