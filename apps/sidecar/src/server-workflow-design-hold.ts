/**
 * Design first, animate later, without a round trip. In a designed job the static scene is built, applied and checked against the design on a captured frame
 * before any motion is added, so a wrong layout is caught while it is still cheap to fix and keyframes are never authored against layers that turn out to be
 * misplaced. The motion only has to arrive after the frame check, so a call that both creates layers and animates them is split here instead of refused: the
 * design part is staged now, and the animation of the layers it (or an earlier call this cycle) creates is held by the sidecar per job and queued automatically,
 * placeholders rebound to the created ids, once the design batch has applied, verified, and a frame was checked (see server-workflow-design-release.ts).
 * Admitting both in one batch would skip that check, so it is held. The whole call is checked first, design and held animation together, so a held operation the
 * queue would refuse is refused in the answer at its position in the model's call, never later at release. A fix whose other edits address the very insert being
 * held has no clean split and is refused whole.
 */
import { callTool, declaredNames } from "@extynt/mcp-server";
import type { WorkflowId } from "@extynt/workflow";
import type { ToolArguments } from "./agent-types.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { AgentCallState, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { authoringOperations, createdLayerIds, jobHasDesign, operationAnimates } from "./server-workflow-design.js";
import { argumentJson, listOf, objectOf, payloadOrWrapped, queueStaged, stringsIn, targetLayerId, textOf, type ToolResult } from "./server-workflow-operation-json.js";

/** Animation the sidecar carries past the design batch: the operations in the model's own vocabulary and the plan their names were declared in. */
export interface HeldAnimation { readonly planId: string | undefined; readonly operations: readonly JsonObject[]; readonly layers: readonly string[] }

/** The open plan a job's held animation was queued into, with what went in. */
export interface HeldReleasedInto { readonly planId: string; readonly count: number; readonly layers: readonly string[] }

/** One call split into what is staged now and what is held for after the frame check; positions are 0-based in the model's call. */
export interface DesignSplit { readonly held: readonly JsonObject[]; readonly heldPositions: readonly number[]; readonly designPositions: readonly number[]; readonly layers: readonly string[] }

/** One workflow tool call as the design-first rule sees it. */
export interface DesignFirstCall { readonly name: string; readonly args: ToolArguments; readonly input: ChatAgentInput; readonly state: AgentCallState }

type Slot = JsonObject | undefined;
type Edit = JsonObject;

const DROPPED_FROM_CHECKED_ANSWER: readonly string[] = ["accepted", "queued", "resend", "next"];

function declarations(slots: readonly Slot[], held: ReadonlySet<number>): Set<string> {
  return new Set([...held].flatMap((position) => {
    const operation = slots[position];
    return operation ? declaredNames(operation) : [];
  }));
}

function followers(slots: readonly Slot[], held: ReadonlySet<number>, declared: ReadonlySet<string>): number[] {
  return slots.flatMap((operation, position) => (operation && !held.has(position) && stringsIn(operation).some((text) => declared.has(text)) ? [position] : []));
}

function heldPositionsOf(slots: readonly Slot[], created: ReadonlySet<string>): Set<number> {
  const held = new Set<number>();
  slots.forEach((operation, position) => {
    if (operation && operationAnimates(operation) && created.has(targetLayerId(operation) ?? "")) held.add(position);
  });
  for (let grown = held.size > 0; grown;) {
    const declared = declarations(slots, held);
    const added = declared.size ? followers(slots, held, declared) : [];
    for (const position of added) held.add(position);
    grown = added.length > 0;
  }
  return held;
}

function splitOf(slots: readonly Slot[], held: ReadonlySet<number>): DesignSplit | undefined {
  if (!held.size) return undefined;
  const heldPositions = [...held].sort((a, b) => a - b);
  const heldOperations = heldPositions.flatMap((position): JsonObject[] => {
    const operation = slots[position];
    return operation ? [operation] : [];
  });
  const layers = [...new Set(heldOperations.flatMap((operation): string[] => {
    const layer = targetLayerId(operation);
    return layer === undefined ? [] : [layer];
  }))];
  return { held: heldOperations, heldPositions, designPositions: slots.flatMap((_, position) => (held.has(position) ? [] : [position])), layers };
}

