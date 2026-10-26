// The snapshots a single-layer read-set plan reconciles to: the layer's one effect or control read back exactly, with every other composition and layer left unknown.
import { decode } from "@extynt/decode";
import type { Infer, JsonObject, JsonValue } from "@extynt/decode";
import { sameValue } from "./compare-values.js";
import { readbackBound, reconciled } from "./metadata-plan.js";
import type { ReadSetPlan } from "./metadata-plan.js";
import { blurReadback, creationInventory, creationReadback, initializationShape } from "./metadata-shapes.js";
import type { BlurTarget, CreatedControl, CreateTarget, HostStamp, LayerRowView, LocalMetadata, TargetBase } from "./metadata-shapes.js";

const GAUSSIAN = "ADBE Gaussian Blur 2";

interface Local<T extends TargetBase> {
  readonly target: T;
  readonly row: LayerRowView;
  readonly metadata: LocalMetadata;
}

function rowMatches(row: LayerRowView, target: TargetBase): boolean {
  const atTarget = row.compositionId === target.compositionId && row.layerId === target.layerId && row.layerIndex === target.layerIndex;
  return atTarget && row.operationIndex === 0 && row.name === target.name && row.locked === false;
}

function metadataMatches(metadata: LocalMetadata, row: LayerRowView, target: TargetBase): boolean {
  const { composition, layer } = metadata;
  if (composition.view.id !== target.compositionId || composition.view.itemIndex !== target.itemIndex) return false;
  const atTarget = layer.view.id === target.layerId && layer.view.index === target.layerIndex && layer.view.name === target.name;
  return atTarget && layer.view.locked === false && layer.view.selected === row.selected;
}

function localOf<T extends TargetBase>(targets: ReadonlyArray<T>, observed: { readonly rows: ReadonlyArray<LayerRowView>; readonly metadata: LocalMetadata }): Local<T> | null {
  const [target] = targets;
  const [row] = observed.rows;
  if (targets.length !== 1 || observed.rows.length !== 1 || !target || !row) return null;
  return rowMatches(row, target) && metadataMatches(observed.metadata, row, target) ? { target, row, metadata: observed.metadata } : null;
}

function effectProperty(enabled: boolean | undefined): JsonObject {
  const shared = { path: `ADBE Effect Parade/${GAUSSIAN}`, matchName: GAUSSIAN, displayName: "Gaussian Blur", kind: "effect", valueType: "unknown", value: null, canSetValue: false };
  return enabled === undefined ? shared : { ...shared, enabled };
}

function controlProperty(matchName: string, value: number, displayName: string): JsonObject {
  return { path: `ADBE Effect Parade/${GAUSSIAN}/${matchName}`, matchName, displayName, kind: "property", valueType: "number", value, canSetValue: true, keyframeCount: 0, expressionEnabled: false, expression: "" };
}

function localSnapshot(build: { readonly plan: ReadSetPlan; readonly stamp: HostStamp; readonly local: Local<TargetBase>; readonly requestId: string }, evidence: JsonObject, propertyPaths: ReadonlyArray<JsonObject>): JsonObject {
  const { plan, stamp, local, requestId } = build;
  const { target, row, metadata } = local;
  const composition = { ...metadata.composition.row, layers: [{ ...metadata.layer.row, propertyPaths }] };
  const coverage = { kind: "composition-metadata", compositionId: target.compositionId, properties: "unknown", otherCompositions: "unknown", otherLayers: "unknown", observedLayerIds: [target.layerId], ...evidence };
  const selectedLayerIds = metadata.activeCompositionId === target.compositionId && row.selected ? [target.layerId] : [];
  const result = { coverage, activeCompositionId: metadata.activeCompositionId, selectedLayerIds, compositions: [composition] };
  return reconciled(plan, { stamp }, { requestId, result });
}

/** The reconciled snapshot when the host read back the one blur control at exactly the value the plan set; otherwise null. */
export function blurSnapshot(plan: ReadSetPlan, targets: ReadonlyArray<BlurTarget>, readback: JsonValue | undefined, requestId: string): JsonObject | null {
  const decoded = decode(blurReadback, readback);
  if (!decoded.ok || !readbackBound(plan, decoded.value)) return null;
  const observed = decoded.value;
  const local = localOf(targets, observed);
  if (!local || local.row.value !== local.target.desiredValue) return null;
  const { desiredValue, localEffect } = local.target;
  if (!sameValue(observed.localEffect.row, { ...localEffect, value: desiredValue })) return null;
  const properties = [effectProperty(observed.localEffect.view.effectEnabled), controlProperty("ADBE Gaussian Blur 2-0001", desiredValue, "Blurriness")];
  return localSnapshot({ plan, stamp: observed.stamp, local, requestId }, { localEffect: observed.localEffect.row }, properties);
}

function controlMatches(control: CreatedControl, value: number | undefined, index: number): boolean {
  if (control.matchName !== `${GAUSSIAN}-000${index + 1}` || control.value !== value) return false;
  const unanimated = control.keyframeCount === 0 && control.expressionEnabled === false && control.expression === "";
  return unanimated && control.minimum <= control.maximum && control.value >= control.minimum && control.value <= control.maximum;
}

function startingValues(initialization: JsonValue | undefined): ReadonlyArray<number> | null {
  const decoded = decode(initializationShape, initialization);
  return decoded.ok ? [decoded.value.blurriness, decoded.value.dimensions, decoded.value.repeatEdgePixels ? 1 : 0] : null;
}

type CreatedEffect = Infer<typeof creationReadback>["createdEffect"];

function controlsMatch(view: CreatedEffect["view"], values: ReadonlyArray<number>): boolean {
  return view.controls.length === 3 && view.controls.every((control, index) => controlMatches(control, values[index], index));
}

function inventoryGrown(target: CreateTarget, created: CreatedEffect): boolean {
  const inventory = decode(creationInventory, target.localCreation);
  const { view, row } = created;
  if (!inventory.ok) return false;
  const grown = [...inventory.value.inventory, { index: inventory.value.inventory.length + 1, matchName: GAUSSIAN }];
  const added = view.effectMatchName === GAUSSIAN && view.effectIndex === grown.length && view.enabled === target.enabled;
  return added && view.dependencyPolicy === "local-effect-creation" && sameValue(row.inventory, grown);
}

function createdAsPlanned(target: CreateTarget, created: CreatedEffect): boolean {
  const values = startingValues(target.initialization);
  return values !== null && inventoryGrown(target, created) && controlsMatch(created.view, values);
}

/** The reconciled snapshot when the host read back the new Gaussian Blur with exactly the starting values the plan asked for; otherwise null. */
export function creationSnapshot(plan: ReadSetPlan, targets: ReadonlyArray<CreateTarget>, readback: JsonValue | undefined, requestId: string): JsonObject | null {
  const decoded = decode(creationReadback, readback);
  if (!decoded.ok || !readbackBound(plan, decoded.value)) return null;
  const observed = decoded.value;
  const local = localOf(targets, observed);
  if (!local || local.row.created !== true || !createdAsPlanned(local.target, observed.createdEffect)) return null;
  const { view, row } = observed.createdEffect;
  const properties = [effectProperty(view.enabled), ...view.controls.map((control) => controlProperty(control.matchName, control.value, control.matchName))];
  return localSnapshot({ plan, stamp: observed.stamp, local, requestId }, { createdEffect: row }, properties);
}
