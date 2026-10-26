// The tools that author, approve, apply and undo plans.
import { arrayArg, arrayOrTextArg, booleanArg, enumArg, freeObjectArg, numberArg, objectArg, optionalArg, stringArg, unionArg } from "./arg.js";
import { PLAN_ID, VERBOSE, waitArg, operationArg } from "./tool-shapes.js";
import { PLAN_UNDO_BATCH_SIZE } from "@extynt/host-ae";
import { BATCH_INTEROP_NOTE } from "./batch.js";
import { PROPOSAL_OPERATION_LIMIT } from "./core-constants.js";
import { defineTool } from "./tool.js";
import type { ToolEntry } from "./tool.js";

export const AE_PREPARE_CHANGE = defineTool("ae_prepare_change", {
  description: "Panel demo: prepare the blur-and-motion change.",
  access: "write",
  input: {
    blurAmount: optionalArg(numberArg({ min: 0, max: 1000 })),
    durationSeconds: optionalArg(numberArg({ max: 30, exclusiveMin: 0 })),
    motionDelta: optionalArg(arrayArg(numberArg({ min: -10000, max: 10000 }), { minItems: 2, maxItems: 2 })),
    compositionId: optionalArg(stringArg({ maxLength: 128 })),
    layerId: optionalArg(stringArg({ maxLength: 128 })),
  },
});

export const AE_PROPOSE_PLAN = defineTool("ae_propose_plan", {
  description: "Compose an approval-required plan from typed operations (schemas via ae_describe_native_operation). Returns planId and one line per operation. Propose the whole request in one plan: a long plan is applied in bounded undo groups so it can be undone a piece at a time. apply:true also approves and returns the receipt in one call (acknowledgeUnverified as in ae_approve_plan).",
  access: "write",
  planCard: true,
  input: {
    summary: stringArg({ minLength: 1, maxLength: 512 }),
    apply: optionalArg(booleanArg({ description: "Approve and apply right after a successful proposal." })),
    acknowledgeUnverified: optionalArg(booleanArg({ description: "With apply: as ae_approve_plan." })),
    waitSeconds: waitArg(20),
    svg: optionalArg(stringArg({ description: "A drawn scene as one <svg viewBox=\"0 0 W H\"> built into native shape layers (one per top-level group, bottom to top) before operations. Rules: ae_get_build_kit. Target: compositionId, a create_composition in operations at W×H, or the open comp." })),
    compositionId: optionalArg(stringArg({ description: "With svg: the existing composition to draw into." })),
    operations: optionalArg(arrayArg(operationArg(), { minItems: 1, maxItems: PROPOSAL_OPERATION_LIMIT })),
    verbose: VERBOSE,
  },
});

export const AE_CREATE_VECTOR_ARTWORK = defineTool("ae_create_vector_artwork", {
  description: "Create an approval-required plan from SVG markup passed as text in `svg` - the SVG code itself, never a file path; to use an .svg file, read the file and pass its complete contents unchanged as `svg`. extynt validates the markup now; after approval it writes it to its managed app-data directory and imports it (natively on After Effects 26+; on 25 through extynt's converter, whose receipt names what it approximated or skipped) as an editable native-shape composition spanning the target composition's duration and frame rate (default one second at 30 fps without a target). There is no path parameter. Gradients are preserved. Linked mode is refused in this build. Optionally add the imported composition as a layer in an existing composition.",
  access: "write",
  planCard: true,
  input: {
    svg: stringArg({ minLength: 1, maxLength: 262144, description: "The complete SVG markup as text (the full contents of an .svg file), not a file path. No DTD/entities, scripts, handlers, foreignObject, external resources, CSS/fonts/images, or non-local URLs." }),
    name: stringArg({ minLength: 1, maxLength: 256 }),
    importMode: optionalArg(enumArg(["editable", "linked"], { description: "editable is supported; linked returns VECTOR_MODE_UNSUPPORTED." })),
    destinationFolderId: optionalArg(stringArg({ description: "Optional existing AE project-folder id." })),
    targetCompositionId: optionalArg(stringArg({ description: "Optional existing composition to receive the artwork as one precomp layer; its duration and frame rate are copied." })),
    layerName: optionalArg(stringArg({ minLength: 1, maxLength: 256 })),
  },
});

