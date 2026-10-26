/** Compares what a verification case read back with what it expected. */
import { isJsonArray } from "@extynt/decode";
import { isJsonObject, type JsonObject, type JsonValue } from "./json.js";
import type { Check, HostStepRecord, KeyEntry, PropEntry, PropField, ReadbackView } from "./types.js";

type PropCheck = Extract<Check, { kind: "prop" }>;
type KeysCheck = Extract<Check, { kind: "keys" }>;
type ChildrenCheck = Extract<Check, { kind: "children" }>;
type LayerCheck = Extract<Check, { kind: "layer" }>;
type LayerCountCheck = Extract<Check, { kind: "layerCount" }>;
type CompCheck = Extract<Check, { kind: "comp" }>;
type ItemCheck = Extract<Check, { kind: "item" }>;
type HostCheck = Extract<Check, { kind: "host" }>;
type FileCheck = Extract<Check, { kind: "file" }>;
type HostFileCheck = Extract<Check, { kind: "hostFile" }>;
type CustomCheck = Extract<Check, { kind: "custom" }>;

type LayerSurfaceCheck = Extract<Check, { kind: "prop" | "keys" | "children" | "layer" | "layerCount" | "comp" | "item" }>;
type HostReceiptCheck = Extract<Check, { kind: "host" | "file" | "hostFile" }>;

const LAYER_SURFACE_KINDS: ReadonlySet<string> = new Set(["prop", "keys", "children", "layer", "layerCount", "comp", "item"]);
const HOST_RECEIPT_KINDS: ReadonlySet<string> = new Set(["host", "file", "hostFile"]);
const isLayerSurfaceCheck = (check: Check): check is LayerSurfaceCheck => LAYER_SURFACE_KINDS.has(check.kind);
const isHostReceiptCheck = (check: Check): check is HostReceiptCheck => HOST_RECEIPT_KINDS.has(check.kind);

const resolveTokens = (value: JsonValue | undefined, tokens: Record<string, string>): JsonValue | undefined => {
  if (typeof value === "string" && Object.hasOwn(tokens, value)) return tokens[value];
  return isJsonArray(value) ? value.map((entry) => resolveTokens(entry, tokens) ?? null) : value;
};

function sameObject(actual: JsonValue | undefined, expected: JsonObject, tolerance: number): boolean {
  return isJsonObject(actual) && Object.entries(expected).every(([key, entry]) => sameValue(actual[key], entry, tolerance));
}

const sameNumber = (actual: JsonValue | undefined, expected: number, tolerance: number): boolean => typeof actual === "number" && Math.abs(actual - expected) <= tolerance;

function sameValue(actual: JsonValue | undefined, expected: JsonValue | undefined, tolerance = 1e-4): boolean {
  if (typeof expected === "number") return sameNumber(actual, expected, tolerance);
  if (isJsonArray(expected))
    return isJsonArray(actual) && actual.length === expected.length && expected.every((entry, index) => sameValue(actual[index], entry, tolerance));
  return isJsonObject(expected) ? sameObject(actual, expected, tolerance) : actual === expected;
}

function approxValue(actual: JsonValue | undefined, expected: number | number[], tolerance: number): boolean {
  if (typeof expected === "number") return typeof actual === "number" ? Math.abs(actual - expected) <= tolerance : Array.isArray(actual) && actual.length === 1 && Math.abs(Number(actual[0]) - expected) <= tolerance;
  return Array.isArray(actual) && actual.length >= expected.length && expected.every((entry, index) => typeof actual[index] === "number" && Math.abs(Number(actual[index]) - entry) <= tolerance);
}

const numericExpectation = (expected: JsonValue): number | number[] | undefined => {
  if (typeof expected === "number") return expected;
  return Array.isArray(expected) && expected.every((entry) => typeof entry === "number") ? expected.map(Number) : undefined;
};

