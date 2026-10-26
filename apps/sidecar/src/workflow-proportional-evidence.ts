// Grades how much proof a verified host read-back gives a batch: exact values and structural changes are proved by the read-back and need no rendered frame.

import { VISUAL_WAIVER } from "@extynt/decide";
import type { Operation } from "@extynt/action-plan";
import type { WorkflowHostEvidence, WorkflowReceipt, WorkflowVerificationKind } from "@extynt/workflow";
import { bookedYesNo } from "./decision-book.js";
import type { WorkflowPlanRecord } from "./workflow-coordinator-types.js";
import { goalAsksForJudgement, goalNamesNoSceneOrMotion } from "./workflow-goal-evidence.js";

/** What the sidecar knows about a job beyond its goal words: whether a scene or a motion was designed for it. */
export interface EvidenceContext {
  readonly goal?: string;
  readonly designed: boolean;
  readonly motion: boolean;
}

interface EvidenceLabel {
  readonly idPrefix: string;
  readonly kind: WorkflowVerificationKind;
  readonly basis: string;
}

const EXACT_VALUE_OPERATIONS: ReadonlySet<string> = new Set(["ensure_effect", "set_effect_control", "set_layer_property", "set_layer_attribute", "ensure_layer_style"]);

const STRUCTURAL_OPERATIONS: ReadonlySet<string> = new Set([
  "create_composition", "duplicate_composition", "create_folder", "set_composition_settings", "set_composition_guides", "set_project_settings", "save_project", "move_item_to_folder", "set_item_name",
  "set_layer_name", "set_layer_parent", "set_layer_timing", "retime_layer", "dolly_camera", "set_time_remap", "set_loop", "reorder_layer", "remove_layer", "duplicate_layer",
  "add_marker", "update_marker", "remove_marker", "set_expression", "animate_property", "animate_control",
  "set_layer_property", "set_layer_attribute", "set_effect_control", "set_text_document", "set_audio", "set_camera_options", "set_light_options",
]);

const EXACT_VALUES_BASIS = "exact values applied and read back: every written value was confirmed by the host read-back (not a rendered-frame check)";

const PROPORTIONAL_BASIS: Readonly<Record<"visual" | "temporal", string>> = {
  visual: "structural change applied and read back by the host: every written value was confirmed (no rendered frame was captured, none is claimed)",
  temporal: "values, timing, expressions and keyframes applied and read back by the host; no motion was designed for this job, so no sampled frames are claimed",
};

function isStructural(operation: Operation): boolean {
  if (operation.type === "create_layer") return operation.layerType !== "shape";
  return STRUCTURAL_OPERATIONS.has(operation.type);
}

function everyOperation(record: WorkflowPlanRecord, accepts: (operation: Operation) => boolean): boolean {
  return record.plan.operations.length > 0 && record.plan.operations.every(accepts);
}

function readBackConfirmed(record: WorkflowPlanRecord, receipt: WorkflowReceipt): boolean {
  if (receipt.execution !== "executed" || receipt.verification !== "verified" || receipt.mutation !== "applied") return false;
  return receipt.outcomes.length === record.plan.operations.length
    && receipt.outcomes.every((row) => row.outcome === "confirmed" && row.verification === "verified" && row.mutation === "applied");
}

function readBackEvidence(label: EvidenceLabel, record: WorkflowPlanRecord, receipt: WorkflowReceipt, now: string): WorkflowHostEvidence {
  return {
    evidenceId: `${label.idPrefix}:${receipt.receiptId}`.slice(0, 128),
    jobId: record.jobId,
    batchId: record.batchId,
    kind: label.kind,
    basis: label.basis,
    ...(receipt.observedFingerprint ? { observedFingerprint: receipt.observedFingerprint } : {}),
    recordedAt: now,
  };
}

function modelWaiver(goal: string | undefined): boolean | undefined {
  return goal === undefined ? undefined : bookedYesNo({ decision: VISUAL_WAIVER.name, text: goal });
}

/** Whether the visual waiver holds for the goal of a job with this design context: nothing was designed or animated and the goal asks for no look, so read-backs stand in for a picture. */
export function visualWaiverGranted(context: EvidenceContext): boolean {
  if (context.goal === undefined || context.designed || context.motion) return false;
  return modelWaiver(context.goal) ?? goalNamesNoSceneOrMotion(context.goal);
}

function waivedKinds(context: EvidenceContext): readonly ("visual" | "temporal")[] {
  const picture = !context.designed && (modelWaiver(context.goal) ?? !(context.goal !== undefined && goalAsksForJudgement(context.goal)));
  return [...(picture ? ["visual" as const] : []), ...(context.motion ? [] : ["temporal" as const])];
}

/**
 * A request that only sets exact values (effects, controls, layer properties and attributes, layer styles) is proved by the verified host read-back, so it needs no
 * rendered frame. This never infers a look from wording: a goal about the scene, a match or a judgement keeps its visual requirement, and so does any plan that
 * creates, animates or scripts, because their effect on the picture is not their written value.
 */
export function exactValuesEvidence(goal: string | undefined, record: WorkflowPlanRecord, receipt: WorkflowReceipt, now: string): WorkflowHostEvidence | undefined {
  const waived = modelWaiver(goal);
  if (goal === undefined || waived === false || (waived === undefined && !goalNamesNoSceneOrMotion(goal))) return undefined;
  if (!everyOperation(record, (operation) => EXACT_VALUE_OPERATIONS.has(operation.type)) || !readBackConfirmed(record, receipt)) return undefined;
  return readBackEvidence({ idPrefix: "exact-values", kind: "visual", basis: EXACT_VALUES_BASIS }, record, receipt, now);
}

/**
 * Evidence for a verified, fully confirmed batch of structural operations: its read-back stands in for a picture only when nothing was designed and the goal asks
 * for no judgement, and for motion samples only when no motion was designed. The evidence says so and claims nothing about a render.
 */
export function proportionalEvidence(context: EvidenceContext, record: WorkflowPlanRecord, receipt: WorkflowReceipt, now: string): readonly WorkflowHostEvidence[] {
  if (!everyOperation(record, isStructural) || !readBackConfirmed(record, receipt)) return [];
  return waivedKinds(context).map((kind) => readBackEvidence({ idPrefix: `proportional-${kind}`, kind, basis: PROPORTIONAL_BASIS[kind] }, record, receipt, now));
}
