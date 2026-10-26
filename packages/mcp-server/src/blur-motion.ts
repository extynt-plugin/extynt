// The panel's "Add blur and motion" change: one Gaussian Blur effect and a position move, prepared as a plan for approval.
import { BASE_CATALOGUE, resolveCapability, resolveControl } from "@extynt/capability-catalogue";
import type { CapabilityResolution, CatalogueGraph } from "@extynt/capability-catalogue";
import { computePlanDigest, issueApproval } from "@extynt/action-plan";
import type { ActionPlan } from "@extynt/action-plan";
import type { Infer, JsonValue } from "@extynt/decode";
import { getSelectedLayers } from "@extynt/project-graph";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { PlanPresentation, StoredPlan, ToolContext } from "./contracts.js";
import { AGENT_APPROVAL_TTL_MS } from "./core-constants.js";
import { jsonOf } from "./json.js";
import { noticesToWarnings } from "./notices.js";
import type { PlanNotice } from "./notices.js";
import { formatValue } from "./plan-row-format.js";
import { newPlanId, now } from "./plan-store.js";
import type { AE_PREPARE_CHANGE } from "./tool-specs-plan.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

type BlurArgs = Infer<typeof AE_PREPARE_CHANGE.input.decoder>;
type SelectedLayer = ReturnType<typeof getSelectedLayers>[number];
type Checked<T> = { readonly value: T } | ToolFailure;
type Point = readonly [number, number];

interface BlurTarget {
  readonly compositionId: string;
  readonly layer: SelectedLayer;
}

interface BlurShape {
  readonly blurAmount: number;
  readonly durationSeconds: number;
  readonly delta: Point;
}

interface PositionField {
  readonly propertyPath: string;
  readonly from: Point;
}

interface BlurField {
  readonly existing: boolean;
  readonly effectPath: string;
  readonly propertyPath: string;
  readonly before: JsonValue;
}

interface BlurScope {
  readonly snapshot: ProjectSnapshot;
  readonly catalogue: CatalogueGraph;
  readonly target: BlurTarget;
}

const DEFAULT_BLUR_AMOUNT = 24;
const DEFAULT_DURATION_SECONDS = 1;
const DEFAULT_DELTA: Point = [40, 0];
const BLUR_EFFECT_PATH = "ADBE Effect Parade/ADBE Gaussian Blur 2";
const TITLE = "Add blur and give this some motion";

function blurTarget(snapshot: ProjectSnapshot, args: BlurArgs): Checked<BlurTarget> {
  const compositionId = args.compositionId || snapshot.selection.compositionId;
  const layerId = args.layerId;
  const [layer, ...others] = getSelectedLayers(snapshot, compositionId ?? undefined).filter((candidate) => !layerId || candidate.id === layerId);
  if (!layer) return toolError("NO_SELECTION", "Select one layer in After Effects and refresh the edit context.");
  if (others.length > 0) return toolError("AMBIGUOUS_TARGET", "Select exactly one layer before preparing Add blur and motion.");
  if (layer.locked) return toolError("TARGET_LOCKED", "The selected layer is locked.");
  return { value: { compositionId: compositionId ?? "", layer } };
}

function blurInstance({ snapshot, catalogue, target }: BlurScope): Checked<CapabilityResolution> {
  const blur = resolveCapability(snapshot, { capabilityId: "adobe.gaussian-blur", compositionId: target.compositionId, layerId: target.layer.id }, catalogue);
  if (blur.status === "multiple") return toolError("AMBIGUOUS_CAPABILITY", "The selected layer has multiple Gaussian Blur effects; choose one effect instance first.");
  return { value: blur };
}

function pointOf(value: JsonValue | undefined): Point | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  return [Number(value[0]), Number(value[1])];
}

function positionField({ snapshot, catalogue, target }: BlurScope): Checked<PositionField> {
  const position = resolveControl(snapshot, { capabilityId: "adobe.transform", role: "transform.position", compositionId: target.compositionId, layerId: target.layer.id }, catalogue);
  const [control] = position.controls;
  const from = pointOf(control?.value);
  if (position.status !== "exactly-one" || !control?.canSetValue || !from) return toolError("POSITION_NOT_SETTABLE", "The selected layer does not expose one settable position property.");
  return { value: { propertyPath: control.propertyPath, from } };
}

function blurField({ snapshot, catalogue, target }: BlurScope, blur: CapabilityResolution): BlurField {
  const [existing] = blur.instances;
  const effectPath = existing?.effectPath ?? BLUR_EFFECT_PATH;
  const [control] = resolveControl(snapshot, { capabilityId: "adobe.gaussian-blur", role: "blur.amount", compositionId: target.compositionId, layerId: target.layer.id, effectPath }, catalogue).controls;
  return { existing: Boolean(existing), effectPath, propertyPath: control?.propertyPath ?? `${effectPath}/ADBE Gaussian Blur 2-0001`, before: control?.value ?? 0 };
}

function motionDelta({ motionDelta: pair }: BlurArgs): Point {
  const [dx, dy] = pair?.length === 2 ? pair : [];
  return dx !== undefined && dy !== undefined ? [dx, dy] : DEFAULT_DELTA;
}

function blurShape(args: BlurArgs): Checked<BlurShape> {
  const blurAmount = args.blurAmount ?? DEFAULT_BLUR_AMOUNT;
  const durationSeconds = args.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  if (blurAmount < 0 || blurAmount > 1000 || durationSeconds <= 0 || durationSeconds > 30) return toolError("INVALID_ARGUMENT", "blurAmount must be 0–1000 and durationSeconds must be greater than 0 and at most 30.");
  return { value: { blurAmount, durationSeconds, delta: motionDelta(args) } };
}