function splitAdd(args: ToolArguments, created: ReadonlySet<string>): DesignSplit | undefined {
  const entries = listOf(argumentJson(args, "operations"));
  const split = splitOf(entries.map(objectOf), heldPositionsOf(entries.map(objectOf), created));
  if (split) args.operations = split.designPositions.map((position) => entries[position] ?? null);
  return split;
}

function indexOf(edit: Edit): number {
  const index = edit.index;
  return typeof index === "number" ? index : 0;
}

function shifted(dropped: number[], from: number, by: number): number[] {
  return dropped.map((position) => (position >= from ? position + by : position));
}

function readdressed(edit: Edit, dropped: number[]): { edit: Edit; dropped: number[] } | undefined {
  const index = indexOf(edit);
  if (edit.op !== "insert" && dropped.includes(index)) return undefined;
  const moved = { ...edit, index: index - dropped.filter((position) => position < index).length };
  if (edit.op === "insert") return { edit: moved, dropped: shifted(dropped, index, 1) };
  if (edit.op === "remove") return { edit: moved, dropped: dropped.map((position) => (position > index ? position - 1 : position)) };
  return { edit: moved, dropped };
}

function keptEdits(edits: readonly JsonValue[], held: ReadonlySet<number>): Edit[] | undefined {
  let dropped: number[] = [];
  const kept: Edit[] = [];
  for (const [position, entry] of edits.entries()) {
    const edit: Edit = objectOf(entry) ?? {};
    if (held.has(position)) {
      if (edit.op === "insert") dropped = [...shifted(dropped, indexOf(edit), 1), indexOf(edit)];
      continue;
    }
    const next = readdressed(edit, dropped);
    if (!next) return undefined;
    kept.push(next.edit);
    dropped = next.dropped;
  }
  return kept;
}

function splitFix(args: ToolArguments, created: ReadonlySet<string>): DesignSplit | "conflict" | undefined {
  const edits = listOf(argumentJson(args, "edits"));
  const slots = edits.map((entry): Slot => {
    const edit = objectOf(entry);
    return edit && edit.op !== "remove" ? objectOf(edit.operation) : undefined;
  });
  const split = splitOf(slots, heldPositionsOf(slots, created));
  if (!split) return undefined;
  const kept = keptEdits(edits, new Set(split.heldPositions));
  if (!kept) return "conflict";
  args.edits = kept;
  return split;
}

function conflictRefusal(): ToolResult {
  return { ok: false, error: { code: "WORKFLOW_DESIGN_FIRST", message: "Design first, animate later: these edits animate a layer this stage creates and also edit that same inserted operation, so they cannot be split and nothing was changed. Send the static edits with ae_queue_fix and the animation as its own ae_queue_add; the sidecar holds animation of new layers until the design batch is checked." } };
}

/**
 * Rule 2. In a designed job, splits the animation of layers this call or an earlier call this cycle creates out of an ae_queue_add or ae_queue_fix call,
 * rewriting its arguments in place to the design part. A job with no scene design may create and animate a layer in one batch.
 */
export function splitDesignFirst(deps: ChatAgentDeps, call: DesignFirstCall): DesignSplit | ToolResult | undefined {
  const { name, args, input, state } = call;
  if (name !== "ae_queue_add" && name !== "ae_queue_fix") return undefined;
  if (!jobHasDesign(deps, input)) return undefined;
  const created = new Set([...(state.createdLayers ?? []), ...createdLayerIds(authoringOperations(name, args))]);
  if (!created.size) return undefined;
  const split = name === "ae_queue_add" ? splitAdd(args, created) : splitFix(args, created);
  return split === "conflict" ? conflictRefusal() : split;
}

/** True when the split left nothing to send to the queue. */
export function nothingStaged(name: string, args: ToolArguments): boolean {
  return listOf(argumentJson(args, name === "ae_queue_add" ? "operations" : "edits")).length === 0;
}

function runs(positions: readonly number[]): string {
  return positions.join(", ");
}

function heldMessage(split: DesignSplit, staged: number): string {
  const what = staged ? `staged the ${staged} design operation(s) now; your` : "nothing else was in this call, so nothing new was staged; your";
  return `Design first: ${what} ${split.held.length} animation operation(s) (position(s) ${runs(split.heldPositions)} of this call, on ${split.layers.join(", ") || "the new layers"}) are held by the sidecar and will be queued automatically after the design batch has applied and verified and a captured frame was checked — do not resend them.`;
}

