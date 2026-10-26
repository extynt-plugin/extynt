/** Tokens and plans that tie verification cases to the objects they create in After Effects. */
import { BASE_CATALOGUE, applyEffectControlEvidence, makeHostProfile, makeInventory, makePresetInventory, type EffectProbeEvidence, type EffectProbeRow, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { HostPlanCommand } from "@extynt/host-ae";
import { compileStoredPlan } from "./stored-plan.js";
import type { StoredPlan, ToolContext } from "@extynt/mcp-server";
import { decodeOrThrow, object } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { fallback, jsonObject, list } from "./json.js";
import type { JsonObject } from "./json.js";
import { proposePlan } from "./propose.js";
import { createSnapshot, type LayerSnapshot, type LayerType, type ProjectSnapshot, type PropertySnapshot, type SnapshotInput } from "@extynt/project-graph";
import type { CaseStep, Fixture, FixtureLayer, LiveCase } from "./types.js";
import { loadFixtureEffectEvidence } from "@extynt/capability-catalogue/test-evidence";

export const CASE_COMP = "@comp";
export const layerToken = (key: string) => `@layer:${key}`;
export const compToken = (key: string) => `@comp:${key}`;
export const itemToken = (key: string) => `@item:${key}`;

const LAYER_TYPES: Record<FixtureLayer["type"], LayerType> = { text: "text", "box-text": "text", shape: "shape", solid: "av", null: "null", adjustment: "adjustment", camera: "camera", "one-node-camera": "camera", light: "light", precomp: "av", footage: "av", audio: "av" };
type Effects = EffectProbeEvidence["effects"];
type ExtraComp = NonNullable<Fixture["extraComps"]>[number];

function property(path: string, extra: Partial<PropertySnapshot> = {}): PropertySnapshot {
  const matchName = (path.split("/").pop() ?? path).replace(/#\d+$/, "");
  return { path, matchName, displayName: matchName, kind: "property", valueType: "unknown", value: null, canSetValue: true, ...extra };
}

const TRANSFORM_LEAVES = ["ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Opacity"];
const isTransformLeaf = (type: FixtureLayer["type"], leaf: string): boolean => (type !== "camera" && type !== "one-node-camera" && type !== "light") || leaf === "ADBE Position";

function baseProperties(layer: FixtureLayer): PropertySnapshot[] {
  const properties: PropertySnapshot[] = [];
  if (layer.type === "text" || layer.type === "box-text") properties.push(property("ADBE Text Properties/ADBE Text Document", { valueType: "string", value: { text: layer.text ?? "extynt", boxText: layer.type === "box-text" } }));
  for (const leaf of TRANSFORM_LEAVES) if (isTransformLeaf(layer.type, leaf)) properties.push(property(`ADBE Transform Group/${leaf}`));
  return properties;
}

const isControlRow = (row: EffectProbeRow): row is EffectProbeRow & { m: string } => typeof row.g !== "number" && !!row.m && !String(row.m).startsWith("ADBE Effect");
const controlPaths = (effectPath: string, controls: EffectProbeRow[] | undefined): string[] => (controls ?? []).filter(isControlRow).map((row) => `${effectPath}/${row.m}`);

function effectPath(matchName: string, seen: Map<string, number>): string {
  const ordinal = (seen.get(matchName) ?? 0) + 1;
  seen.set(matchName, ordinal);
  return `ADBE Effect Parade/${matchName}${ordinal > 1 ? `#${ordinal}` : ""}`;
}

function effectProperties(layer: FixtureLayer, evidence: Effects): PropertySnapshot[] {
  const properties: PropertySnapshot[] = [], seen = new Map<string, number>();
  for (const matchName of layer.effects ?? []) {
    const path = effectPath(matchName, seen);
    properties.push({ ...property(path), kind: "effect", matchName, canSetValue: false });
    for (const control of controlPaths(path, evidence[matchName]?.controls)) properties.push(property(control));
  }
  return properties;
}

function applyKeyframes(properties: PropertySnapshot[], layer: FixtureLayer): void {
  for (const keyed of layer.keyframes ?? []) {
    const existing = properties.find((entry) => entry.path === keyed.path);
    if (existing) existing.keyframeCount = keyed.times.length;
    else properties.push(property(keyed.path, { keyframeCount: keyed.times.length }));
  }
}

function applyExpression(properties: PropertySnapshot[], layer: FixtureLayer): void {
  const expression = layer.expression;
  if (!expression) return;
  const existing = properties.find((entry) => entry.path === expression.path);
  if (existing) Object.assign(existing, { expression: expression.source, expressionEnabled: true });
  else properties.push(property(expression.path, { expression: expression.source, expressionEnabled: true }));
}

function applyMarkers(properties: PropertySnapshot[], layer: FixtureLayer): void {
  if (!layer.markers?.length) return;
  properties.push(property("ADBE Marker", { value: { count: layer.markers.length, markers: layer.markers.map((time) => ({ time })) } }));
}

function applySnapshotPaths(properties: PropertySnapshot[], layer: FixtureLayer): void {
  for (const path of layer.snapshotPaths ?? []) if (!properties.some((entry) => entry.path === path)) properties.push(property(path));
}

function layerProperties(layer: FixtureLayer, evidence: Effects): PropertySnapshot[] {
  const properties = [...baseProperties(layer), ...effectProperties(layer, evidence)];
  applyKeyframes(properties, layer);
  applyExpression(properties, layer);
  applyMarkers(properties, layer);
  applySnapshotPaths(properties, layer);
  return properties;
}

function layerSource(layer: FixtureLayer): { sourceId: string | null; compositionSourceId: string | null } {
  if (!layer.source) return { sourceId: null, compositionSourceId: null };
  if (layer.type === "precomp") return { sourceId: compToken(layer.source), compositionSourceId: compToken(layer.source) };
  return { sourceId: itemToken(layer.source), compositionSourceId: null };
}

function layerSnapshot(layer: FixtureLayer, index: number, duration: number, evidence: Effects): LayerSnapshot {
  return {
    id: layerToken(layer.key),
    index: index + 1,
    name: layer.name ?? layer.key,
    type: LAYER_TYPES[layer.type],
    enabled: true,
    shy: false,
    solo: false,
    locked: layer.locked === true,
    startTime: layer.startTime ?? 0,
    inPoint: layer.inPoint ?? 0,
    outPoint: layer.outPoint ?? duration,
    stretch: 100,
    parentId: layer.parent ? layerToken(layer.parent) : null,
    matteLayerId: null,
    matteType: "none",
    isSelected: false,
    ...layerSource(layer),
    properties: layerProperties(layer, evidence),
  };
}

interface CompDefaults { name: string; width: number; height: number; duration: number; frameRate: number }
function compDefaults(fixture: Fixture): CompDefaults {
  const comp = fixture.comp ?? {};
  return { name: comp.name ?? "Case", width: comp.width ?? 320, height: comp.height ?? 180, duration: comp.duration ?? 4, frameRate: comp.frameRate ?? 24 };
}

function extraComposition(entry: ExtraComp): SnapshotInput["compositions"][number] {
  return {
    id: compToken(entry.key),
    name: entry.name,
    width: entry.width ?? 320,
    height: entry.height ?? 180,
    pixelAspect: 1,
    duration: entry.duration ?? 4,
    frameRate: entry.frameRate ?? 24,
    workAreaStart: 0,
    workAreaDuration: entry.duration ?? 4,
    layers: [],
  };
}

function snapshotItems(fixture: Fixture, compName: string, extra: SnapshotInput["compositions"]): NonNullable<SnapshotInput["items"]> {
  return [
    { id: CASE_COMP, name: compName, type: "composition", parentFolderId: null, compositionId: CASE_COMP, sourceId: null },
    ...extra.map((entry) => ({ id: entry.id, name: entry.name, type: "composition" as const, parentFolderId: null, compositionId: entry.id, sourceId: null })),
    ...(fixture.folders ?? []).map((folder) => ({ id: itemToken(folder.key), name: folder.name, type: "folder" as const, parentFolderId: null, compositionId: null, sourceId: null })),
    ...(fixture.footage ?? []).map((footage) => ({ id: itemToken(footage.key), name: footage.key, type: "footage" as const, parentFolderId: null, compositionId: null, sourceId: itemToken(footage.key) })),
  ];
}

/** A planning snapshot whose ids are the runner tokens, so the real planner validates targets, types, and paths. */
export function fixtureSnapshot(fixture: Fixture): ProjectSnapshot {
  const defaults = compDefaults(fixture);
  const evidence = loadFixtureEffectEvidence()?.effects ?? {};
  const layers = fixture.layers.map((layer, index) => layerSnapshot(layer, index, defaults.duration, evidence));
  const extra = (fixture.extraComps ?? []).map(extraComposition);
  return createSnapshot({
    capturedAt: "2026-09-15T00:00:00.000Z",
    host: { application: "After Effects", version: "live", buildNumber: null, platform: "macOS", architecture: "unknown" },
    project: { name: "extynt Live Verification", filePath: null },
    revision: "live-verification",
    activeCompositionId: CASE_COMP, currentTime: 0, selection: { compositionId: CASE_COMP, layerIds: [] },
    items: snapshotItems(fixture, defaults.name, extra),
    compositions: [
      {
        id: CASE_COMP,
        name: defaults.name,
        width: defaults.width,
        height: defaults.height,
        pixelAspect: 1,
        duration: defaults.duration,
        frameRate: defaults.frameRate,
        workAreaStart: 0,
        workAreaDuration: defaults.duration,
        layers,
      },
      ...extra,
    ],
  });
}

export type PlannedStep =
  | { kind: "plan"; planId: string; digest: string; command: HostPlanCommand; warnings: string[]; operationTypes: string[] }
  | { kind: "raw"; command: JsonObject; operationTypes: string[] }
  | { kind: "planner-rejected"; code: string; message: string; operationTypes: string[] };

/** Stable fake preset id the preset case plans against; the runner resolves a real installed .ffx at run time. */
export const LIVE_PRESET_ID = "preset:ae-presets:00000000000000000a11";
let sharedProfile: HostCapabilityProfile | undefined;

const presetSuffix = (presetId: string): string => presetId.split(":")[2] ?? presetId;

/**
 * A host profile where every evidence-backed effect is installed with its AE 26.2.1 control ranges, so planner range checks run as they do on
 * a paired host.
 */
export function plannerHostProfile(): HostCapabilityProfile {
  if (sharedProfile) return sharedProfile;
  const evidence = loadFixtureEffectEvidence();
  const matchNames = new Set([...Object.keys(evidence?.effects ?? {}), ...BASE_CATALOGUE.capabilities.flatMap((capability) => (capability.kind === "effect" && capability.matchName ? [capability.matchName] : []))]);
  const inventory = makeInventory({ application: "After Effects", version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" }, [...matchNames].map((matchName) => ({ matchName, displayName: evidence?.effects[matchName]?.name ?? matchName, available: true, evidence: [{ kind: "discovered" as const, source: "host" as const }] })));
  const presets = makePresetInventory([{ id: presetSuffix(LIVE_PRESET_ID), root: "ae-presets", name: "Live verification preset", category: "Live", statFingerprint: "live" }], false, "2026-09-15T00:00:00.000Z");
  const profile = makeHostProfile(inventory, undefined, presets);
  sharedProfile = evidence ? applyEffectControlEvidence(profile, evidence) : profile;
  return sharedProfile;
}

type PlanStep = Extract<CaseStep, { operations: JsonObject[] }>;
interface PlanContext { liveCase: LiveCase; context: ToolContext; plans: Map<string, StoredPlan> }

const rawOperations: Decoder<{ operations: JsonObject[] }> = object({ operations: fallback<JsonObject[]>(list(jsonObject), () => []) });

function rawStep(rawCommand: JsonObject, index: number, liveCase: LiveCase): PlannedStep {
  const { operations } = decodeOrThrow(rawOperations, rawCommand);
  return {
    kind: "raw",
    command: { operation: "apply_plan", planId: `live-${liveCase.id}-${index}`, undoGroup: `extynt — live-${index}`, ...rawCommand },
    operationTypes: operations.map((operation) => String(operation.operation)),
  };
}

function compiledStep(record: StoredPlan, command: HostPlanCommand, operationTypes: string[]): PlannedStep {
  return { kind: "plan", planId: record.plan.planId, digest: String(record.plan.digest ?? ""), command, warnings: record.presentation?.warnings ?? [], operationTypes };
}

function plannedStep(step: PlanStep, plan: PlanContext): PlannedStep {
  const operationTypes = step.operations.map((operation) => String(operation.type));
  const proposal = proposePlan(step.summary ?? plan.liveCase.title.slice(0, 500), step.operations, plan.context);
  if (proposal.kind === "refused") return { kind: "planner-rejected", code: proposal.code, message: proposal.message, operationTypes };
  const record = plan.plans.get(proposal.planId);
  if (!record) return { kind: "planner-rejected", code: "UNKNOWN", message: "", operationTypes };
  const compiled = compileStoredPlan(record.plan);
  if ("ok" in compiled) return { kind: "planner-rejected", code: compiled.code, message: compiled.message, operationTypes };
  return compiledStep(record, compiled, operationTypes);
}

function planStep(step: CaseStep, index: number, plan: PlanContext): PlannedStep {
  return "rawCommand" in step ? rawStep(step.rawCommand, index, plan.liveCase) : plannedStep(step, plan);
}

/** Plan → Validate → Compile, through the same entry points an agent uses. */
export function planCase(liveCase: LiveCase): PlannedStep[] {
  const snapshot = fixtureSnapshot(liveCase.fixture);
  const plans = new Map<string, StoredPlan>();
  const context: ToolContext = { snapshot, plans, hostProfile: plannerHostProfile(), now: () => new Date("2026-09-15T00:00:00.000Z") };
  return liveCase.steps.map((step, index) => planStep(step, index, { liveCase, context, plans }));
}
