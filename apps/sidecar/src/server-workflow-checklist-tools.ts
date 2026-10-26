// The checklist as the model's tools and the chat turn's hooks: the checklist and unbuilt tools, the first-queue nudge, the status on seal replies, and the withheld-completion text filter.
import { jsonOf } from "@extynt/mcp-server";
import { array, decode, isJsonArray, fallback, type JsonObject, jsonValue, type JsonValue, object, optional } from "@extynt/decode";
import type { WorkflowId } from "@extynt/workflow";
import { WORKFLOW_CHECKLIST_TOOL, WORKFLOW_UNBUILT_TOOL, type ToolArguments, type ToolResult as AgentToolResult } from "./agent-types.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { checklistProgress, checklistReply, setChecklist } from "./server-workflow-checklist.js";
import { checklistGate, closeUnbuilt, completionWithheld, completionWithheldMessage, unbuiltAnswer } from "./server-workflow-checklist-completion.js";
import { CHECKLIST_NUDGE } from "./server-workflow-checklist-model.js";
import { takeUnlabelledSealHint } from "./server-workflow-checklist-stage.js";
import { payload, type ToolResult } from "./server-workflow-operation-json.js";
import { checklistOf, jobScale, ledgerOf } from "./server-workflow-sidecar-actions.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";

type JobInput = Pick<ChatAgentInput, "workflowJobId" | "workflowRole" | "discoveryOnly">;

const MUTATING_QUEUE_TOOLS = new Set(["ae_queue_add", "ae_queue_design", "ae_queue_fix"]);

const UNAVAILABLE: ToolResult = { ok: false, error: { code: "CHECKLIST_UNAVAILABLE", message: "The checklist is available to the owner of a workflow job only." } };

const COMPLETION_CLAUSES = [/\s*\((?:and )?call ae_workflow_complete[^)]*\)|,? (?:or|and) call ae_workflow_complete[^.;]*/g, /(?<=(?:^|[.;\n])\s*)(?=\S)[^.;\n]*\bae_workflow_complete\b[^.;\n]*[.;]\s*/g];

const embeddedSeals = object({ embeddedSeals: optional(fallback(array(fallback(jsonValue, undefined)), undefined)) });

/** The checklist applies to the free-run owner of a workflow job (ADR 0044 rule 8). Returns the job id, else undefined. */
export function checklistJob(deps: Pick<ChatAgentDeps, "state">, input: JobInput): WorkflowId | undefined {
  if (deps.state.options.workflowFreeRun !== true || !input.workflowJobId || input.workflowRole !== WORKFLOW_OWNER || input.discoveryOnly) return undefined;
  return deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId);
}

/**
 * The first mutating queue call of a job with no checklist is refused once. It runs before anything is queued, staged or sealed, so it is
 * not an admission refusal and counts toward no budget; it is a different answer from any repeat, so it never trips the identical-refusal stop.
 */
export function checklistNudge(deps: ChatAgentDeps, input: ChatAgentInput, name: string): ToolResult | undefined {
  if (!MUTATING_QUEUE_TOOLS.has(name)) return undefined;
  const jobId = checklistJob(deps, input);
  if (!jobId || checklistOf(deps.state, jobId) || jobScale(deps.state, jobId) === "small") return undefined;
  const ledger = ledgerOf(deps.state, jobId);
  if (ledger.checklistNudged) return undefined;
  ledger.checklistNudged = true;
  return { ok: false, error: { code: "CHECKLIST_REQUIRED", message: CHECKLIST_NUDGE } };
}

/** ae_workflow_checklist: sets or extends the job's list and answers with every item's status. */
export function checklistTool(deps: ChatAgentDeps, input: ChatAgentInput, args: ToolArguments): ToolResult {
  const jobId = checklistJob(deps, input);
  if (!jobId) return UNAVAILABLE;
  const set = setChecklist(deps.state, jobId, { raw: args.items, ...(input.workflowCycle ? {} : { brief: input.message }) });
  if (!set.ok) return { ok: false, error: { code: "INVALID_CHECKLIST", message: set.message } };
  const data = checklistReply(deps.state.workflowCoordinator.workflowStore.getState(), set);
  return { ok: true, tool: WORKFLOW_CHECKLIST_TOOL, snapshotFingerprint: deps.planState.normalizedLatest()?.fingerprint ?? null, data };
}

