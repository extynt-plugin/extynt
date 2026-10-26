/**
 * After a designed batch settles clean, the sidecar queues and seals the next group of the drawing itself, so the owner is not woken once per group. At most
 * 12 groups are built without the model in one turn; a drawing needing more is handed back to it. The group is queued with finish:false because this module
 * seals it itself, once, rather than through ae_queue_design's own self-seal.
 */
import { WORKFLOW_DESIGN_TOOL } from "./agent.js";
import type { JsonObject } from "@extynt/decode";
import type { AgentCallState, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { remainingDesignLayers } from "./server-workflow-design-build.js";
import { ownerTurn } from "./server-workflow-finish-turn.js";
import { namesOf, objectOf, payload, textOf, type Run, type ToolResult } from "./server-workflow-operation-json.js";
import { recordSeedAction } from "./server-workflow-sidecar-actions.js";

type Deps = Pick<ChatAgentDeps, "state" | "planState">;
type SealCall = { name: string; input: ChatAgentInput; state: AgentCallState; result: ToolResult };

const MAX_SIDECAR_DESIGN_BUILDS = 12;

function receiptProves(verification: string, receipt: JsonObject | undefined): boolean {
  if (!receipt || receipt.repair !== undefined) return false;
  return verification === "verified" || (verification === "applied_unverified" && receipt.frame !== undefined);
}

function receiptOf(result: ToolResult): JsonObject | undefined {
  return objectOf(payload(result)?.receipt);
}

function settledClean(deps: Deps, input: ChatAgentInput & { workflowJobId: string }, result: ToolResult): boolean {
  const coordinator = deps.state.workflowCoordinator;
  const workflow = coordinator.workflowStore.getState();
  const job = workflow.jobs[coordinator.jobIdForSeed(input.workflowJobId)];
  const batch = job ? workflow.batches[job.batchIds.at(-1) ?? ""] : undefined;
  if (batch?.lifecycle !== "settled" || batch.execution.state !== "executed") return false;
  return receiptProves(batch.verification.state, receiptOf(result));
}

function builtLayers(queued: ToolResult): string[] {
  return namesOf(objectOf(payload(queued)?.design)?.built);
}

function withBuilt(result: ToolResult, layers: string[]): ToolResult {
  const data = payload(result);
  if (!result.ok || !data) return result;
  const all = [...layers, ...namesOf(objectOf(data.sidecarBuilt)?.layers)];
  return { ...result, data: { ...data, sidecarBuilt: { layers: all, note: `The sidecar built and sealed ${all.join(", ")} from the drawing itself after the previous batch settled. Do not queue them again.` } } };
}

function withStopped(result: ToolResult, error: { code: string; message: string }): ToolResult {
  return result.ok ? { ...result, data: { ...payload(result), sidecarBuilt: { stopped: error.code, note: `The sidecar tried to queue the rest of the drawing and stopped: ${error.message}` } } } : result;
}

function recordContinued(deps: Deps, input: ChatAgentInput, done: { layers: string[]; builds: number | undefined; sealed: ToolResult }): void {
  const receipt = receiptOf(done.sealed);
  const outcome = done.sealed.ok ? `, ${textOf(receipt?.verification) ?? "settled"}` : ", not sealed";
  recordSeedAction(deps.state, input.workflowJobId, `built and sealed the next design group (${done.layers.join(", ")}; sidecar build ${done.builds}, ${remainingDesignLayers(deps, input).length} layer(s) of the drawing left)${outcome}`, { visual: receipt?.frame !== undefined });
}

function shouldContinue(deps: Deps, call: SealCall): boolean {
  const { name, input, state, result } = call;
  if (name !== "ae_queue_finish" || !result.ok || !("continuesLoop" in result) || !ownerTurn(input)) return false;
  return (state.designAutoBuilds ?? 0) < MAX_SIDECAR_DESIGN_BUILDS && remainingDesignLayers(deps, input).length > 0 && settledClean(deps, input, result);
}

/** The settled result of the next group of the drawing, built and sealed by the sidecar; undefined when this seal is not one to continue after. */
export async function continueDesignBuild(deps: Deps, call: SealCall, run: Run): Promise<ToolResult | undefined> {
  const { state, result } = call;
  if (!shouldContinue(deps, call)) return undefined;
  state.designAutoBuilds = (state.designAutoBuilds ?? 0) + 1;
  const queued = await run(WORKFLOW_DESIGN_TOOL, { finish: false });
  if (!queued.ok) return withStopped(result, queued.error);
  const layers = builtLayers(queued);
  if (!layers.length) return undefined;
  const sealed = await run("ae_queue_finish", {});
  recordContinued(deps, call.input, { layers, builds: state.designAutoBuilds, sealed });
  return withBuilt(sealed, layers);
}
