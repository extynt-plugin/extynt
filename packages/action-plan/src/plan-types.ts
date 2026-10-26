// The plan type surface: the plan envelope, its conditions and warnings, and the operation types, which are derived from the operation decoders.

import type { SnapshotFreshness } from "@extynt/project-graph";
import type { JsonObject } from "@extynt/decode";
import type { CubicBezierCurve } from "./bezier-curve.js";
import { CURVE_PRESETS } from "./plan-constants.js";
import type { KeyframeEaseSpec, KeyframeSpec } from "./keyframe-decoder.js";
import type { ActionPlanV2Operation } from "./operation-decoder.js";
import type { SetLoopOperation } from "./layer-operation-decoders.js";
import type { PlanBounds, V2TargetReference } from "./plan-decoders.js";
import type { ShapePath, ShapePoint } from "./shape-decoder.js";

export type { CubicBezierCurve, KeyframeEaseSpec, KeyframeSpec, PlanBounds, ShapePath, ShapePoint, V2TargetReference };
export type { ActionPlanV2Operation, ExtendedOperation, OperationType } from "./operation-decoder.js";
export type { ExpressionSpec, KeyframeMode, V2CompositionTarget, V2ItemTarget } from "./operation-parts.js";
export type { CompositionSettingsFields, CreateCompositionOperation, CreateFolderOperation, ClearFootageProxyOperation, DeleteProjectItemOperation, DetectSceneEditsOperation, DuplicateCompositionOperation, FootageInterpretationValues, ImportFileOperation, MoveItemToFolderOperation, RenderCompositionOperation, ReplaceFootageOperation, SetCompositionSettingsOperation, SetFootageInterpretationOperation, SetFootageProxyOperation, SetItemNameOperation } from "./project-operation-decoders.js";
export type { CreatableLayerType, CreateLayerOperation, DuplicateLayerOperation, LayerAttributeRole, RemoveLayerOperation, ReorderLayerOperation, SetAudioOperation, SetLayerAttributeOperation, SetLayerNameOperation, SetLayerParentOperation, SetLayerTimingOperation, SetLoopOperation, SetTimeRemapOperation, SetTrackMatteOperation } from "./layer-operation-decoders.js";
export type { AddMaskOperation, CreateShapeGroupOperation, DrawVectorShapesOperation, EnsureShapeFillOperation, EnsureShapeStrokeOperation, MaskMode, MaskValues, RemoveMaskOperation, SetCameraOptionsOperation, SetLightOptionsOperation, SetMaterialOptionsOperation, SetShapePathOperation, UpdateMaskOperation, VectorShape, VectorShapeFill, VectorShapeStroke } from "./shape-operation-decoders.js";
export type { AddMarkerOperation, AnimateControlOperation, AnimatePropertyOperation, ApplyPresetOperation, EnsureEffectOperation, EnsureLayerStyleOperation, LayerStyleName, MarkerFields, MarkerTarget, RemoveMarkerOperation, SetEffectControlOperation, SetExpressionOperation, SetLayerPropertyOperation, UpdateMarkerOperation } from "./property-operation-decoders.js";
export type { EnsureTextAnimatorOperation, SetTextDocumentOperation, TextAnimatorRole, TextCharacterRange } from "./text-operation-decoders.js";
export type { CreateVectorArtworkOperation } from "./vector-artwork-decoder.js";

export const ACTION_PLAN_SCHEMA = "0.2" as const;
export type TargetReference = { compositionId: string; layerId: string; snapshotFingerprint: string; selectionFingerprint?: string; effectPath?: string; propertyPath?: string };
/** Every operation a plan carries; it is the same set the operation decoder accepts. */
export type Operation = ActionPlanV2Operation;
export interface ActionPlan { schemaVersion: typeof ACTION_PLAN_SCHEMA; planId: string; snapshotFingerprint: string; selectionFingerprint?: string; freshness?: SnapshotFreshness; summary: string; operations: Operation[]; requiresApproval: true; intent?: string; preconditions?: PlanCondition[]; postconditions?: PlanCondition[]; provenance?: { source: "user" | "agent" | "fixture"; createdAt?: string }; expiresAt?: string; bounds?: PlanBounds; conflicts?: PlanCondition[]; digest?: string; planDigest?: string; }
export type PlanCondition = string | { code: string; description: string; target?: { compositionId: string; layerId: string; effectPath?: string; propertyPath?: string } };
export function resolveCurve(curve: CubicBezierCurve | string): CubicBezierCurve | undefined { return typeof curve === "string" ? CURVE_PRESETS[curve] : curve; }
export function loopExpression(operation: Pick<SetLoopOperation, "mode" | "count" | "direction">): string { const fn = operation.direction === "in" ? "loopIn" : "loopOut"; return operation.mode === "continue" ? `${fn}("continue")` : `${fn}("${operation.mode}", ${operation.count ?? 0})`; }
/** A plan in either typed form, or one still held as JSON. */
export type PlanInput = ActionPlan | ActionPlanV2 | Omit<ActionPlanV2, "digest"> | JsonObject;

export type ActionPlanV2 = Omit<ActionPlan, "schemaVersion" | "operations" | "bounds" | "preconditions" | "postconditions" | "conflicts" | "digest" | "planDigest"> & { schemaVersion: typeof ACTION_PLAN_SCHEMA; operations: ActionPlanV2Operation[]; bounds: PlanBounds; preconditions: PlanCondition[]; conflicts: PlanCondition[]; postconditions: PlanCondition[]; digest: string; planDigest?: string; selectionFingerprint: string; freshness: SnapshotFreshness };
/** A warning-grade finding: the plan applies exactly as written, so it never changes an accepted/rejected outcome; `message` already carries the `code` prefix. `lastKeyframeSeconds` is the composition-time end of the last keyframe the same plan writes on that layer, `visibleThroughSeconds` the visible window end that cuts it (the plan's outPoint or the created composition's durationSeconds), and `operationIndex` the operation that triggered a non-timing warning. */
export interface PlanWarning {
  code: "TRIM_HIDES_ANIMATION" | "KEYFRAMES_OUTSIDE_COMPOSITION" | "RAMP_ON_SHAPE_LAYER";
  message: string;
  compositionId: string;
  layerId: string;
  propertyPath: string;
  lastKeyframeSeconds?: number;
  visibleThroughSeconds?: number;
  operationIndex?: number;
}
export type PlanValidation = { ok: true; plan: ActionPlan; warnings: PlanWarning[] } | { ok: false; code: string; message: string };
