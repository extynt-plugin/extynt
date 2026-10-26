/**
 * The catalogue probe pages the fake plugin answers: each requested effect's controls, read from the seed profile, in the row shape
 * `aeCatalogueProbePage` returns.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeJson } from "@extynt/decode";
import { isWireArray, isWireObject, wireObject } from "@extynt/fake-plugin";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { listOf, numberMember, pick, stringMember } from "./wire-reads.js";
import type { WireObject, WireValue } from "./wire-types.js";

const HOST_TYPES: ReadonlyMap<string, string> = new Map([
  ["number", "OneD"], ["enum", "OneD"], ["color", "COLOR"], ["layer", "LAYER_INDEX"], ["mask", "MASK_INDEX"], ["shape", "SHAPE"], ["custom", "CUSTOM_VALUE"], ["none", "NO_VALUE"],
]);
const MAX_CONTROLS = 96;

const objectsOf = (value: WireValue | undefined): WireObject[] => listOf(value).filter(isWireObject);

function hostTypeOf(control: WireObject): string | null {
  const valueType = stringMember(control, "valueType");
  if (valueType === "vector") return control.dimensions === 3 ? "ThreeD" : "TwoD";
  return valueType === undefined ? null : HOST_TYPES.get(valueType) ?? null;
}

function indexOf(control: WireObject, position: number): number {
  const suffix = /-(\d{4})$/.exec(stringMember(control, "matchName") ?? "");
  return suffix?.[1] ? Number(suffix[1]) : position + 1;
}

function rangeOf(control: WireObject): WireObject {
  const min = numberMember(control, "min"), max = numberMember(control, "max");
  return { ...(min === undefined ? { hasMin: false } : { hasMin: true, min }), ...(max === undefined ? { hasMax: false } : { hasMax: true, max }) };
}

function menuOf(control: WireObject): string[] | null {
  const menu = control.menu;
  return isWireArray(menu) ? menu.filter((item): item is string => typeof item === "string") : null;
}

function rowOf(control: WireObject, position: number): WireObject {
  const menu = menuOf(control);
  return {
    ...pick(control, ["matchName"]), ...(control.displayName === undefined ? {} : { name: control.displayName }), index: indexOf(control, position), kind: "property", childCount: 0, children: [],
    valueType: hostTypeOf(control), defaultValue: control.defaultValue ?? null, ...rangeOf(control),
    unitsText: stringMember(control, "units") ?? null, items: menu, isDropdown: menu !== null, canVary: true, canSetExpression: true, hidden: false,
  };
}

function isTopLevelControl(control: WireObject): boolean {
  const named = typeof control.matchName === "string" && typeof control.displayName === "string";
  return named && String(control.path).split("/").length === 2;
}

function resultOf(entry: WireObject): WireObject {
  const controls = objectsOf(entry.controls).filter(isTopLevelControl);
  return {
    ...pick(entry, ["matchName", "displayName"]), controls: controls.slice(0, MAX_CONTROLS).map(rowOf),
    truncated: controls.length > MAX_CONTROLS, applyMs: 0, createdItems: 0,
  };
}

function isAvailableEffect(entry: WireObject): boolean {
  const named = typeof entry.matchName === "string" && typeof entry.displayName === "string";
  return named && entry.kind === "effect" && entry.availability === "available";
}

function entriesOf(directory: string): Map<string, WireObject> {
  try {
    const decoded = decodeJson(readFileSync(join(directory, "host-capability-profile.json"), "utf8"), wireObject);
    const entries = decoded.ok ? objectsOf(decoded.value.entries) : [];
    return new Map(entries.filter(isAvailableEffect).map((entry) => [String(entry.matchName), entry]));
  } catch { return new Map(); }
}

/** One answered page: the effects the seed describes come back with their controls, the rest as a host refusal, so nothing is left pending for ever. */
export function cataloguePageOf(input: { args: WireObject; host: ProjectSnapshot["host"]; profileDirectory: string }): WireObject {
  const known = entriesOf(input.profileDirectory), asked = listOf(input.args.matchNames).map(String);
  const results = asked.flatMap((matchName) => { const entry = known.get(matchName); return entry ? [resultOf(entry)] : []; });
  const failures = asked.filter((matchName) => !known.has(matchName)).map((matchName) => ({ matchName, code: "EFFECT_NOT_FOUND", detail: "The fixture host does not describe this effect." }));
  return { schemaVersion: "0.1", ok: true, requestId: String(input.args.requestId ?? ""), host: { version: input.host.version, build: input.host.buildNumber }, results, failures, remaining: [], elapsedMs: 0, cleanedUp: true };
}
