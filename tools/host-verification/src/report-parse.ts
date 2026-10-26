/**
 * Validating parsers for the JSON the CLI reads off disk: a finished live report, an
 * interrupted run's progress.jsonl, and a probe's open-questions report.
 *
 * Every document is decoded with `@extynt/decode` into a domain type. The decoders are
 * deliberately lenient about the runner's output: a missing or mistyped member takes the
 * documented default (empty text, zero, null, an unknown status becomes "runner-error")
 * instead of failing, because a half-written report is still evidence worth analyzing.
 */
import { boolean, decodeJson, decodeOrThrow, literal, map, nullable, number, object, optional, record, string, union } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { canonicalHostKey, canonicalRuntime } from "./host-key.js";
import { fallback, jsonObject, jsonValue, lenient, list } from "./json.js";
import type { JsonObject } from "./json.js";
import type { OpenQuestionsReport, ProbeError, ProbeQuestionEntry } from "./questions.js";
import type { CaseRunRecord, DumpSections, HostStepRecord, KeyEntry, KitStamp, LiveReport, MaskEntry, PropEntry, RuntimeInfo, UndoRecord } from "./types.js";

export type { LiveReport } from "./types.js";

const text = (defaultText = ""): Decoder<string> => fallback(string(), () => defaultText);
const count: Decoder<number> = fallback(number(), () => 0);
const nullableText: Decoder<string | null> = fallback<string | null>(string(), () => null);
const texts: Decoder<string[]> = map(fallback<string[]>(list(text()), () => []), (items) => items.filter(Boolean));

const numberMatrix = lenient(list(list(number())));

const keyEntry: Decoder<KeyEntry> = object({
  t: count,
  v: lenient(jsonValue),
  ii: lenient(string()),
  oi: lenient(string()),
  ie: numberMatrix,
  oe: numberMatrix,
  si: lenient(list(number())),
  so: lenient(list(number())),
  r: lenient(boolean()),
});

const nameOrNumber = lenient(union(string(), number()));

const maskEntry: Decoder<MaskEntry> = object({
  mode: nameOrNumber,
  inverted: lenient(boolean()),
  rotoBezier: lenient(boolean()),
  locked: lenient(boolean()),
  featherFalloff: nameOrNumber,
  motionBlur: nameOrNumber,
});

const propEntry: Decoder<PropEntry> = object({
  mn: text(),
  nm: text(),
  pt: fallback(literal("P", "G", "I"), () => "P" as const),
  v: lenient(jsonValue),
  en: lenient(boolean()),
  h: lenient(boolean()),
  xe: lenient(boolean()),
  sep: lenient(boolean()),
  cv: lenient(boolean()),
  c: lenient(number()),
  ix: lenient(number()),
  n: lenient(number()),
  min: lenient(number()),
  max: lenient(number()),
  dims: lenient(number()),
  vt: lenient(string()),
  x: lenient(string()),
  xr: lenient(string()),
  k: lenient(list(keyEntry)),
  mask: lenient(maskEntry),
});

const objectSection: Decoder<Record<string, JsonObject | null>> = fallback(record(string(), nullable(fallback(jsonObject, () => ({})))), () => ({}));
const propSection: Decoder<Record<string, PropEntry | null>> = fallback(record(string(), nullable(propEntry)), () => ({}));

const dumpSections: Decoder<DumpSections | null> = fallback<DumpSections | null>(
  object({ items: objectSection, comps: objectSection, layers: objectSection, props: propSection, files: objectSection }),
  () => null,
);

const hostStep: Decoder<HostStepRecord> = object({
  phase: fallback(literal("apply", "rerun"), () => "apply" as const),
  stepIndex: count,
  ok: fallback(boolean(), () => false),
  response: fallback<JsonObject | null>(jsonObject, () => null),
  durationMs: count,
  raw: lenient(string()),
});

const undoRecord: Decoder<UndoRecord | null> = fallback<UndoRecord | null>(object({
  attempted: count,
  errors: texts,
  allowed: lenient(number()),
  restoredAfter: lenient(nullable(number())),
  overshot: lenient(boolean()),
}), () => null);

const caseStatus: Decoder<CaseRunRecord["status"]> = fallback(
  literal("ran", "skipped", "fixture-failed", "runner-error", "host-crashed", "pending-undo"),
  () => "runner-error" as const,
);

const caseRecord: Decoder<CaseRunRecord> = object({
  id: text(),
  status: caseStatus,
  tokens: fallback(record(string(), text()), () => ({})),
  caseCompId: nullableText,
  baseline: dumpSections,
  afterApply: dumpSections,
  afterRerun: dumpSections,
  afterUndo: dumpSections,
  host: fallback<HostStepRecord[]>(list(hostStep), () => []),
  undo: undoRecord,
  cleanup: text(),
  crashPhase: lenient(string()),
  error: lenient(string()),
  skipReason: lenient(string()),
});

const kitFields: Decoder<KitStamp> = object({ generatedAt: text(), packDigest: text(), extyntVersion: text() });
const kitStamp: Decoder<KitStamp> = fallback(kitFields, () => ({ generatedAt: "", packDigest: "", extyntVersion: "" }));

const runtimeInfo: Decoder<RuntimeInfo | null> = fallback<RuntimeInfo | null>(object({
  appVersion: text("?"),
  buildNumber: nullableText,
  platform: text(),
  architecture: text(),
  os: text(),
  locale: nullableText,
}), () => null);

