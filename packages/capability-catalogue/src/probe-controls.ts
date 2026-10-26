// Turns live effect-control probe evidence, collected on this computer, into control schemas on host profile entries.
import type { ControlSchema, EffectProbeEvidence, EffectProbeRow, HostCapabilityProfile, HostProfileEntry } from "./catalogue-model.js";
import { decode } from "@extynt/decode";
import { jsonValue } from "./decoder-kit.js";
import { EFFECT_HOST_CAVEATS } from "./effect-control-evidence.js";
import { markUserAssisted } from "./user-assisted.js";

const MAX_GROUP_DEPTH = 3;

interface ProbeValueType {
  readonly valueType: string;
  readonly dimensions?: number;
}

const PROBE_VALUE_TYPES: ReadonlyArray<readonly [string, ProbeValueType]> = [
  ["OneD", { valueType: "number" }],
  ["TwoD", { valueType: "vector", dimensions: 2 }],
  ["TwoD_SPATIAL", { valueType: "vector", dimensions: 2 }],
  ["ThreeD", { valueType: "vector", dimensions: 3 }],
  ["ThreeD_SPATIAL", { valueType: "vector", dimensions: 3 }],
  ["COLOR", { valueType: "color", dimensions: 4 }],
  ["LAYER_INDEX", { valueType: "layer" }],
  ["MASK_INDEX", { valueType: "mask" }],
  ["SHAPE", { valueType: "shape" }],
  ["TEXT_DOCUMENT", { valueType: "text-document" }],
  ["CUSTOM_VALUE", { valueType: "custom" }],
  ["NO_VALUE", { valueType: "none" }],
  ["MARKER", { valueType: "marker" }],
];

const UNKNOWN_VALUE_TYPE: ProbeValueType = { valueType: "unknown" };

interface ProbeRowState {
  readonly rows: readonly EffectProbeRow[];
  readonly out: ControlSchema[];
  index: number;
}

function probeMenu(row: EffectProbeRow): string[] | undefined {
  return row.dd && row.items?.length ? row.items : undefined;
}

function probeDefault(row: EffectProbeRow): Pick<ControlSchema, "defaultValue"> {
  const decoded = decode(jsonValue, row.v);
  return !decoded.ok || decoded.value === null ? {} : { defaultValue: decoded.value };
}

function probeBounds(row: EffectProbeRow): Pick<ControlSchema, "min" | "max"> {
  return { ...(typeof row.min === "number" ? { min: row.min } : {}), ...(typeof row.max === "number" ? { max: row.max } : {}) };
}

function probeFlags(row: EffectProbeRow): Pick<ControlSchema, "animatable" | "hidden"> {
  return { ...(row.static ? { animatable: false as const } : {}), ...(row.hid ? { hidden: true as const } : {}) };
}

function controlFromProbeRow(row: EffectProbeRow, path: string, matchName: string): ControlSchema {
  const type = PROBE_VALUE_TYPES.find(([kind]) => kind === row.t)?.[1] ?? UNKNOWN_VALUE_TYPE;
  const menu = probeMenu(row);
  return {
    path, matchName, displayName: row.n ?? matchName, valueType: menu ? "enum" : type.valueType,
    ...(type.dimensions ? { dimensions: type.dimensions } : {}), ...probeDefault(row), ...probeBounds(row),
    ...(row.u ? { units: row.u } : {}), ...(menu ? { menu } : {}), ...probeFlags(row),
  };
}

function visitProbeRows(state: ProbeRowState, prefix: string, depth: number, budget: number): void {
  for (let taken = 0; taken < budget; taken += 1) {
    const row = state.rows[state.index];
    if (row === undefined) return;
    state.index += 1;
    const matchName = row.m ?? "";
    const path = `${prefix}/${matchName}`;
    if (typeof row.g !== "number") {
      state.out.push(controlFromProbeRow(row, path, matchName));
      continue;
    }
    state.out.push({ path, matchName, displayName: row.n ?? matchName, valueType: "group" });
    if (depth < MAX_GROUP_DEPTH) visitProbeRows(state, path, depth + 1, row.g);
  }
}

