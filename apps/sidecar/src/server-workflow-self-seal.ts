// A queue call that leaves nothing to fix seals itself: `finish` on ae_queue_add, the default on ae_queue_design, and released animation.
import { array, decode, isJsonObject, type JsonObject, jsonObject, jsonValue, object, type JsonValue } from "@extynt/decode";
import { planOperationCount, type callTool } from "@extynt/mcp-server";
import type { ToolArguments } from "./agent-types.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { releaseRefused, releasedIntoOpenQueue } from "./server-workflow-design-release.js";
import { recordSeedAction } from "./server-workflow-sidecar-actions.js";

type ToolResult = ReturnType<typeof callTool>;
type Run = (name: string, args: ToolArguments) => Promise<ToolResult>;

interface SealContext { readonly deps: ChatAgentDeps; readonly input: ChatAgentInput; readonly run: Run }
interface SealCall { readonly name: string; readonly args: ToolArguments }

const MAX_RELEASE_SEALS = 2;
const SEAL_ADVICE = "; seal with ae_queue_finish when the batch is whole.";

function dataOf(result: ToolResult): JsonObject | undefined {
  const decoded = result.ok ? decode(jsonObject, result.data) : undefined;
  return decoded?.ok ? decoded.value : undefined;
}

function wantsSeal(call: SealCall): boolean {
  if (call.name === "ae_queue_design") return call.args.finish !== false;
  return call.name === "ae_queue_add" && call.args.finish === true;
}

function withoutFinish(call: SealCall): ToolArguments {
  if (call.name !== "ae_queue_add" && call.name !== "ae_queue_design") return call.args;
  const { finish: _finish, ...rest } = call.args;
  return rest;
}

function nonEmptyList(value: JsonValue | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
}

function outstandingCheckpoint(data: JsonObject): JsonValue | undefined {
  const checkpoint = data.checkpoint;
  return isJsonObject(checkpoint) ? checkpoint.outstanding : undefined;
}

function cleanAnswer(result: ToolResult): boolean {
  const data = dataOf(result);
  return !!data && !releaseRefused(result) && !nonEmptyList(data.fix) && !nonEmptyList(outstandingCheckpoint(data));
}

function queuedOperations(deps: ChatAgentDeps): number {
  const open = deps.state.openQueuePlanId ? deps.state.plans.get(deps.state.openQueuePlanId) : undefined;
  return open ? planOperationCount(open) : 0;
}

function sealSummary(seal: ToolResult): JsonObject {
  const data = dataOf(seal);
  return data ?? (seal.ok ? {} : { refused: { code: seal.error.code, message: seal.error.message } });
}

function sealSummaryReleased(seal: ToolResult): JsonObject {
  const data = sealSummary(seal);
  const held = data.heldAnimation;
  if (typeof held !== "string") return data;
  const note = held.replace(SEAL_ADVICE, "; it was sealed in this same call (receipt under sealedAnimation).");
  const next = typeof data.next === "string" ? data.next.replace(held, "").trim() : "";
  return { ...data, heldAnimation: note, next: `${note} ${next}`.trim() };
}

async function sealReleased(context: SealContext, first: ToolResult): Promise<ToolResult[]> {
  const { deps, input, run } = context;
  const seals: ToolResult[] = [];
  let last = first;
  while (last.ok && seals.length < MAX_RELEASE_SEALS && releasedIntoOpenQueue(deps, input) && queuedOperations(deps) > 0) {
    const ops = queuedOperations(deps);
    last = await run("ae_queue_finish", {});
    seals.push(last);
    recordSeedAction(deps.state, input.workflowJobId, `sealed the ${ops} held animation operations it queued for you${last.ok ? "" : " (not sealed)"}`);
  }
  return seals;
}

const heldSeals = object({ embeddedSeals: array(jsonValue) });

function withEmbedded(result: ToolResult, seals: ToolResult[]): ToolResult {
  if (!seals.length) return result;
  const held = decode(heldSeals, result);
  const existing = held.ok ? held.value.embeddedSeals : [];
  return Object.assign(result, { embeddedSeals: [...existing, ...seals] });
}

function withSeals(result: ToolResult, data: JsonObject, seals: ToolResult[]): ToolResult {
  return result.ok ? withEmbedded({ ...result, data }, seals) : result;
}

function sealNextText(seal: ToolResult): string {
  if (!seal.ok) return `The queue is not sealed: ${seal.error.message}`;
  const sealNext = dataOf(seal)?.next;
  return typeof sealNext === "string" ? sealNext : "Sealed.";
}

function merged(result: ToolResult, seal: ToolResult, released: ToolResult[]): ToolResult {
  if (!seal.ok && seal.error.code === "EVENT_LOG_FULL") return seal;
  const data = dataOf(result) ?? {};
  const releasedSeals: JsonObject = released.length ? { sealedAnimation: released.map(sealSummary) } : {};
  const sealed = released.length ? sealSummaryReleased(seal) : sealSummary(seal);
  const next = released.length && typeof sealed.next === "string" ? sealed.next : sealNextText(seal);
  return withSeals(result, { ...data, sealed, ...releasedSeals, next }, [seal, ...released]);
}

function recordDesignSeal(context: SealContext, ops: number, seal: ToolResult): void {
  const { deps, input } = context;
  recordSeedAction(deps.state, input.workflowJobId, seal.ok ? `sealed the ${ops} operations of your ae_queue_design call (it seals by default)` : `tried to seal your ae_queue_design batch and it was not sealed: ${seal.error.message.slice(0, 120)}`);
}

async function sealWhenClean(context: SealContext, call: SealCall, result: ToolResult): Promise<ToolResult> {
  if (!wantsSeal(call) || !cleanAnswer(result) || queuedOperations(context.deps) < 1) return result;
  const ops = queuedOperations(context.deps);
  const seal = await context.run("ae_queue_finish", {});
  if (call.name === "ae_queue_design") recordDesignSeal(context, ops, seal);
  return merged(result, seal, await sealReleased(context, seal));
}

async function sealReleasedAnimation(context: SealContext, result: ToolResult): Promise<ToolResult> {
  const released = await sealReleased(context, result);
  if (!released.length) return result;
  return withSeals(result, { ...sealSummaryReleased(result), sealedAnimation: released.map(sealSummary) }, released);
}

/** Runs one workflow tool call and then its self-seal. A clean ae_queue_add (finish:true) or ae_queue_design is sealed and the receipt merged into the same answer, while an answer with anything to fix is left unsealed. Animation released by a model-called ae_queue_finish is sealed in the same call, at most twice, each seal measuring its own frame. The loop reads the seals it ran from `embeddedSeals`; `finish` is the sidecar's, not the queue schema's, so it never reaches the queue. */
export async function withSelfSeal(deps: ChatAgentDeps, input: ChatAgentInput, call: SealCall, run: Run): Promise<ToolResult> {
  const result = await run(call.name, withoutFinish(call));
  const context = { deps, input, run };
  return call.name === "ae_queue_finish" ? sealReleasedAnimation(context, result) : sealWhenClean(context, call, result);
}
