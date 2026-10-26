// The censuses: per area the escape hatches and unknown violations that remain, per native directory the erased types and casts, and the
// header-length report. None of them fails the gate yet.
import { areaOf, nativeAreaOf } from "./areas.ts";
import { stripCppLiterals } from "./banned-tokens.ts";
import type { SourceComment } from "./comments/comment-blocks.ts";
import { cppHeaderBlock } from "./comments/cpp-comments.ts";
import { scriptHeaderBlock } from "./comments/script-comments.ts";
import { innoHeaderBlock } from "./inno-rules.ts";
import { languageOf } from "./language.ts";
import { analyseSource } from "./comments/typescript-comments.ts";
import { WORKSPACE_PACKAGES } from "./sources.ts";
import type { SourceEntry } from "./source-entry.ts";
import { ESCAPE_FIELDS, escapeCounts } from "./type-escapes.ts";
import type { EscapeField } from "./type-escapes.ts";
import { unknownViolations } from "./unknown-boundary.ts";

/** A census column of the TypeScript census: an escape hatch or the unknown violations. */
export type TypeCensusField = EscapeField | "unknown";

/** A census column of the native census. */
export type NativeCensusField = (typeof CPP_PATTERNS)[number][0];

/** One TypeScript census row. */
export type TypeCensusRow = Record<TypeCensusField, number>;

/** One native census row. */
export type NativeCensusRow = Record<NativeCensusField, number>;

/** The header-length report: files per area, largest first, and one line per file over the cap. */
export interface HeaderLengthReport {
  readonly areas: ReadonlyArray<readonly [string, number]>;
  readonly files: ReadonlyArray<string>;
}

interface CensusColumns<Field extends string> {
  readonly fields: ReadonlyArray<Field>;
  readonly blank: () => Record<Field, number>;
}

const TS_FIELDS: ReadonlyArray<TypeCensusField> = [...ESCAPE_FIELDS, "unknown"];
const CPP_PATTERNS = [
  ["void*", /\bvoid\s*\*/g],
  ["std::any", /\bstd::any\b/g],
  ["reinterpret_cast", /\breinterpret_cast\b/g],
  ["const_cast", /\bconst_cast\b/g],
  ["union", /\bunion\b/g],
] as const;
const CPP_FIELDS: ReadonlyArray<NativeCensusField> = CPP_PATTERNS.map(([name]) => name);
const TS_SOURCE = /\.(?:ts|tsx)$/;

const FIXED_TS_AREAS = ["apps/sidecar", "apps/panel/runtime", "apps/panel/tests", "scripts", "tests"];
const NATIVE_AREAS = ["ae", "core", "transport", "catalogue-window", "tests"];

const TYPE_COLUMNS: CensusColumns<TypeCensusField> = {
  fields: TS_FIELDS,
  blank: () => ({ any: 0, casts: 0, nonNull: 0, restricted: 0, unknown: 0 }),
};
const NATIVE_COLUMNS: CensusColumns<NativeCensusField> = {
  fields: CPP_FIELDS,
  blank: () => ({ "void*": 0, "std::any": 0, reinterpret_cast: 0, const_cast: 0, union: 0 }),
};

type CensusTable<Field extends string> = Map<string, Record<Field, number>>;

function addCounts<Field extends string>(table: CensusTable<Field>, area: string, counts: Record<Field, number>, columns: CensusColumns<Field>): void {
  const row = table.get(area) ?? columns.blank();
  for (const field of columns.fields) row[field] += counts[field];
  table.set(area, row);
}

/** Map of area to { any, casts, nonNull, restricted, unknown } over {key, text} entries of TS and TSX files. */
export function typeCensus(entries: ReadonlyArray<SourceEntry>): Map<string, TypeCensusRow> {
  const packageAreas = [...WORKSPACE_PACKAGES.values()].map((info) => info.relative).filter((path) => !path.startsWith("apps/"));
  const table = new Map<string, TypeCensusRow>([...FIXED_TS_AREAS, ...packageAreas].map((area) => [area, TYPE_COLUMNS.blank()]));
  for (const { key, text } of entries.filter((entry) => TS_SOURCE.test(entry.key))) {
    const counts: TypeCensusRow = { ...escapeCounts(key, text), unknown: unknownViolations(key, text).length };
    addCounts(table, areaOf(key), counts, TYPE_COLUMNS);
  }
  return table;
}