type ValueKey = "v" | "n" | "x" | "xe" | "xr" | "en" | "nm" | "h" | "c" | "sep";
const PROP_FIELDS: Record<PropField, ValueKey> = { value: "v", numKeys: "n", expression: "x", expressionEnabled: "xe", expressionError: "xr", enabled: "en", name: "nm", hidden: "h", numProperties: "c", separated: "sep" };
export const fmt = (value: JsonValue | undefined): string => { const text = JSON.stringify(value); return text === undefined ? "undefined" : text.length > 160 ? `${text.slice(0, 160)}…` : text; };

export const applySteps = (host: HostStepRecord[]): HostStepRecord[] => host.filter((step) => step.phase === "apply");

/** The first problem a check finds, or undefined; the first failing branch decides the message. */
export function evaluateCheck(check: Check, view: ReadbackView, host: HostStepRecord[]): string | undefined {
  if (isLayerSurfaceCheck(check)) return evaluateLayerSurface(check, view);
  if (isHostReceiptCheck(check)) return evaluateHostReceipt(check, view, host);
  return evaluateCustom(check, view);
}

function evaluateLayerSurface(check: LayerSurfaceCheck, view: ReadbackView): string | undefined {
  switch (check.kind) {
    case "prop": return evaluateProp(check, view);
    case "keys": return evaluateKeys(check, view);
    case "children": return evaluateChildren(check, view);
    case "layer": return evaluateLayer(check, view);
    case "layerCount": return evaluateLayerCount(check, view);
    case "comp": return evaluateComp(check, view);
    case "item": return evaluateItem(check, view);
  }
}

function evaluateHostReceipt(check: HostReceiptCheck, view: ReadbackView, host: HostStepRecord[]): string | undefined {
  switch (check.kind) {
    case "host": return evaluateHost(check, host);
    case "file": return evaluateFile(check, view);
    case "hostFile": return evaluateHostFile(check, view, host);
  }
}

function evaluateCustom(check: CustomCheck, view: ReadbackView): string | undefined {
  try { const problem = check.check(view); return problem ? `${check.describe}: ${problem}` : undefined; }
  catch (error) { return `${check.describe}: check threw ${error instanceof Error ? error.message : String(error)}`; }
}

function propField(entry: PropEntry, field: PropField | undefined): JsonValue | undefined {
  const value = entry[PROP_FIELDS[field ?? "value"]];
  return field === "expressionError" && value === undefined ? "" : value;
}

const propLabel = (check: PropCheck): string => `${check.path} ${check.field ?? "value"}`;

function propValueProblem(check: PropCheck, actual: JsonValue | undefined, view: ReadbackView): string | undefined {
  if (check.approx !== undefined) return approxValue(actual, check.approx, check.tolerance ?? 0.001) ? undefined : `${propLabel(check)} ${fmt(actual)}, expected ≈${fmt(check.approx)}`;
  return sameValue(actual, resolveTokens(check.equals, view.tokens), check.tolerance) ? undefined : `${propLabel(check)} ${fmt(actual)}, expected ${fmt(check.equals)}`;
}

function evaluateProp(check: PropCheck, view: ReadbackView): string | undefined {
  const entry = view.prop(check.layer, check.path, check.comp);
  if (check.exists !== undefined) return !!entry === check.exists ? undefined : `${check.path} ${entry ? "exists" : "is missing"}`;
  if (!entry) return `${check.path} is missing`;
  return propValueProblem(check, propField(entry, check.field), view);
}

const keyTimesMatch = (keys: KeyEntry[], times: number[], tolerance: number): boolean =>
  keys.length === times.length && times.every((time, index) => Math.abs((keys[index]?.t ?? NaN) - time) <= tolerance);
const keyValueMatches = (actual: JsonValue | undefined, expected: JsonValue, tolerance: number): boolean => {
  const approx = numericExpectation(expected);
  return (approx !== undefined && approxValue(actual, approx, tolerance)) || sameValue(actual, expected, tolerance);
};
const keyValuesMatch = (keys: KeyEntry[], values: JsonValue[], tolerance: number): boolean =>
  values.every((expected, index) => keyValueMatches(keys[index]?.v, expected, tolerance));
const keyInterpolationMatches = (keys: KeyEntry[], interpolation: Array<[string, string]>): boolean =>
  interpolation.every(([inType, outType], index) => keys[index]?.ii === inType && keys[index]?.oi === outType);

