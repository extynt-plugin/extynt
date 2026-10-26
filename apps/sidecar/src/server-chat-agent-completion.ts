// The owner's ae_workflow_complete: the refusals that keep the turn working, the proposal the sidecar makes from the evidence it holds, and the verdict recorded for the turn.
import { type JsonObject } from "@extynt/decode";
import { toolError } from "@extynt/mcp-server";
import { coverageMessage } from "./request-coverage.js";
import type { AgentToolReply, AgentCallState, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { completionProposalFor } from "./server-workflow-completion-proposal.js";
import { frameAdvice } from "./decision-frame.js";
import { fontDisclosure } from "./server-workflow-font-guard.js";
import { jobCoverageRefusal, ownCompletion, type OwnCompletion } from "./server-workflow-auto-complete.js";
import { completionChecklist } from "./server-workflow-checklist-tools.js";
import { filmRefusal } from "./server-workflow-film-gate.js";
import { frameRefusal } from "./server-workflow-frame-gate.js";
import { recordSidecarAction } from "./server-workflow-sidecar-actions.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";

interface CompletionCall {
  readonly name: string;
  readonly args: JsonObject;
  readonly input: Pick<ChatAgentInput, "workflowJobId" | "workflowRole">;
  readonly state: AgentCallState;
}

type CompletionProposal = ReturnType<typeof completionProposalFor>;

function unsupportedCompletion(state: AgentCallState): AgentToolReply {
  const message = "Workflow completion is available only inside an admitted workflow job.";
  state.workflowCompletion = { accepted: false, code: "COMPLETION_UNSUPPORTED", message };
  return toolError("COMPLETION_UNSUPPORTED", message);
}

function currentWorkflowSnapshot(deps: ChatAgentDeps): { fingerprint: string; revision: string | null } | undefined {
  const snapshot = deps.planState.normalizedLatest();
  return snapshot ? { fingerprint: snapshot.fingerprint, revision: snapshot.revision } : undefined;
}

function citesEvidence(args: JsonObject): boolean {
  const evidence = args.evidence;
  return Array.isArray(evidence) && evidence.length > 0;
}

function modelCompletion(deps: ChatAgentDeps, prepared: CompletionProposal, sentEvidence: boolean): OwnCompletion {
  const cited = sentEvidence ? deps.state.workflowCoordinator.proposeCompletion(prepared.jobId, prepared.proposal, currentWorkflowSnapshot(deps)) : undefined;
  if (cited?.ok) return { ok: true };
  if (sentEvidence) recordSidecarAction(deps.state, prepared.jobId, "your ae_workflow_complete evidence ids did not match, so it cited the receipts it holds instead");
  return ownCompletion(deps, prepared.jobId);
}

function checklistRefusal(deps: ChatAgentDeps, jobId: string, { args, state }: CompletionCall): AgentToolReply | undefined {
  const checklist = completionChecklist(deps, jobId, args);
  if (checklist && "refusal" in checklist) return { ok: false, error: checklist.refusal };
  state.unbuiltNote = checklist?.unbuilt || undefined;
  return undefined;
}

function coverageRefusal(deps: ChatAgentDeps, jobId: string): AgentToolReply | undefined {
  const missing = jobCoverageRefusal(deps, jobId);
  return missing ? toolError("REQUEST_COVERAGE_INCOMPLETE", coverageMessage(missing)) : undefined;
}

function filmGateRefusal(deps: ChatAgentDeps, jobId: string): AgentToolReply | undefined {
  const refused = frameRefusal(deps, jobId) ?? filmRefusal(deps, jobId);
  return refused ? { ok: false, error: refused } : undefined;
}

function completionGate(deps: ChatAgentDeps, call: CompletionCall, jobSeed: string): AgentToolReply | undefined {
  const jobId = deps.state.workflowCoordinator.jobIdForSeed(jobSeed);
  return checklistRefusal(deps, jobId, call) ?? coverageRefusal(deps, jobId) ?? filmGateRefusal(deps, jobId);
}

function adviceOf(deps: ChatAgentDeps, jobId: string): { readonly advisory?: string } {
  const goal = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId]?.goalSummary;
  const notes = [frameAdvice(jobId), goal === undefined ? undefined : fontDisclosure(deps.state.hostProfile, goal)].filter((note): note is string => note !== undefined);
  return notes.length ? { advisory: notes.join(" ") } : {};
}

function completionReply(deps: ChatAgentDeps, { name, state }: CompletionCall, prepared: CompletionProposal, completion: OwnCompletion): AgentToolReply {
  state.workflowCompletion = completion.ok ? { accepted: true } : { accepted: false, code: completion.code, message: completion.message };
  if (!completion.ok) return toolError(completion.code, completion.message);
  return { ok: true, tool: name, snapshotFingerprint: deps.planState.normalizedLatest()?.fingerprint ?? null, data: { accepted: true, criteria: prepared.criteria, ...adviceOf(deps, prepared.jobId) } };
}

/** The owner's completion attempt. The checklist refusals come first and the keyword coverage stays as a second check; they are not recorded as refused completions, so the model is told what is missing and keeps working in this turn. The finished film follows the frame gate, and its message only changes when the film does, so the same refusal twice ends the turn on an unchanged film. Only the sidecar-assigned owner of an admitted job may complete; evidence ids are the sidecar's own records, so with none sent, or when the cited ones do not match, the sidecar cites what it holds instead of sending the model to find them. */
export function workflowCompletionReply(deps: ChatAgentDeps, call: CompletionCall): AgentToolReply {
  const { args, input, state } = call;
  const jobSeed = input.workflowJobId;
  if (!jobSeed || input.workflowRole !== WORKFLOW_OWNER) return unsupportedCompletion(state);
  const gated = completionGate(deps, call, jobSeed);
  if (gated) return gated;
  const prepared = completionProposalFor(deps, deps.state.workflowCoordinator, jobSeed, args);
  return completionReply(deps, call, prepared, modelCompletion(deps, prepared, citesEvidence(args)));
}