/** The control schemas a flattened probe table describes: a group row consumes the number of rows it declares. */
export function controlsFromProbeRows(effectMatchName: string, rows: readonly EffectProbeRow[]): ControlSchema[] {
  const state: ProbeRowState = { rows, out: [], index: 0 };
  visitProbeRows(state, effectMatchName, 0, Number.POSITIVE_INFINITY);
  return state.out;
}

/** The overlay wins per effect; the base fills the rest. Both are evidence observed on this machine. */
export function mergeEffectControlEvidence(base: EffectProbeEvidence | undefined, overlay: EffectProbeEvidence | undefined): EffectProbeEvidence | undefined {
  if (!base) return overlay;
  if (!overlay) return base;
  const userAssisted = [...new Set([...(base.userAssisted ?? []), ...(overlay.userAssisted ?? [])])];
  return { host: overlay.host ?? base.host, ...(userAssisted.length ? { userAssisted } : {}), effects: { ...base.effects, ...overlay.effects } };
}

function mergeProbedControl(known: ControlSchema | undefined, control: ControlSchema): ControlSchema {
  return known ? { ...known, ...control, ...(known.role ? { role: known.role } : {}) } : control;
}

function mergedProbedControls(entry: HostProfileEntry, live: readonly ControlSchema[]): ControlSchema[] {
  const curated = new Map((entry.evidence.includes("curated") ? entry.controls ?? [] : []).map((control) => [control.matchName, control]));
  const liveMatchNames = new Set(live.map((control) => control.matchName));
  const merged = live.map((control) => mergeProbedControl(curated.get(control.matchName), control));
  return [...merged, ...[...curated.values()].filter((control) => !liveMatchNames.has(control.matchName))];
}

function probedOperationStatus(entry: HostProfileEntry, caveat: { message: string } | undefined): HostProfileEntry["operationStatus"] {
  if (caveat) return "unsupported";
  return entry.availability === "available" ? "supported" : entry.operationStatus;
}

function probedDescription(entry: HostProfileEntry, leafCount: number): string {
  if (entry.evidence.includes("curated")) return entry.description;
  return `Installed ${entry.category ? `${entry.category} ` : ""}effect ${entry.displayName}; ${leafCount} probed controls.`;
}

function probedProvenance(entry: HostProfileEntry, evidence: EffectProbeEvidence): string {
  const version = evidence.host?.version;
  return `${entry.provenance}; controls live-probed${version ? ` on AE ${version}` : ""}`;
}

function probedEntry(entry: HostProfileEntry, matchName: string, rows: readonly EffectProbeRow[], evidence: EffectProbeEvidence): HostProfileEntry {
  const controls = mergedProbedControls(entry, controlsFromProbeRows(matchName, rows));
  const caveat = EFFECT_HOST_CAVEATS[matchName];
  return {
    ...entry,
    controls,
    ...(caveat ? { requirements: [...new Set([...(entry.requirements ?? []), caveat.message])] } : {}),
    operationStatus: probedOperationStatus(entry, caveat),
    probeState: "probed",
    evidence: [...new Set([...entry.evidence, "probed" as const])],
    description: probedDescription(entry, controls.filter((control) => control.valueType !== "group").length),
    provenance: probedProvenance(entry, evidence),
  };
}

function applyProbe(entry: HostProfileEntry, evidence: EffectProbeEvidence): HostProfileEntry {
  const matchName = entry.kind === "effect" ? entry.matchName : undefined;
  const rows = matchName ? evidence.effects[matchName]?.controls : undefined;
  return matchName && rows ? probedEntry(entry, matchName, rows, evidence) : entry;
}

/** The profile with probed controls merged into the entries the evidence covers, and user assisted marks added; the profile itself when nothing changed. */
export function applyEffectControlEvidence(profile: HostCapabilityProfile, evidence: EffectProbeEvidence): HostCapabilityProfile {
  const observed = new Set(evidence.userAssisted ?? []);
  const entries = profile.entries.map((entry) => {
    const applied = applyProbe(entry, evidence);
    return entry.kind === "effect" && entry.matchName && observed.has(entry.matchName) ? markUserAssisted(applied, "observed-interactive") : applied;
  });
  if (entries.every((entry, position) => entry === profile.entries[position])) return profile;
  return { ...profile, entries, probeNeeded: profile.probeNeeded.filter((id) => !entries.some((entry) => entry.id === id && entry.probeState === "probed")) };
}
