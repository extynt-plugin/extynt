// Builds the receipt of an apply from the host's answer: what ran, what was created, how the project may have changed, and what the plan was approved against.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { boundedCreationEvidence } from "./creation-evidence.js";
import { frameCheckRows } from "./frame-check.js";
import type { ApplyCommand, ApplyContext, HostApplyResult, ReceiptDraft } from "./host-types.js";
import { numberField, textField } from "./json-fields.js";

const STEP_LIMIT = 256;
const SOURCE_LIMIT = 16;
const PLACEHOLDER_PREFIX = "__new__:";
const CREATED_ID_PAIRS = [
  ["requestedLayerId", "layerId"],
  ["requestedCompositionId", "compositionId"],
  ["requestedFolderId", "folderId"],
  ["requestedItemId", "itemId"],
  ["requestedNewCompositionId", "newCompositionId"],
] as const;
const KEYFRAME_OPERATIONS: ReadonlySet<string> = new Set(["animate_property", "animate_control"]);

type Steps = ReadonlyArray<JsonObject>;

function stepsOf(parsed: HostApplyResult): Steps {
  return parsed.steps ?? [];
}

function createdPairsOf(step: JsonObject): Array<[string, string]> {
  return CREATED_ID_PAIRS.flatMap(([requested, actual]): Array<[string, string]> => {
    const placeholder = textField(step, requested);
    const id = textField(step, actual);
    return placeholder?.startsWith(PLACEHOLDER_PREFIX) && id ? [[placeholder, id]] : [];
  });
}

/** The real ids of the layers, compositions, folders and items the plan created, by the `__new__:` name the plan gave them. */
export function createdApplyIds(parsed: HostApplyResult): { ids: Record<string, string>; count: number } {
  const ids: Record<string, string> = {};
  let count = 0;
  for (const step of stepsOf(parsed)) {
    if (count >= STEP_LIMIT) break;
    for (const [placeholder, id] of createdPairsOf(step)) {
      ids[placeholder] = id;
      count += 1;
    }
  }
  return { ids, count };
}

/** The keyframe writes among the applied steps: the property, the mode, and how many keys went and stayed. */
export function applyKeyframeSteps(parsed: HostApplyResult): Array<{ propertyPath: string; keyframeMode: string | null; removedKeys: number; afterKeys: number | null }> {
  return stepsOf(parsed)
    .filter((step) => KEYFRAME_OPERATIONS.has(textField(step, "operation") ?? ""))
    .slice(0, STEP_LIMIT)
    .map((step) => ({
      propertyPath: (textField(step, "propertyPath") ?? "").slice(0, 160),
      keyframeMode: textField(step, "keyframeMode")?.slice(0, 16) ?? null,
      removedKeys: numberField(step, "removedKeys") ?? 0,
      afterKeys: numberField(step, "afterKeys") ?? null,
    }));
}

function completedOperationsOf(parsed: HostApplyResult): string[] {
  return stepsOf(parsed).slice(0, STEP_LIMIT).map((step) => (textField(step, "operation") || "unknown").slice(0, 64));
}

function boundedList(list: ReadonlyArray<JsonValue> | undefined): ReadonlyArray<JsonValue> | undefined {
  return list?.slice(0, SOURCE_LIMIT);
}

function commandBatchSize(command: ApplyCommand): number | undefined {
  return typeof command.batchSize === "number" && command.batchSize >= 1 ? command.batchSize : undefined;
}

function failedUndoGroups(parsed: HostApplyResult, batchSize: number | undefined): number | undefined {
  const index = parsed.failedOperationIndex;
  if (parsed.ok || parsed.mayHaveMutated !== true || parsed.phase !== "apply" || !batchSize || index === undefined || index < 0) return undefined;
  return Math.floor(index / batchSize) + 1;
}

