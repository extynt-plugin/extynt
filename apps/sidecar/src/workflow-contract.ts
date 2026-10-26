// The cycle contract, orchestration and continuation sections a workflow turn adds to the chat agent's briefing.

import { PLAN_UNDO_BATCH_SIZE } from "@extynt/mcp-server";
import { WORKFLOW_SPECIALIST_TOOL } from "./agent.js";
import type { ChatAgentInput } from "./server-chat-agent-types.js";
import { orchestrationBriefing } from "./workflow-orchestration.js";
import type { WorkflowContinuationBatchEvidence, WorkflowContinuationInput, WorkflowContinuationOperationEvidence, WorkflowContinuationReceiptEvidence } from "@extynt/workflow";

type ModelOutcome = WorkflowContinuationOperationEvidence | Pick<WorkflowContinuationOperationEvidence, "ordinal" | "type"> & { readonly layerId?: string };
type ModelReceipt = Omit<WorkflowContinuationReceiptEvidence, "outcomes"> & { readonly outcomes: readonly ModelOutcome[] };
type ModelBatch = Omit<WorkflowContinuationBatchEvidence, "receipt"> & { readonly receipt: ModelReceipt | null };

type ModelContinuation = Omit<WorkflowContinuationInput, "capabilities" | "settledBatches" | "activeBatch"> & { readonly activeBatch: ModelBatch | null; readonly settledBatches: readonly ModelBatch[] };

function designLaunch(checklist: boolean): string {
  return checklist ? "action launch, once per checklist item, with that item's composition id as compositionId and that item's spec as the instruction, which states the composition's name, size, duration and frame rate; a look the brief describes for several parts (a world, palette or style) is a reference for colour and style that each item's design follows, not a composition to build once and nest" : "action launch, once for the whole scene, in a composition that already exists; the instruction states the composition's name, size, duration, frame rate and passes the user's request whole, every layer and beat it names, not just the first layer";
}

function buildAllRule(checklist: boolean): string {
  return checklist ? "Build every checklist item, one after another; the receipts and the sidecar say what is next." : "Before completing, go through every item the user asked for: queue what is still missing. When the verified receipts cover the request, call ae_workflow_complete: the sidecar cites its own receipts and takes any frame it needs. Name anything you could not build and why in the completion answer. Prose alone never completes the job.";
}

function checklistRule(checklist: boolean, planned: boolean): string {
  if (!checklist) return "";
  return `
${planned ? `8. Planning is long; operations are small. The sidecar's planner already wrote the whole request as a checklist: one item per section, shot or deliverable, each with its spec (the exact slice of the request it must satisfy). Each cycle's message and each seal reply carry the next open items with their specs, so you need not reread the whole request. Do not call ae_workflow_checklist to restate the list; call it only to add an item the planner missed. Set stage to the item's id on every ae_queue_add and ae_queue_design that builds it; an item is done when one of its batches applied and verified. Review items belong to the sidecar's reviewer: it looks at frames of finished sections and sends back what to fix. Never build, queue for or close a review item. Keep each item's operations tight: batch them, trust the receipt, do not re-read or capture to confirm. Cost is saved in how an item is built, never in how much is built. An item you tried and could not build is closed with ae_workflow_unbuilt items:[{id, reason}]. When an item needs After Effects expressions, ask the expression specialist (${WORKFLOW_SPECIALIST_TOOL} action launch, role expression): it writes them against the comp's real layers and markers.` : `8. Planning is long; operations are small. Before your first queue call, call ae_workflow_checklist once with the whole request: one item per section, shot or deliverable the request names, however many that is (a 30-second film can be 60 items), each with a spec: the request's own words for it, copied exactly, so that the specs together cover every sentence of the request. Set stage to the item's id on every ae_queue_add and ae_queue_design that builds it; an item is done when one of its batches applied and verified. Keep each item's operations tight: batch them, trust the receipt, do not re-read or capture to confirm. Cost is saved in how an item is built, never in how much is built. An item you tried and could not build is closed with ae_workflow_unbuilt items:[{id, reason}].`}`;
}

function stageHint(checklist: boolean): string {
  return checklist ? 'set "stage" to the checklist item\'s id' : 'an optional short "stage" string names the step';
}

function endRule(checklist: boolean): string {
  return checklist ? "Prose never ends the job." : "Only ae_workflow_complete ends the job.";
}

function captureTail(checklist: boolean): string {
  return checklist ? "." : ", and ae_workflow_complete takes the frames it needs on its own, so never capture just to complete.";
}

