/** The controls a fixture effect gets when a plan adds it: the hand-written ones first, then the top-level controls the fixture host profile lists for it. */

import { readFileSync } from "node:fs";
import { decodeJson } from "@extynt/decode";
import { isWireArray, isWireObject, wireObject } from "@extynt/fake-plugin";
import type { PropertySnapshot } from "@extynt/project-graph";
import type { JsonValue } from "@extynt/decode";
import { EFFECT_CONTROLS, EFFECT_PARADE } from "./fake-host-tables.js";
import { toJson } from "./fake-host-values.js";
import type { WireObject, WireValue } from "./wire-types.js";

interface Profile { controls: Map<string, PropertySnapshot[]>; names: Map<string, string> }

const PROFILE_URL = new URL("../../fixtures/host-profile/host-capability-profile.json", import.meta.url);

const VALUE_TYPES: readonly PropertySnapshot["valueType"][] = ["number", "string", "boolean", "color", "vector", "layer", "enum", "unknown"];

let loaded: Profile | undefined;

function valueTypeOf(raw: WireValue | undefined): PropertySnapshot["valueType"] {
  return VALUE_TYPES.find((type) => type === raw) ?? "unknown";
}

function controlProperty(matchName: string, control: WireObject): PropertySnapshot | undefined {
  const { matchName: name, path, displayName } = control;
  const value: JsonValue | undefined = toJson(control.defaultValue);
  if (typeof name !== "string" || typeof path !== "string" || path.split("/").length !== 2) return undefined;
  if (control.valueType === "group" || value === undefined) return undefined;
  return { path: `${EFFECT_PARADE}/${matchName}/${name}`, matchName: name, displayName: typeof displayName === "string" ? displayName : name, kind: "property", valueType: valueTypeOf(control.valueType), value, canSetValue: true };
}

function controlsOf(matchName: string, raw: WireValue | undefined): PropertySnapshot[] {
  const rows = isWireArray(raw) ? raw.filter(isWireObject) : [];
  return rows.map((control) => controlProperty(matchName, control)).filter((property): property is PropertySnapshot => property !== undefined);
}

function readProfile(): Profile {
  const profile: Profile = { controls: new Map(), names: new Map() };
  const decoded = decodeJson(readFileSync(PROFILE_URL, "utf8"), wireObject);
  if (!decoded.ok) throw new Error(decoded.error.message);
  const entries = decoded.value.entries;
  for (const entry of isWireArray(entries) ? entries.filter(isWireObject) : []) {
    const { matchName, displayName } = entry;
    if (typeof matchName !== "string") continue;
    if (typeof displayName === "string") profile.names.set(matchName, displayName);
    if (isWireArray(entry.controls)) profile.controls.set(matchName, controlsOf(matchName, entry.controls));
  }
  return profile;
}

function profileOf(): Profile {
  loaded ??= readProfile();
  return loaded;
}

/** The name After Effects shows for an added effect: the profile's, else its match name. */
export function effectDisplayName(matchName: string): string { return profileOf().names.get(matchName) ?? matchName; }

/** The controls the fixture models for `matchName`; empty when neither source knows the effect. */
export function effectControlsFor(matchName: string): readonly PropertySnapshot[] {
  return EFFECT_CONTROLS[matchName] ?? profileOf().controls.get(matchName) ?? [];
}