/** Map of native directory to { void*, std::any, reinterpret_cast, const_cast, union } over {key, text} entries. */
export function nativeCensus(entries: ReadonlyArray<SourceEntry>): Map<string, NativeCensusRow> {
  const table = new Map<string, NativeCensusRow>(NATIVE_AREAS.map((area) => [area, NATIVE_COLUMNS.blank()]));
  for (const { key, text } of entries) {
    const code = stripCppLiterals(text);
    const counts = NATIVE_COLUMNS.blank();
    for (const [name, pattern] of CPP_PATTERNS) counts[name] = [...code.matchAll(pattern)].length;
    addCounts(table, nativeAreaOf(key), counts, NATIVE_COLUMNS);
  }
  return table;
}

function censusLines<Field extends string>(table: ReadonlyMap<string, Readonly<Record<Field, number>>>, fields: ReadonlyArray<Field>): string[][] {
  const rows = [...table].sort(([left], [right]) => left.localeCompare(right));
  const total = fields.map((field) => String(rows.reduce((sum, [, row]) => sum + row[field], 0)));
  return [["area", ...fields], ...rows.map(([area, row]) => [area, ...fields.map((field) => String(row[field]))]), ["TOTAL", ...total]];
}

/** A fixed-width table of a census Map, one row per area plus a total row. */
export function formatCensus<Field extends string>(table: ReadonlyMap<string, Readonly<Record<Field, number>>>, fields: ReadonlyArray<Field>): string {
  const lines = censusLines(table, fields);
  const widths = ["area", ...fields].map((_, column) => Math.max(...lines.map((line) => line[column]?.length ?? 0)));
  return lines.map((line) => line.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd()).join("\n");
}

/** The TS census column names, in report order. */
export const TYPE_CENSUS_FIELDS: ReadonlyArray<TypeCensusField> = TS_FIELDS;
/** The C++ census column names, in report order. */
export const NATIVE_CENSUS_FIELDS: ReadonlyArray<NativeCensusField> = CPP_FIELDS;

/** The most lines a file's header comment may take before it is reported. */
export const MAX_HEADER_LINES = 12;

const JSX_DIRECTIVE = /^\/\*\s*(?:globals?|exported)\b/;

function sourceHeaderBlock(key: string, text: string): SourceComment | undefined {
  const { blocks, limit } = analyseSource(key, text);
  return blocks.find((block) => block.start < limit && !(key.endsWith(".jsx") && JSX_DIRECTIVE.test(block.text)));
}

function headerBlock(key: string, text: string): SourceComment | undefined {
  const language = languageOf(key, text);
  if (language === ".sh" || language === ".ps1") return scriptHeaderBlock(key, text);
  if (/\.(?:h|cpp|m|mm)$/.test(key)) return cppHeaderBlock(text);
  if (key.endsWith(".iss")) return innoHeaderBlock(text);
  return sourceHeaderBlock(key, text);
}

/** The number of lines the file's opening header comment takes; 0 when it has none. */
export function headerLineCount(key: string, text: string): number {
  const block = headerBlock(key, text);
  return block ? block.endLine - block.line + 1 : 0;
}

function reportArea(key: string): string {
  return key.startsWith("native/") ? `native/${nativeAreaOf(key)}` : areaOf(key);
}

/** { areas: [[area, count]] largest first, files: ["key: header is N lines"] } for the entries whose header is over the cap. */
export function headerLengthReport(entries: ReadonlyArray<SourceEntry>): HeaderLengthReport {
  const files = entries.map(({ key, text }) => ({ key, lines: headerLineCount(key, text) })).filter((entry) => entry.lines > MAX_HEADER_LINES);
  const counts = new Map<string, number>();
  for (const { key } of files) counts.set(reportArea(key), (counts.get(reportArea(key)) ?? 0) + 1);
  return { areas: [...counts].sort((left, right) => right[1] - left[1]), files: files.map(({ key, lines }) => `${key}: header is ${lines} lines (cap ${MAX_HEADER_LINES})`) };
}