interface BlurChange {
  readonly target: BlurTarget;
  readonly shape: BlurShape;
  readonly position: PositionField;
  readonly control: BlurField;
}

function movedTo({ position, shape }: BlurChange): Point {
  return [position.from[0] + shape.delta[0], position.from[1] + shape.delta[1]];
}

function blurMotionPlan(snapshot: ProjectSnapshot, context: ToolContext, change: BlurChange): ActionPlan {
  const { target, shape, position, control } = change;
  const conditionTarget = { compositionId: target.compositionId, layerId: target.layer.id };
  const reference = { ...conditionTarget, snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint };
  const effectTarget = { ...reference, effectPath: control.effectPath };
  const plan: ActionPlan = {
    schemaVersion: "0.2",
    planId: newPlanId("edit"),
    snapshotFingerprint: snapshot.fingerprint,
    selectionFingerprint: snapshot.selectionFingerprint,
    freshness: snapshot.freshness,
    summary: TITLE,
    intent: "add_blur_and_motion",
    requiresApproval: true,
    bounds: { maxOperations: 3, maxKeyframes: 4, maxKeyframeTimeSeconds: 30 },
    preconditions: [{ code: "EXACT_SELECTION", description: "The selected layer and current project revision must remain unchanged.", target: conditionTarget }],
    conflicts: target.layer.locked ? [{ code: "TARGET_LOCKED", description: "The selected layer is locked.", target: conditionTarget }] : [],
    postconditions: [{ code: "BLUR_AND_MOTION_OBSERVED", description: "Gaussian Blur and animated position are observable after a fresh probe.", target: conditionTarget }],
    operations: [
      { type: "ensure_effect", target: effectTarget, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: control.effectPath },
      { type: "animate_control", target: { ...effectTarget, propertyPath: control.propertyPath }, role: "blur.amount", effectMatchName: "ADBE Gaussian Blur 2", keyframes: [{ time: 0, value: control.before }, { time: shape.durationSeconds, value: shape.blurAmount }] },
      { type: "animate_property", target: { ...reference, propertyPath: position.propertyPath }, role: "transform.position", keyframes: [{ time: 0, value: [...position.from], curve: "ease-out" }, { time: shape.durationSeconds, value: [...movedTo(change)] }] },
    ],
    provenance: { source: "agent", createdAt: now(context).toISOString() },
    digest: "",
  };
  return { ...plan, digest: computePlanDigest(plan) };
}

const ADD_BLUR_NOTICE: PlanNotice = { severity: "note", title: "Gaussian Blur is not on this layer yet.", detail: "It is added during Apply, as part of this plan." };

function blurMotionPresentation(change: BlurChange): PlanPresentation {
  const { target, shape, position, control } = change;
  const to = movedTo(change);
  const notices = control.existing ? [] : [ADD_BLUR_NOTICE];
  return {
    title: TITLE,
    target: { compositionId: target.compositionId, layerId: target.layer.id, layerName: target.layer.name },
    effect: { action: control.existing ? "Use observed" : "Add", name: "Gaussian Blur", amount: shape.blurAmount, controlPath: control.propertyPath },
    motion: { property: "Position", from: [...position.from], to: [...to], durationSeconds: shape.durationSeconds },
    values: [
      { label: "Blur amount", target: target.layer.name, before: formatValue(control.before), after: formatValue(shape.blurAmount) },
      { label: "Position", target: target.layer.name, before: formatValue([...position.from]), after: formatValue([...to]) },
    ],
    notices,
    warnings: noticesToWarnings(notices),
    approvalRequired: true,
    actions: { approve: "ae_approve_plan", cancel: "ae_cancel_plan" },
  };
}

function storeBlurMotionPlan(base: ToolBase, snapshot: ProjectSnapshot, context: ToolContext, change: BlurChange): ToolResult {
  const plan = blurMotionPlan(snapshot, context, change);
  const at = now(context).toISOString();
  const record: StoredPlan = { plan, status: "prepared", presentation: blurMotionPresentation(change), createdAt: at, updatedAt: at };
  if (context.panelSessionId) {
    const capability = issueApproval({ plan, snapshot, panelSessionId: context.panelSessionId, now: at, ttlMs: AGENT_APPROVAL_TTL_MS });
    if (!("token" in capability)) return toolError(capability.code, capability.message);
    record.approvalCapability = capability;
  }
  context.plans?.set(plan.planId, record);
  return toolSuccess(base, jsonOf({ planId: plan.planId, status: record.status, plan, presentation: record.presentation, approvalCapability: record.approvalCapability ?? null }));
}

/** Prepares the plan that adds Gaussian Blur to the one selected layer and moves its position, for the user to approve. */
export function prepareBlurMotion(base: ToolBase, snapshot: ProjectSnapshot, args: BlurArgs, context: ToolContext): ToolResult {
  const target = blurTarget(snapshot, args);
  if ("error" in target) return target;
  const scope: BlurScope = { snapshot, catalogue: context.catalogue ?? BASE_CATALOGUE, target: target.value };
  const blur = blurInstance(scope);
  if ("error" in blur) return blur;
  const position = positionField(scope);
  if ("error" in position) return position;
  const shape = blurShape(args);
  if ("error" in shape) return shape;
  return storeBlurMotionPlan(base, snapshot, context, { target: target.value, shape: shape.value, position: position.value, control: blurField(scope, blur.value) });
}