function keysProblem(check: KeysCheck, keys: KeyEntry[], tolerance: number): string | undefined {
  if (check.times && !keyTimesMatch(keys, check.times, tolerance)) return `${check.path} key times ${fmt(keys.map((key) => key.t))}, expected ${fmt(check.times)}`;
  if (check.values && !keyValuesMatch(keys, check.values, tolerance)) return `${check.path} key values ${fmt(keys.map((key) => key.v ?? null))}, expected ${fmt(check.values)}`;
  if (check.interpolation && !keyInterpolationMatches(keys, check.interpolation)) return `${check.path} interpolation ${fmt(keys.map((key) => [key.ii ?? null, key.oi ?? null]))}, expected ${fmt(check.interpolation)}`;
  return undefined;
}

function evaluateKeys(check: KeysCheck, view: ReadbackView): string | undefined {
  const entry = view.prop(check.layer, check.path, check.comp);
  return keysProblem(check, entry?.k ?? [], check.tolerance ?? 0.001);
}

function directChildCount(view: ReadbackView, layerId: string, path: string, matchName: string): number {
  const prefix = `${layerId}|${path}/`;
  return Object.entries(view.sections.props).filter(([key, entry]) => entry && key.startsWith(prefix) && !key.slice(prefix.length).includes("/") && entry.mn === matchName).length;
}

function evaluateChildren(check: ChildrenCheck, view: ReadbackView): string | undefined {
  const id = view.layerId(check.layer, check.comp); if (!id) return `layer ${fmt(check.layer)} missing`;
  const count = directChildCount(view, id, check.path, check.matchName);
  return count === check.count ? undefined : `${check.path} has ${count} × ${check.matchName}, expected ${check.count}`;
}

function layerValueProblem(check: LayerCheck, actual: JsonValue | undefined, view: ReadbackView): string | undefined {
  if (check.approx !== undefined) return approxValue(actual, check.approx, check.tolerance ?? 0.0005) ? undefined : `layer ${check.field} ${fmt(actual)}, expected ≈${fmt(check.approx)}`;
  return sameValue(actual, resolveTokens(check.equals, view.tokens)) ? undefined : `layer ${check.field} ${fmt(actual)}, expected ${fmt(resolveTokens(check.equals, view.tokens))}`;
}

function evaluateLayer(check: LayerCheck, view: ReadbackView): string | undefined {
  const attrs = view.layer(check.layer, check.comp);
  if (check.exists !== undefined) return !!attrs === check.exists ? undefined : `layer ${fmt(check.layer)} ${attrs ? "exists" : "is missing"}`;
  if (!attrs) return `layer ${fmt(check.layer)} missing`;
  return layerValueProblem(check, attrs[check.field], view);
}

function compScope(view: ReadbackView, ref: LayerCountCheck["comp"]): string | null | undefined {
  if (!ref || ref === "case") return view.caseCompId;
  return Object.entries(view.sections.comps).find(([, comp]) => comp?.name === ref.name)?.[0];
}

function evaluateLayerCount(check: LayerCountCheck, view: ReadbackView): string | undefined {
  const scope = compScope(view, check.comp);
  const count = Object.values(view.sections.layers).filter((attrs) => attrs?.comp === scope).length;
  return count === check.equals ? undefined : `layer count ${count}, expected ${check.equals}`;
}

function compValueProblem(check: CompCheck, actual: JsonValue | undefined, view: ReadbackView): string | undefined {
  if (check.approx !== undefined) return approxValue(actual, check.approx, check.tolerance ?? 0.001) ? undefined : `comp ${check.field} ${fmt(actual)}, expected ≈${fmt(check.approx)}`;
  return sameValue(actual, resolveTokens(check.equals, view.tokens)) ? undefined : `comp ${check.field} ${fmt(actual)}, expected ${fmt(check.equals)}`;
}