function positionNote(split: DesignSplit): string | undefined {
  const reordered = split.designPositions.some((position, index) => position !== index);
  return reordered ? `Positions in this answer count only the staged operations: answer position i is your position designPositions[i] = [${split.designPositions.join(", ")}].` : undefined;
}

function refusedSplit(result: ToolResult, split: DesignSplit): ToolResult {
  const note = positionNote(split);
  const aside = `The sidecar set the ${split.held.length} animation operation(s) at position(s) ${runs(split.heldPositions)} aside for after the design; nothing was held because nothing was staged. Send the whole call again with the fix — the animation is set aside again automatically.${note ? ` ${note}` : ""}`;
  if (result.ok) return { ...result, data: { ...payloadOrWrapped(result), designFirst: { held: 0, note: aside, designPositions: split.designPositions } } };
  return { ...result, error: { ...result.error, message: `${result.error.message} ${aside}` } };
}

/** Holds the split's animation for the job and tells the model; a refused design part holds nothing, because nothing was staged. */
export function settleSplit(deps: ChatAgentDeps, jobId: WorkflowId, split: DesignSplit, result: ToolResult): ToolResult {
  if (!result.ok || !queueStaged(result)) return refusedSplit(result, split);
  const holds = deps.state.workflowHeldAnimation.get(jobId) ?? [];
  deps.state.workflowHeldAnimation.set(jobId, [...holds, { planId: deps.state.openQueuePlanId ?? undefined, operations: split.held, layers: split.layers }]);
  const note = positionNote(split);
  const data = payloadOrWrapped(result);
  const next = `${heldMessage(split, split.designPositions.length)} ${textOf(data.next) ?? ""}`.trim();
  return { ...result, data: { ...data, designFirst: { held: split.held.length, heldPositions: split.heldPositions, layers: split.layers, ...(note ? { designPositions: split.designPositions, positions: note } : {}) }, next } };
}

/** The answer when every operation of the call was held: nothing reaches the queue, and the hold is recorded. */
export function heldOnly(deps: ChatAgentDeps, jobId: WorkflowId, split: DesignSplit, answer: { name: string; queued: number }): ToolResult {
  const base: ToolResult = { ok: true, tool: answer.name, snapshotFingerprint: deps.planState.normalizedLatest()?.fingerprint ?? null, data: { queued: answer.queued } };
  return settleSplit(deps, jobId, split, base);
}

function checkedWholeCall(deps: ChatAgentDeps, name: string, original: ToolArguments): ToolResult {
  const context = deps.planView.toolContext(deps.planState.normalizedLatest());
  const plans = new Map([...(context.plans ?? [])].map(([id, record]) => [id, structuredClone(record)]));
  let planId = context.queue?.planId ?? null;
  const queue = { get planId() { return planId; }, set: (next: string | null) => { planId = next; } };
  return callTool(name, structuredClone(original), { ...context, plans, queue });
}

function refusesAny(result: Extract<ToolResult, { ok: true }>): boolean {
  return listOf(payloadOrWrapped(result).fix).length > 0;
}

/**
 * The refusal of the whole call when the queue's own composer and validator, run on a copy of the plans so nothing is staged by the check, refuses any of it
 * (a partially accepting queue would otherwise hold a refused animation operation); undefined when the split may go ahead.
 */
export function wholeCallRefusal(deps: ChatAgentDeps, call: { name: string; original: ToolArguments; split: DesignSplit }): ToolResult | undefined {
  const { name, original, split } = call;
  const checked = checkedWholeCall(deps, name, original);
  if (checked.ok && !refusesAny(checked)) return undefined;
  const aside = `Design first: nothing from this call was staged or held. The sidecar holds the animation at position(s) ${runs(split.heldPositions)} until the design is built and checked, but it checks the whole call first, so every position named here is your own position in this call. Correct them and send the whole call again; the animation is held again automatically.`;
  if (!checked.ok) return { ...checked, error: { ...checked.error, message: `${checked.error.message} ${aside}` } };
  const data = Object.fromEntries(Object.entries(payloadOrWrapped(checked)).filter(([key]) => !DROPPED_FROM_CHECKED_ANSWER.includes(key)));
  return { ...checked, data: { ...data, accepted: 0, designFirst: { held: 0, heldPositions: split.heldPositions, designPositions: split.designPositions }, next: aside } };
}
