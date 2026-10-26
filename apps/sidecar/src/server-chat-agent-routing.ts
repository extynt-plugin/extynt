// Routes the tool calls the sidecar answers itself: its guides, questions, checklist and completion, a parameter change, the web search and the frame observation.
import { toolError } from "@extynt/mcp-server";
import { WORKFLOW_ASK_TOOL, WORKFLOW_CHECKLIST_TOOL, WORKFLOW_UNBUILT_TOOL, type ToolResult } from "./agent.js";
import { AGENT_GUIDE_TOOL, readGuideTool } from "./agent-guides.js";
import { runPanelParameterTool } from "./collection-tools.js";
import type { AgentToolCall, AgentToolRunner } from "./server-chat-agent-call.js";
import { workflowCompletionReply } from "./server-chat-agent-completion.js";
import { recordVisualObservation } from "./server-chat-observations.js";
import type { AgentToolReply, ChatAgentDeps } from "./server-chat-agent-types.js";
import { primeJobCoverage } from "./server-workflow-auto-complete.js";
import { primeFrameAdvice } from "./server-workflow-frame-gate.js";
import { askUserTool } from "./server-workflow-ask.js";
import { checklistTool, unbuiltTool, withheldCompletion } from "./server-workflow-checklist-tools.js";
import { toolCompletionWithFrames } from "./server-workflow-completion-evidence.js";

interface RoutedCall {
  readonly deps: ChatAgentDeps;
  readonly call: AgentToolCall;
  readonly run: AgentToolRunner;
}

type RoutedTool = (routed: RoutedCall) => AgentToolReply | Promise<AgentToolReply>;

function webSearchReply(search: ToolResult): AgentToolReply {
  if (search.ok) return { ...search, ok: true, tool: "web_search", snapshotFingerprint: null, data: search.data ?? null };
  return search.error ? { ok: false, error: search.error } : toolError("WEB_SEARCH_FAILED", "The web search did not return a result.");
}

function parameterChange({ deps, call, run }: RoutedCall): Promise<AgentToolReply> {
  const snapshot = deps.planState.normalizedLatest();
  const context = { collection: deps.state.collection, snapshot, panelInstanceId: deps.state.activePanelInstanceId, now: deps.state.now().getTime(), queuedPlanId: () => deps.state.openQueuePlanId ?? "" };
  return runPanelParameterTool(context, call.args, deps.planView.toolContext(snapshot), (queued) => run("ae_queue_add", queued));
}

async function completion({ deps, call, run }: RoutedCall): Promise<AgentToolReply> {
  const withheld = withheldCompletion(deps, call.input);
  if (withheld) return toolError("COMPLETION_NOT_OPEN", withheld);
  const jobId = call.input.workflowJobId ? deps.state.workflowCoordinator.jobIdForSeed(call.input.workflowJobId) : undefined;
  if (jobId) { await primeJobCoverage(deps, jobId); await primeFrameAdvice(deps, jobId); }
  return toolCompletionWithFrames(deps, call.input.workflowJobId, () => workflowCompletionReply(deps, call), run);
}

async function webSearch({ deps, call }: RoutedCall): Promise<AgentToolReply> {
  return webSearchReply(await deps.chatSupport.searchTheWeb(call.args, call.input.signal));
}

async function observeFrame({ deps, call }: RoutedCall): Promise<AgentToolReply> {
  const { name, args, input } = call;
  const reply = await deps.chatSupport.observeFrame(args, deps.applyRuntime.settleWaitSeconds(name, args), input.signal);
  const captureId = args.captureId;
  if (reply.ok) recordVisualObservation(deps, input, typeof captureId === "string" ? captureId : undefined, reply);
  return reply;
}

const SIDECAR_TOOLS: ReadonlyMap<string, RoutedTool> = new Map<string, RoutedTool>([
  ["ae_prepare_parameter_change", parameterChange],
  [AGENT_GUIDE_TOOL, ({ call }) => readGuideTool(call.args)],
  [WORKFLOW_ASK_TOOL, ({ deps, call }) => askUserTool(deps, call.args, call.input)],
  [WORKFLOW_CHECKLIST_TOOL, ({ deps, call }) => checklistTool(deps, call.input, call.args)],
  [WORKFLOW_UNBUILT_TOOL, ({ deps, call }) => unbuiltTool(deps, call.input, call.args)],
  ["ae_workflow_complete", completion],
  ["web_search", webSearch],
  ["ae_observe_frame", observeFrame],
]);

/** Answers a call to a tool the sidecar answers itself: a parameter change, its guides, a question to the user, the checklist, the unbuilt note, workflow completion, web search or a frame observation; any other tool passes. */
export async function routeAfterPreflight(deps: ChatAgentDeps, call: AgentToolCall, run: AgentToolRunner): Promise<AgentToolReply | undefined> {
  return await SIDECAR_TOOLS.get(call.name)?.({ deps, call, run });
}