function evaluateComp(check: CompCheck, view: ReadbackView): string | undefined {
  const comp = view.comp(check.comp);
  if (check.exists !== undefined) return !!comp === check.exists ? undefined : `comp ${comp ? "exists" : "missing"}`;
  if (!comp) return `comp ${fmt(check.comp ?? "case")} missing`;
  return compValueProblem(check, comp[check.field], view);
}

function itemValueProblem(check: ItemCheck, item: JsonObject, view: ReadbackView): string | undefined {
  return check.field === undefined || sameValue(item[check.field], resolveTokens(check.equals, view.tokens)) ? undefined : `item ${check.field} ${fmt(item[check.field])}, expected ${fmt(resolveTokens(check.equals, view.tokens))}`;
}

function evaluateItem(check: ItemCheck, view: ReadbackView): string | undefined {
  const items = Object.values(view.sections.items).filter((item) => item?.name === check.name);
  if (check.count !== undefined) return items.length === check.count ? undefined : `${items.length} item(s) named ${check.name}, expected ${check.count}`;
  if (check.exists !== undefined) return (items.length > 0) === check.exists ? undefined : `item ${check.name} ${items.length ? "exists" : "missing"}`;
  const item = items[0]; if (!item) return `item ${check.name} missing`;
  return itemValueProblem(check, item, view);
}

function evaluateHost(check: HostCheck, host: HostStepRecord[]): string | undefined {
  const step = applySteps(host)[check.step ?? 0];
  if (!step) return `no host result for step ${check.step ?? 0}`;
  return hostStepProblem(check, step);
}

const hostError = (response: JsonObject | null): JsonValue | undefined => (response === null ? undefined : response.error);
function hostErrorCode(response: JsonObject | null): JsonValue | undefined {
  const error = hostError(response);
  return isJsonObject(error) ? error.code : undefined;
}
const responseField = (response: JsonObject | null, field: string): JsonValue | undefined => (response === null ? undefined : response[field]);

function hostStepProblem(check: HostCheck, step: HostStepRecord): string | undefined {
  const response = step.response;
  if (check.ok !== undefined && step.ok !== check.ok) return `host step ${check.step ?? 0} ok=${step.ok}: ${fmt(hostError(response))}`;
  if (check.code !== undefined && hostErrorCode(response) !== check.code) return `host code ${fmt(hostErrorCode(response))}, expected ${check.code}`;
  if (check.field === undefined) return undefined;
  const actual = responseField(response, check.field);
  return sameValue(actual, check.equals) ? undefined : `host ${check.field} ${fmt(actual)}, expected ${fmt(check.equals)}`;
}

function evaluateFile(check: FileCheck, view: ReadbackView): string | undefined {
  const suffix = check.name.replace("/EXTYNT_OUT_DIR", "");
  const entry = Object.entries(view.sections.files).find(([key]) => key.endsWith(suffix))?.[1];
  if (!entry) return `file ${suffix} was not checked by the runner`;
  if (entry.exists !== check.exists) return `file ${suffix} exists=${entry.exists}, expected ${check.exists}`;
  return check.minBytes !== undefined && check.exists && Number(entry.bytes ?? 0) < check.minBytes ? `file ${suffix} is ${entry.bytes} bytes` : undefined;
}

function hostWrittenFile(host: HostStepRecord[], step: number | undefined): string | undefined {
  const applies = applySteps(host);
  const steps = applies[step ?? applies.length - 1]?.response?.steps;
  const files = isJsonArray(steps) ? steps.map((entry) => (isJsonObject(entry) ? entry.file : undefined)) : [];
  return files.find((name): name is string => typeof name === "string" && name.length > 0);
}

function evaluateHostFile(check: HostFileCheck, view: ReadbackView, host: HostStepRecord[]): string | undefined {
  const reported = hostWrittenFile(host, check.step);
  if (!reported) return `the host reported no written file`;
  const entry = view.sections.files[reported];
  if (!entry) return `file ${reported} was not checked by the runner`;
  if (!entry.exists) return `the host reported writing ${reported}, which does not exist`;
  return check.minBytes !== undefined && Number(entry.bytes ?? 0) < check.minBytes ? `file ${reported} is ${entry.bytes} bytes` : undefined;
}