export const AE_QUEUE_ADD = defineTool("ae_queue_add", {
  description: "Queue the operations you are sure of, one or a coherent group per call; you never need the whole change first. Each is validated on arrival: accepted, accepted with the fields the sidecar corrected, or rejected with the one fix. A refused operation leaves every independent one queued: the answer lists the refused positions and their dependents, so resend only those, corrected, never the ones already queued. Nothing applies until you finish; you never need a plan id.",
  access: "write",
  planCard: true,
  input: {
    operations: arrayOrTextArg(arrayArg(operationArg(), { minItems: 1 })),
    summary: optionalArg(stringArg({ maxLength: 512, description: "Optional title for the reader's card; one is derived from the first operation when omitted." })),
  },
});

export const AE_QUEUE_FIX = defineTool("ae_queue_fix", {
  description: "Change operations the queue already holds, by index, instead of re-sending work that was accepted. Each edit is {op, index, operation} with op replace, remove or insert; a seal refusal names the indexes to use. An operation the queue refused was never queued — correct that one and send it again with ae_queue_add.",
  access: "write",
  planCard: true,
  input: {
    edits: arrayOrTextArg(arrayArg(objectArg({
      op: enumArg(["replace", "remove", "insert"]),
      index: numberArg({ description: "0-based index in the queue as it stands." }),
      operation: optionalArg(freeObjectArg({ description: "The operation to write, for replace and insert." })),
    }, { open: true }), { minItems: 1, maxItems: 64 })),
    summary: optionalArg(stringArg({ maxLength: 512 })),
  },
});

export const AE_QUEUE_FINISH = defineTool("ae_queue_finish", {
  description: "Say that the queued work is whole. The sidecar judges everything queued together — placeholders, ordering, dependencies — and anything unresolved comes back by index to fix. On success the plan is sealed and the sidecar applies it through the After Effects plugin in bounded undo groups, in order.",
  access: "write",
  planCard: true,
  input: {},
});