/** The completion check before the coverage gate: a refusal, or the items closed as unbuilt (their report for an accepted answer). */
export function completionChecklist(deps: ChatAgentDeps, jobId: WorkflowId, args: ToolArguments): { refusal: { code: string; message: string } } | { unbuilt: string } | undefined {
  if (deps.state.options.workflowFreeRun !== true) return undefined;
  const gate = checklistGate(deps.state, jobId, deps.state.workflowCoordinator.workflowStore.getState(), args.unbuilt);
  if (gate.code) return { refusal: { code: gate.code, message: gate.message } };
  return { unbuilt: unbuiltAnswer(gate.unbuilt) };
}

function sealedBy(name: string, data: JsonObject, result: ToolResult): boolean {
  const seals = decode(embeddedSeals, result);
  return name === "ae_queue_finish" || data.receipt !== undefined || (seals.ok && (seals.value.embeddedSeals?.length ?? 0) > 0);
}

function sealedData(name: string, result: ToolResult): JsonObject | undefined {
  const data = payload(result);
  return data && sealedBy(name, data, result) ? data : undefined;
}

/** A seal reply carries the checklist's one-line status. */
export function withChecklistStatus(deps: ChatAgentDeps, input: ChatAgentInput, name: string, result: ToolResult): ToolResult {
  const jobId = checklistJob(deps, input);
  const data = jobId ? sealedData(name, result) : undefined;
  if (!jobId || !result.ok || !data) return result;
  const line = checklistProgress(deps.state, jobId, deps.state.workflowCoordinator.workflowStore.getState());
  const hint = takeUnlabelledSealHint(deps.state, jobId);
  return line ? { ...result, data: { ...data, checklist: line, ...(hint ? { checklistHint: hint } : {}) } } : result;
}

/** The refusal text for a completion call while ae_workflow_complete is withheld (below 80% of the build items), else undefined. */
export function withheldCompletion(deps: ChatAgentDeps, input: JobInput): string | undefined {
  const jobId = checklistJob(deps, input);
  const held = jobId ? completionWithheld(deps.state, jobId, deps.state.workflowCoordinator.workflowStore.getState()) : undefined;
  return held ? completionWithheldMessage() : undefined;
}

function withoutCompletionText(text: string): string {
  return COMPLETION_CLAUSES.reduce((current, clause) => current.replace(clause, ""), text);
}

/**
 * The value with every completion clause taken out: "(and call ae_workflow_complete …)" and ", or call ae_workflow_complete …" first, so the instruction
 * they hang off survives, then any other sentence naming the tool. Strings inside arrays and objects are filtered too.
 */
export function withoutCompletion(value: string): string;
export function withoutCompletion(value: JsonValue): JsonValue;
export function withoutCompletion(value: JsonValue): JsonValue {
  if (typeof value === "string") return withoutCompletionText(value);
  if (isJsonArray(value)) return value.map((entry) => withoutCompletion(entry));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withoutCompletion(entry)]));
  return value;
}

function withoutCompletionResult(result: AgentToolResult): AgentToolResult {
  const scrubbed: AgentToolResult = { ...result };
  for (const [key, entry] of Object.entries(result)) if (entry !== undefined) scrubbed[key] = withoutCompletion(jsonOf(entry));
  return scrubbed;
}

/**
 * While completion is withheld the owner is never invited to complete: whether the request is built is the checklist's call, not the model's.
 * A model that was offered "or call ae_workflow_complete if it is" in a receipt or nudge kept calling the tool
 * repeatedly; hiding the tool did not stop it while the text kept naming it. Tool results, wake nudges and cycle messages all pass through here.
 */
export function heldCompletion(deps: ChatAgentDeps, input: JobInput, value: string): string;
export function heldCompletion(deps: ChatAgentDeps, input: JobInput, value: string | undefined): string | undefined;
export function heldCompletion(deps: ChatAgentDeps, input: JobInput, value: AgentToolResult): AgentToolResult;
export function heldCompletion(deps: ChatAgentDeps, input: JobInput, value: string | undefined | AgentToolResult): string | undefined | AgentToolResult {
  if (!withheldCompletion(deps, input)) return value;
  if (typeof value === "string") return withoutCompletionText(value);
  return value === undefined ? value : withoutCompletionResult(value);
}

/** ae_workflow_unbuilt: closes attempted items the model could not build. */
export function unbuiltTool(deps: ChatAgentDeps, input: ChatAgentInput, args: ToolArguments): ToolResult {
  const jobId = checklistJob(deps, input);
  if (!jobId) return UNAVAILABLE;
  const closed = closeUnbuilt(deps.state, jobId, deps.state.workflowCoordinator.workflowStore.getState(), args.items);
  if (!closed.ok) return { ok: false, error: { code: closed.code, message: closed.message } };
  return { ok: true, tool: WORKFLOW_UNBUILT_TOOL, snapshotFingerprint: deps.planState.normalizedLatest()?.fingerprint ?? null, data: closed.data };
}
