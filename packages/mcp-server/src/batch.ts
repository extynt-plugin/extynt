// Verdict vocabulary shared by the batch tools: statuses, per-operation verdict rows, the fix text for each refusal code.
import type { JsonValue } from "@extynt/decode";

/** How one operation of a staged batch fared. */
export type OperationVerdictStatus = "accepted" | "accepted_modified" | "rejected";

/** One field the composer rewrote, in the two vocabularies the agent has to compare. */
export type OperationChange = {
  field: string;
  from: JsonValue | undefined;
  to: JsonValue | undefined;
  why: string;
};

/** One operation's outcome, and the fields the sidecar rewrote on the way in. */
export type OperationVerdict = {
  index: number;
  type: string;
  status: OperationVerdictStatus;
  detail: string;
  changes?: OperationChange[];
  code?: string;
  fix?: string;
  consequenceOf?: number;
};

const FIXES: Readonly<Record<string, string>> = {
  TARGET_NOT_FOUND: "Re-read what is in the project (ae_inspect_composition) and target an id that exists; a layer created in an earlier batch is addressed by the id its verdict reported.",
  PROPERTY_NOT_FOUND: "Check the property path with ae_inspect_layer and use one of the paths it lists, or ensure the effect that owns the control exists earlier in this batch.",
  APPLICABILITY_MISMATCH: "This operation does not apply to that layer's type; use one that does, or target a layer of the supported kind.",
  INVALID_TARGET: "Correct the target fields named in the message; a composition or layer id that is not in the current snapshot, or the wrong effect, cannot be applied.",
  INVALID_VALUE: "Write a value inside the range the message names; for a sparse vector, a null component means \"keep what is there\" and needs a number in the snapshot to fall back on.",
  INVALID_OPERATION: "Rewrite this operation to the shape ae_describe_native_operation gives for its type; the message names the field that does not fit.",
  INVALID_ARGUMENT: "Fix the field the message names and resubmit; nothing was queued.",
  CONFLICTING_KEYS: "Set keyframeMode to \"merge\" or \"replace\" on this operation so the write says what it does to the existing keyframes.",
  EFFECT_NOT_INSTALLED: "Use an effect this host has: search with ae_search_host_capabilities kinds:[\"effect\"].",
  PRESET_NOT_FOUND: "Use a preset id from ae_search_host_capabilities kinds:[\"preset\"].",
  TARGET_LOCKED: "After Effects refuses writes to a locked layer. Unlock it inside the plan with set_layer_attribute {role:\"locked\", value:false} before the edit and lock it again with value:true after the last one, or target a different layer.",
  PARENT_CYCLE: "Choose a parent that is not already inside this layer's own chain.",
  STATIC_WRITE_UNDER_KEYFRAMES: "Remove the static set_layer_property write; the first keyframe of the animate_property on the same property states the value it starts at.",
  MISSING_DEPENDENCY: "Move the operation that creates or adds the thing this one needs in front of it in the batch.",
  DUPLICATE_PLACEHOLDER: "Give each new object in one batch a distinct placeholder name.",
  UNKNOWN_FIELD: "Remove the field the message names, or move it where the message says it belongs (ids and paths live inside target, never in both places); the message lists every field this operation type accepts at the top level.",
};

/** The instruction that answers a refusal code. */
export function verdictFix(code: string): string {
  return FIXES[code] ?? "Fix the field the message names; the rest of this batch is unaffected. Nothing was queued until the whole batch validates.";
}

/** The one thing the agent must know when it splits work into batches, in the tool description's own words. */
export const BATCH_INTEROP_NOTE = "A __new__ placeholder resolves inside one batch and one After Effects command only. Group every operation on an object you are creating (create the layer, then animate it, then add its mask) into the same batch. Later batches may address that object by the same name you first gave it — the sidecar substitutes the id After Effects assigned once the earlier batch has landed, and refuses at authoring time, with instructions, if it has not.";