function undoGroupsOf(parsed: HostApplyResult, batchSize: number | undefined): number | undefined {
  const changed = parsed.changedUndoGroups;
  if (changed !== undefined && changed >= 0) return Math.floor(changed);
  return parsed.undoGroups || failedUndoGroups(parsed, batchSize);
}

function failureOf(parsed: HostApplyResult): ReceiptDraft["failure"] {
  if (parsed.ok) return undefined;
  const phase = parsed.phase === "apply" || parsed.phase === "preflight" ? parsed.phase : "unknown";
  return { phase, operationIndex: parsed.failedOperationIndex ?? -1, operation: parsed.failedOperation?.slice(0, 64) ?? null };
}

function hostErrorOf(parsed: HostApplyResult): { code: string; message: string } | undefined {
  if (parsed.ok || !parsed.error) return undefined;
  return { code: String(parsed.error.code || "HOST_MUTATION_FAILED").slice(0, 64), message: String(parsed.error.message || "Host apply failed.").slice(0, 256) };
}

function postconditionOf(parsed: HostApplyResult): string {
  if (parsed.ok) return "pending_refresh";
  return parsed.mayHaveMutated === true ? "partial_mutation_possible" : "not_run";
}

function mutationStateOf(parsed: HostApplyResult, completed: ReadonlyArray<string>): string | undefined {
  if (parsed.ok) return completed.length > 0 ? "applied" : "not-applied";
  return parsed.mutationState?.slice(0, 64);
}

function successFields(parsed: HostApplyResult, completed: ReadonlyArray<string>): ReceiptDraft {
  return {
    status: "executed",
    appliedOperations: completed,
    completedOperations: undefined,
    mayHaveMutated: completed.length > 0,
    frameChecks: frameCheckRows(parsed.frameChecks),
    rollback: undefined,
  };
}

function rejectionFields(parsed: HostApplyResult, completed: ReadonlyArray<string>): ReceiptDraft {
  return {
    status: "rejected",
    appliedOperations: [],
    completedOperations: completed,
    mayHaveMutated: parsed.mayHaveMutated === true,
    frameChecks: undefined,
    rollback: parsed.receipt?.rollback?.slice(0, 96),
  };
}

function outcomeFields(parsed: HostApplyResult, completed: ReadonlyArray<string>): ReceiptDraft {
  return {
    ...(parsed.ok === true ? successFields(parsed, completed) : rejectionFields(parsed, completed)),
    postcondition: postconditionOf(parsed),
    creationEvidence: boundedCreationEvidence(parsed.creationEvidence),
    externalOutputs: boundedList(parsed.externalOutputs),
    mutationState: mutationStateOf(parsed, completed),
    failure: failureOf(parsed),
    hostError: hostErrorOf(parsed),
  };
}

/** The receipt of an apply: the plan, the timings, the undo steps it left, what it created, and the outcome the host reported. */
export function makeApplyReceipt(context: ApplyContext, parsed: HostApplyResult, hostApplyMs?: number): ReceiptDraft {
  const { approvedData, command } = context;
  const completed = completedOperationsOf(parsed);
  const created = createdApplyIds(parsed);
  const keyframeSteps = applyKeyframeSteps(parsed);
  const batchSize = commandBatchSize(command);
  return {
    planId: approvedData.planId,
    operation: "apply_plan",
    hostProbeMs: context.hostProbeMs,
    hostApplyMs,
    ...(command.readSet ? { scopedUndoUnsupported: true } : {}),
    undoGroups: undoGroupsOf(parsed, batchSize),
    batchSize: parsed.batchSize || batchSize,
    created: created.count ? created.ids : undefined,
    keyframeSteps: keyframeSteps.length ? keyframeSteps : undefined,
    managedSources: boundedList(parsed.managedSources),
    approvalId: context.approval ? context.approval.token : null,
    beforeFingerprint: approvedData.plan && approvedData.plan.snapshotFingerprint,
    ...outcomeFields(parsed, completed),
  };
}
