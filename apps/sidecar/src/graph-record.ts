// Shared helpers of the graph files: the scope a page is stored under, stored flags and numeric components, and the loosely typed record helpers older callers still use.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { decode, decodeOrThrow } from "@extynt/decode";
import { countOrNull, pageProject } from "./native-page.js";
import type { GraphProject } from "./native-page.js";
import { wireObject } from "./wire-object.js";

/** The page kinds the graph stores row by row. */
export type GraphDetailKind = "index" | "layers" | "properties" | "values";

/** Legacy name for an open JSON object; new code uses JsonObject. */
export type GraphRecord = JsonObject;

/** The composition, layer and property path (as `/`-joined indices) a page is stored under, with its kind. */
export type ScopeKey = readonly [kind: string, compositionId: string, layerId: string, propertyPath: string];

/** The numbers of a value in storage form: a scalar, a vector of up to 16 finite numbers, or unknown. */
export interface NumericComponents { shape: "scalar" | "vector" | "unknown"; values: number[] }

const KINDS: ReadonlySet<string> = new Set<GraphDetailKind>(["index", "layers", "properties", "values"]);

/** Legacy: an object as a JSON object, or an empty one when the value is not a JSON object. */
export function graphRecord(value: JsonValue | undefined): JsonObject {
  const found = decode(wireObject, value);
  return found.ok ? found.value : {};
}

/** Legacy: a native count, or null when the value is not a non-negative safe integer. */
export function graphOrdinal(value: JsonValue | undefined): number | null {
  return decodeOrThrow(countOrNull, value);
}

/** Legacy: identifies the project a page describes; delegates to the native page reader. */
export function graphProject(page: GraphRecord, session: string): GraphProject {
  return pageProject(page, session);
}

/** True when the kind is one of the page kinds stored row by row. */
export function isDetailKind(kind: string): kind is GraphDetailKind {
  return KINDS.has(kind);
}

/** The scope key of a page target. */
export function graphScope(target: { kind: string; compositionId?: string | undefined; layerId?: string | undefined; propertyIndices?: readonly number[] | undefined }): ScopeKey {
  return [target.kind, target.compositionId ?? "", target.layerId ?? "", (target.propertyIndices ?? []).join("/")];
}

/** A flag as SQLite stores it: 1, 0, or null when unknown. */
export function graphFlag(value: boolean | null | undefined): number | null {
  return typeof value === "boolean" ? Number(value) : null;
}

/** A value's numbers in storage form. */
export function numericComponents(value: number | readonly number[] | null): NumericComponents {
  if (typeof value === "number" && Number.isFinite(value)) return { shape: "scalar", values: [value] };
  if (value === null || typeof value === "number") return { shape: "unknown", values: [] };
  const vector = value.length >= 1 && value.length <= 16 && value.every((component) => Number.isFinite(component));
  return vector ? { shape: "vector", values: [...value] } : { shape: "unknown", values: [] };
}