export const AE_WORKFLOW_COMPLETE = defineTool("ae_workflow_complete", {
  description: "Close the workflow job once the verified receipts cover the request. Call it with no arguments: the sidecar cites its own verified batch receipts and the observations taken. If a criterion lacks evidence the answer names it and what to take (visually: ae_capture_composition_frame plus ae_observe_frame). goalDigest, criterionIds and evidence are optional and checked as written. unbuilt lists checklist items you tried and could not build, each with its reason.",
  access: "write",
  input: {
    unbuilt: optionalArg(arrayArg(objectArg({
      id: stringArg(),
      reason: stringArg({ maxLength: 240 }),
    }), { maxItems: 200 })),
    goalDigest: optionalArg(stringArg({ minLength: 64, maxLength: 64 })),
    criterionIds: optionalArg(arrayArg(stringArg({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 64 })),
    evidence: optionalArg(arrayArg(objectArg({
      criterionId: stringArg({ minLength: 1, maxLength: 128 }),
      reference: unionArg([
        objectArg({
          kind: enumArg(["batch_receipt"]),
          batchId: stringArg({ minLength: 1, maxLength: 128 }),
          receiptId: stringArg({ minLength: 1, maxLength: 128 }),
        }),
        objectArg({
          kind: enumArg(["observation"]),
          evidenceId: stringArg({ minLength: 1, maxLength: 128 }),
        }),
      ], { description: "Use batch_receipt for verified apply/read-back evidence, or observation for validator-owned structural, visual, or temporal evidence recorded in this workflow." }),
    }), { minItems: 1, maxItems: 64 })),
  },
});

export const AE_PLAN_CREATE = defineTool("ae_plan_create", {
  description: `Start a plan the sidecar owns, for work too large to get right in one proposal. Returns a planId immediately; fill it in with ae_plan_add, read it back at any time with ae_recall_plan, and seal it with ae_plan_complete. Nothing about the work is validated at creation, so begin with the operations you are sure of, one coherent group at a time; each is validated as you write it, so a mistake costs one operation rather than the whole plan. Add as many batches as the work needs — the plan itself has no size limit. The one ceiling is ae_plan_add's: it takes at most ${PLAN_UNDO_BATCH_SIZE} operations in one call and refuses a longer batch rather than splitting it, so a bigger plan is more batches, never a smaller plan. ae_propose_plan is the one-shot alternative; the operations are identical in both. Omit jobId to start a genuinely new job; pass the jobId a previous batch returned to continue that job, which is what relates its batches, gives them one status line, and lets ae_undo_plan scope "job" take them all back together.`,
  access: "write",
  planCard: true,
  input: {
    summary: stringArg({ minLength: 1, maxLength: 512 }),
    jobId: optionalArg(stringArg({ minLength: 1, maxLength: 128, description: "Continue the job a previous ae_plan_create returned. Omit to start a new job; nothing infers this from the summary or the project." })),
  },
});

export const AE_PLAN_ADD = defineTool("ae_plan_add", {
  description: `Add operations to a plan you are authoring (from ae_plan_create). Send the group you are sure of; you never need the whole plan before you start. One call takes at most ${PLAN_UNDO_BATCH_SIZE} operations: that ceiling is this tool's, not the plan's, and a longer batch is refused rather than split, so send the rest in another call. Every operation is validated against the plan so far and answered with a verdict: accepted, accepted with the fields the sidecar adjusted, or rejected with the code and the single fix. A batch is staged whole or not at all, so if any operation is rejected, fix it and send the batch again — the accepted operations in that batch are not kept either. The plan stays open. ${BATCH_INTEROP_NOTE}`,
  access: "write",
  planCard: true,
  input: {
    planId: PLAN_ID,
    operations: arrayArg(operationArg(), { minItems: 1 }),
    verbose: VERBOSE,
  },
});

export const AE_PLAN_COMPLETE = defineTool("ae_plan_complete", {
  description: "Seal a plan you authored with ae_plan_create and ae_plan_add. This is where the whole plan is judged: placeholder binding, ordering, cycles, and every dependency must now resolve, and anything unresolved is reported per operation with what would fix it. On success the digest is sealed over exactly these operations and the approval card is issued, so nothing can change afterwards.",
  access: "write",
  planCard: true,
  input: {
    planId: PLAN_ID,
    verbose: VERBOSE,
  },
});

export const AE_AMEND_PLAN = defineTool("ae_amend_plan", {
  description: "Change a plan you already proposed, by operation index, instead of writing it again. Edits apply in the order given, each index addressing the plan as the previous edits left it: replace, remove, or insert one operation. The plan keeps its id and approval card. Re-run after a refusal naming several operations to see what is left.",
  access: "write",
  planCard: true,
  input: {
    planId: PLAN_ID,
    summary: optionalArg(stringArg({ maxLength: 512 })),
    edits: arrayArg(objectArg({
      op: enumArg(["replace", "remove", "insert"], { description: "replace the operation at index, remove it, or insert a new one before it." }),
      index: numberArg({ description: "0-based position in the plan as the previous edits left it." }),
      operation: optionalArg(freeObjectArg({ description: "The operation to write, for replace and insert." })),
    }, { open: true }), { minItems: 1, maxItems: 64 }),
  },
});

export const AE_LIST_PLANS = defineTool("ae_list_plans", {
  description: "Recent plans from any source, newest first.",
  input: {
    limit: optionalArg(numberArg()),
  },
});

export const AE_PRESENT_PLAN = defineTool("ae_present_plan", {
  description: "Human-readable approval card for a plan.",
  access: "write",
  input: {
    planId: PLAN_ID,
  },
});

export const AE_GET_PLAN_STATUS = defineTool("ae_get_plan_status", {
  description: "Plan status and compact receipt. While a plan is queued or applying it waits for the next change and reports the host pipeline (queue position, busy, stalled or offline, and why).",
  input: {
    planId: PLAN_ID,
    waitSeconds: waitArg(15),
    verbose: VERBOSE,
  },
});

export const AE_RECALL_PLAN = defineTool("ae_recall_plan", {
  description: "Read a stored plan's operations back in full, at any status, instead of rebuilding the plan from memory; it is how to build a delta: read it, then amend the wrong operation by index. Operations come back whole in the same 0-based indexing ae_amend_plan edits. Long plans page: nextCursor continues, limit (default 64, max 256) sets the page. Amending is accepted only while a plan is editable (draft, prepared, presented); recalling changes nothing.",
  input: {
    planId: PLAN_ID,
    cursor: optionalArg(numberArg({ min: 0, description: "0-based operation index to start at; pass nextCursor from an earlier recall." })),
    limit: optionalArg(numberArg({ min: 1, max: PROPOSAL_OPERATION_LIMIT, description: "Operations per page (default 64). Raise it to take a whole short plan in one call." })),
  },
});

export const AE_APPROVE_PLAN = defineTool("ae_approve_plan", {
  description: "Approve a plan; the sidecar applies and verifies it through the After Effects plugin. Plans with operations not yet verified on this After Effects build need acknowledgeUnverified:true. Waits for and returns the compact receipt. Approvals run one at a time in order; a queued plan is rebased only over earlier agent plans. Refused with HOST_OFFLINE when After Effects is not connected (nothing is queued).",
  access: "write",
  input: {
    planId: PLAN_ID,
    acknowledgeUnverified: optionalArg(booleanArg({ description: "Required when the plan's verification report lists unverified, unverifiable, or regressed operations. Pass true only after telling the user which operations are unconfirmed on this build." })),
    waitSeconds: waitArg(20),
    verbose: VERBOSE,
  },
});

export const AE_CANCEL_PLAN = defineTool("ae_cancel_plan", {
  description: "Cancel a plan before it is applied.",
  access: "write",
  input: {
    planId: PLAN_ID,
  },
});

export const AE_GET_RECEIPT = defineTool("ae_get_receipt", {
  description: "Compact receipt for a plan.",
  input: {
    planId: PLAN_ID,
    verbose: VERBOSE,
  },
});

export const AE_UNDO_PLAN = defineTool("ae_undo_plan", {
  description: "Undo an applied agent plan. A long plan was applied as several undo groups; scope \"last\" takes back the newest group, \"all\" (default) every group it still has, \"job\" every batch of the job this plan belongs to, newest first. Refused if the project changed since; a partial undo cannot be checked against the pre-plan state, so it is reported as such, not as verified.",
  access: "write",
  input: {
    planId: PLAN_ID,
    scope: optionalArg(enumArg(["last", "all", "job"], { description: "\"last\" undoes one group, \"all\" undoes the rest of this plan, \"job\" undoes every applied batch of the job this plan belongs to." })),
    waitSeconds: waitArg(20),
  },
});

export const AE_UNDO_AGENT_WORK = defineTool("ae_undo_agent_work", {
  description: "Take back the work the agent applied most recently, without naming it. scope \"last\" undoes the newest After Effects undo group, scope \"all\" (the default) takes back every group that work still has, and scope \"job\" takes back every applied batch of the job it belongs to. Refused if the project changed since it was applied; a partial undo is reported as such rather than as verified.",
  access: "write",
  input: {
    scope: optionalArg(enumArg(["last", "all", "job"], { description: "\"last\" undoes one group, \"all\" undoes the rest of the newest applied work, \"job\" undoes every applied batch of the job that work belongs to." })),
    waitSeconds: waitArg(20),
  },
});

/** The tools that author, approve, apply and undo plans. */
export const PLAN_TOOLS = [
  AE_PREPARE_CHANGE,
  AE_PROPOSE_PLAN,
  AE_CREATE_VECTOR_ARTWORK,
  AE_QUEUE_ADD,
  AE_QUEUE_FIX,
  AE_QUEUE_FINISH,
  AE_WORKFLOW_COMPLETE,
  AE_PLAN_CREATE,
  AE_PLAN_ADD,
  AE_PLAN_COMPLETE,
  AE_AMEND_PLAN,
  AE_LIST_PLANS,
  AE_PRESENT_PLAN,
  AE_GET_PLAN_STATUS,
  AE_RECALL_PLAN,
  AE_APPROVE_PLAN,
  AE_CANCEL_PLAN,
  AE_GET_RECEIPT,
  AE_UNDO_PLAN,
  AE_UNDO_AGENT_WORK,
] satisfies ReadonlyArray<ToolEntry>;
