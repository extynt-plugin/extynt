/**
 * Where the design-first split and the release of held animation sit around one workflow tool call: rule 2 applied as a split (never a refusal), and held
 * animation released at the moments it can go: before a queue call (ae_queue_design keeps its whole room for the drawing), after a frame observation (the
 * moment the frame check is met), at the start of a cycle, and instead of completing a job that still holds some.
 */
import type { ToolArguments } from "./agent-types.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { argumentJson, listOf, type Run, type ToolResult } from "./server-workflow-operation-json.js";
import { heldOnly, nothingStaged, settleSplit, splitDesignFirst, wholeCallRefusal, type DesignFirstCall, type DesignSplit } from "./server-workflow-design-hold.js";
import { queuedOperationCount } from "./server-workflow-design-receipts.js";
import { heldCompletionRefusal, liftedFrameRelease, releaseHeldAnimation, withReleaseNote, type HeldRelease } from "./server-workflow-design-release.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";

const RELEASE_BEFORE = new Set(["ae_queue_add", "ae_queue_fix", "ae_queue_finish"]);

function reserved(name: string, args: ToolArguments): number {
  const key = name === "ae_queue_add" ? "operations" : name === "ae_queue_fix" ? "edits" : undefined;
  return key ? listOf(argumentJson(args, key)).length : 0;
}

async function releaseBefore(deps: ChatAgentDeps, call: DesignFirstCall, run: Run): Promise<HeldRelease | undefined> {
  return RELEASE_BEFORE.has(call.name) ? releaseHeldAnimation(deps, call.input, run, reserved(call.name, call.args)) : undefined;
}

function checkedSplit(deps: ChatAgentDeps, call: DesignFirstCall): DesignSplit | ToolResult | undefined {
  const original = structuredClone(call.args);
  const split = splitDesignFirst(deps, call);
  if (!split || "ok" in split) return split;
  return wholeCallRefusal(deps, { name: call.name, original, split }) ?? split;
}

async function releaseAfterObservation(deps: ChatAgentDeps, call: DesignFirstCall, result: ToolResult, run: Run): Promise<HeldRelease | undefined> {
  return call.name === "ae_observe_frame" && result.ok ? releaseHeldAnimation(deps, call.input, run) : undefined;
}

async function splitResult(deps: ChatAgentDeps, call: DesignFirstCall, split: DesignSplit, proceed: () => Promise<ToolResult>): Promise<ToolResult> {
  const jobId = deps.state.workflowCoordinator.jobIdForSeed(call.input.workflowJobId ?? "");
  return nothingStaged(call.name, call.args) ? heldOnly(deps, jobId, split, { name: call.name, queued: queuedOperationCount(deps) }) : settleSplit(deps, jobId, split, await proceed());
}

async function answerCall(deps: ChatAgentDeps, call: DesignFirstCall, work: { split: DesignSplit | undefined; proceed: () => Promise<ToolResult> }): Promise<ToolResult> {
  const result = work.split ? await splitResult(deps, call, work.split, work.proceed) : await work.proceed();
  return call.name === "ae_queue_finish" ? liftedFrameRelease(result) : result;
}

/**
 * Runs one workflow tool call with rule 2 applied as a split and held animation released around it. The call's design-first split rewrites its arguments to
 * the design part once the whole call passed the queue's check, or answers the refusal; a split call answers the held-only result when nothing is left to
 * stage, otherwise the staged result with the hold recorded.
 */
export async function runWithDesignFirst(deps: ChatAgentDeps, call: DesignFirstCall, run: Run, proceed: () => Promise<ToolResult>): Promise<ToolResult> {
  const { name, input } = call;
  if (!input.workflowJobId || input.workflowRole !== WORKFLOW_OWNER) return proceed();
  if (name === "ae_workflow_complete") return (await heldCompletionRefusal(deps, input, run)) ?? proceed();
  const split = checkedSplit(deps, call);
  if (split && "ok" in split) return split;
  const release = await releaseBefore(deps, call, run);
  const answered = await answerCall(deps, call, { split, proceed });
  return withReleaseNote(answered, (await releaseAfterObservation(deps, call, answered, run)) ?? release);
}

/** At the start of a cycle, held animation that became ready while the model was away is queued before its first step. */
export async function releaseAtCycleStart(deps: ChatAgentDeps, input: ChatAgentInput, run: Run): Promise<void> {
  if (input.workflowJobId && input.workflowRole === WORKFLOW_OWNER && !input.discoveryOnly) await releaseHeldAnimation(deps, input, run);
}