const liveReportFields = {
  kit: kitStamp,
  runtime: runtimeInfo,
  hostKey: nullableText,
  startedAt: text(),
  finishedAt: nullableText,
  cases: fallback<CaseRunRecord[]>(list(caseRecord), () => []),
  apiProbes: fallback(jsonObject, () => ({})),
  runnerErrors: texts,
};

const liveReportDecoder: Decoder<LiveReport> = map(object(liveReportFields), (raw): LiveReport => {
  const runtime = raw.runtime ? canonicalRuntime(raw.runtime) : null;
  return { ...raw, schemaVersion: "0.1", runtime, hostKey: runtime ? canonicalHostKey(runtime) : raw.hostKey };
});

const progressHeader = object({ kit: kitStamp, runtime: runtimeInfo, hostKey: nullableText, startedAt: text(), apiProbes: liveReportFields.apiProbes });

function decodeDocument<T>(source: string, decoder: Decoder<T>, label: string): T {
  const decoded = decodeJson(source, decoder);
  if (!decoded.ok) throw new Error(`${label}: expected one JSON object`);
  return decoded.value;
}

/** A finished live-report.json. */
export function parseLiveReport(source: string): LiveReport {
  return decodeDocument(source, liveReportDecoder, "live report");
}

/**
 * The records of a progress.jsonl: ExtendScript's JSON can emit raw newlines inside a
 * record, so the split happens only where a new record starts, and a truncated record
 * from an interrupted write is skipped rather than failing the whole read.
 */
export function parseProgressRecords(source: string): JsonObject[] {
  const records: JsonObject[] = [];
  for (const chunk of source.split(/\n(?=\{"(?:id|header|start)")/)) {
    const decoded = decodeJson(chunk.trim(), jsonObject);
    if (decoded.ok) records.push(decoded.value);
  }
  return records;
}

function progressProvenanceProblems(headers: JsonObject[]): string[] {
  const identities = headers.map((header) => decodeOrThrow(progressHeader, header));
  const distinct = (read: (identity: (typeof identities)[number]) => string): string[] => [...new Set(identities.map(read))];
  const hosts = distinct((identity) => identity.hostKey ?? "(none)");
  const packs = distinct((identity) => identity.kit.packDigest || "(none)");
  const versions = distinct((identity) => identity.kit.extyntVersion || "(none)");
  const problems: string[] = [];
  if (hosts.length > 1) problems.push(`progress.jsonl mixes sessions from different hosts (${hosts.join(" | ")}); cases from one host cannot be credited to another`);
  if (packs.length > 1) problems.push(`progress.jsonl mixes sessions from different packs (${packs.map((pack) => pack.slice(0, 12)).join(" | ")})`);
  if (versions.length > 1) problems.push(`progress.jsonl mixes sessions from different kit versions (${versions.join(" | ")})`);
  return problems;
}

/** The final live-report.json is written by the last session only: it must come from the host and pack the progress file records. */
export function finalProvenanceProblems(progress: LiveReport, finished: LiveReport): string[] {
  const problems: string[] = [];
  if (finished.hostKey !== progress.hostKey) problems.push(`live-report.json is from host ${finished.hostKey ?? "(none)"} but progress.jsonl is from ${progress.hostKey ?? "(none)"}`);
  if (finished.kit.packDigest !== progress.kit.packDigest) problems.push("live-report.json and progress.jsonl are from different packs");
  return problems;
}

/**
 * The report an unfinished run folder reconstructs: its header, its merged cases, no finish stamp.
 * `headers` are every session header of the file (default: only `header`); disagreeing ones are
 * reported as provenance problems and as runner errors, because cases recorded under another host
 * or pack would otherwise be credited to whichever host the first header names.
 */
export function progressReport(header: JsonObject, cases: JsonObject[], headers: JsonObject[] = [header]): LiveReport {
  const provenanceProblems = progressProvenanceProblems(headers);
  const decoded = decodeOrThrow(progressHeader, header);
  return {
    schemaVersion: "0.1",
    kit: decoded.kit,
    runtime: decoded.runtime,
    hostKey: decoded.hostKey,
    startedAt: decoded.startedAt,
    finishedAt: null,
    cases: cases.map((entry) => decodeOrThrow(caseRecord, entry)),
    apiProbes: decoded.apiProbes,
    runnerErrors: ["progress.jsonl: the run did not finish", ...provenanceProblems],
    provenanceProblems,
  };
}

const probeQuestion: Decoder<ProbeQuestionEntry> = fallback(object({
  id: lenient(string()),
  title: lenient(string()),
  state: lenient(string()),
  error: lenient(nullable(string())),
  data: lenient(jsonValue),
}), () => ({}));

const probeError: Decoder<ProbeError> = fallback(object({ group: lenient(string()), error: lenient(string()) }), () => ({}));

const openQuestionsDecoder: Decoder<OpenQuestionsReport> = object({
  schemaVersion: lenient(string()),
  kind: lenient(string()),
  startedAt: lenient(string()),
  outFolder: lenient(string()),
  cleanup: lenient(string()),
  hostKey: lenient(string()),
  finishedAt: lenient(string()),
  kit: lenient(kitFields),
  runtime: optional(runtimeInfo),
  questions: lenient(list(probeQuestion)),
  probeErrors: fallback<ProbeError[]>(list(probeError), () => []),
  errors: texts,
});

/** A probe's open-questions.json. */
export function parseOpenQuestionsReport(source: string): OpenQuestionsReport {
  return decodeDocument(source, openQuestionsDecoder, "open questions report");
}