/** Workflow cycle contract for the bounded batch. */
export function workflowCycleContract(input: Pick<ChatAgentInput, "workflowJobId" | "workflowObservationOnly" | "workflowCycle" | "workflowChecklist" | "workflowPlanned">): string | undefined {
  if (!input.workflowJobId) return undefined;
  if (input.workflowObservationOnly) return `WORKFLOW OBSERVATION CONTRACT (sidecar-owned): this cycle is read-only because the host executed the prior batch but structural readback was incomplete. Do not select a stage, author, seal, approve, undo, or replay any mutation. Capture the current composition at a representative time and call ae_observe_frame. A still frame may support visual evidence only; it never proves temporal smoothness. For a temporal criterion, capture and observe the same composition at at least two different times; the sidecar will emit temporal evidence only when the measured frame summaries materially differ. Stop after recording bounded observation evidence so the sidecar can open a fresh authoring cycle.`;
  const checklist = !!input.workflowChecklist;
  return `WORKFLOW CYCLE CONTRACT (sidecar-owned; this overrides general queue-size advice):
${JSON.stringify({ phase: "one-loop", cycle: input.workflowCycle ?? 0, maxOperationsPerBatch: PLAN_UNDO_BATCH_SIZE })}
You own the outcome and remain the only execution authority. Specialist advice is read-only and never evidence that work ran.
1. Ask first. Before anything else, compare the request with the open composition and the project (rule 10). When they conflict, or the request can be read two materially different ways, call ae_ask_user with one short question offering concrete choices; it ends this turn and the reply continues this job. In a continuation cycle never stop to ask.
2. One loop. Queue with ae_queue_add (${stageHint(checklist)}), then ae_queue_finish. When the batch applies, ae_queue_finish returns its receipt in the same turn: per-operation outcome, read-back verdict, verification state, and the ids of created comps and layers. Continue from it in the same conversation: queue the next batch using those ids, and keep going batch after batch until every part of the request is built. ${endRule(checklist)}
3. Proportional checking. The receipt's read-back proves structural changes (names, markers, parenting, timing, expressions, and solids, nulls, text or comps with literal values): do not capture for them. Capture a frame with ae_capture_composition_frame and check it with ae_observe_frame only when you want to judge the picture for yourself: the seal of a batch that drew artwork already carries a frame the sidecar measured${captureTail(checklist)} Never capture before you build to see the starting state: the context, ae_inspect_layer and ae_measure_layer already give it. A temporal check applies only to a designed motion. Reads take ids from a read or a receipt (its created map), never a __new__ placeholder.
4. Design only artwork. Queueing shape layers or vector artwork needs a scene design first: launch the visual-scene designer with ${WORKFLOW_SPECIALIST_TOOL} (${designLaunch(checklist)}). The designer draws the scene and builds it itself, looks at one frame and fixes its own layers once; its report, which wakes you, names the layers built and their ids: do not queue them again, animate them by name. Add motion only for motion beyond a single move, fade or wiggle. The sidecar refuses shape layers without a design. Plain layers (solid, text, null, footage, camera, light), edits to existing layers and simple moves or fades need no specialist.
5. With a design: the designer's build created the static scene, the sidecar measured a frame of the built scene, and the designer's report says what it looked at and changed; animate those layers by name in a batch of this same loop. Animation you queue for layers a build creates is held by the sidecar until the scene's frame check is done, then queued for you — never resend it (no capture of your own is needed for that). If the user asked to see the plan first, send the design with ae_ask_user and launch the designer only after they approve.
6. Every ae_queue_add call is atomic: a refusal leaves it entirely unqueued, so correct it and resend the whole call. A read-back mismatch is repaired with ae_queue_fix.
7. Build the whole request. ${buildAllRule(checklist)} A question needs no queue: inspect and answer.${checklistRule(checklist, !!input.workflowPlanned)}`;
}

function workflowBriefingParts(input: ChatAgentInput): string[] {
  const contract = workflowCycleContract(input);
  const orchestration = input.workflowOrchestration ? orchestrationBriefing(input.workflowOrchestration) : undefined;
  const continuation = input.workflowContinuation ? `WORKFLOW CONTINUATION INPUT (sidecar-owned structured evidence; do not infer beyond these fields):\n${JSON.stringify(modelContinuation(input.workflowContinuation))}` : undefined;
  return [contract, orchestration, continuation].filter((value): value is string => !!value);
}

/** The base briefing followed by the workflow sections this turn carries. */
export function workflowBriefing(base: string, input: ChatAgentInput): string {
  return [base, ...workflowBriefingParts(input)].filter(Boolean).join("\n\n");
}

/** The base prompt segments followed by one uncached segment per workflow section this turn carries. */
export function workflowSegments(base: Array<{ text: string; cache?: boolean }>, input: ChatAgentInput): Array<{ text: string; cache?: boolean }> {
  return [...base, ...workflowBriefingParts(input).map((text) => ({ text }))];
}

function cleanOutcome(outcome: WorkflowContinuationOperationEvidence): boolean {
  return (outcome.outcome === "confirmed" || outcome.outcome === "host_confirmed") && outcome.verification === "verified";
}

function compactOutcome(outcome: WorkflowContinuationOperationEvidence): ModelOutcome {
  if (!cleanOutcome(outcome)) return outcome;
  return { ordinal: outcome.ordinal, type: outcome.type, ...(outcome.readback?.targetLayerId ? { layerId: outcome.readback.targetLayerId } : {}) };
}

function compactBatch(batch: WorkflowContinuationBatchEvidence): ModelBatch {
  if (!batch.receipt) return batch;
  const { outcomes, ...receipt } = batch.receipt;
  return { ...batch, receipt: { ...receipt, outcomes: outcomes.map(compactOutcome) } };
}

/**
 * The continuation as the model reads it, re-sent on every step of the cycle. The capability index is left out: the
 * tool schemas and ae_describe_native_operation already carry it and the first cycle works without it. A clean
 * outcome keeps its place, kind and layer; anything that did not verify cleanly keeps every field.
 */
export function modelContinuation(continuation: WorkflowContinuationInput): ModelContinuation {
  const { capabilities: _capabilities, settledBatches, activeBatch, ...rest } = continuation;
  return { ...rest, activeBatch: activeBatch ? compactBatch(activeBatch) : null, settledBatches: settledBatches.map(compactBatch) };
}
