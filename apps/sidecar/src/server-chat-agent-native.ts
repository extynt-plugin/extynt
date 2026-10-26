// Runs one tool as the native tool set answers it: the discovery and ownership refusals, the collection tools, the seal's wait, the plan card's apply decision and the hand-over of an Undo.
import { callTool, planCardTools, toolError } from "@extynt/mcp-server";
import { isCollectionTool, runChatCollectionTool } from "./collection-tools.js";
import { discoveryToolAllowed } from "./discovery-briefing.js";
import { requestNamesLayerStyle } from "./layer-style-request.js";
import { runScopedAware, scopedCaller } from "./scoped-aware-tool.js";
import type { NativeToolCall } from "./server-chat-agent-call.js";
import { foreignWorkflowRefusal } from "./server-chat-agent-preflight.js";
import { recordToolProgress } from "./server-chat-agent-progress.js";
import { handleSealResult, isSealTool, markApplyDecision } from "./server-chat-agent-seal.js";
import type { AgentToolReply, AgentToolSuccess, ChatAgentDeps } from "./server-chat-agent-types.js";
import { AGENT_DEFAULT_WAIT_SECONDS } from "./server-limits.js";
import { UNDO_TOOLS } from "./server-mcp-plan-delivery.js";
import type { SealWait } from "./server-workflow-seal-receipt.js";

const PLAN_CARD_TOOLS: ReadonlySet<string> = new Set(planCardTools().map((definition) => definition.name));
const DISCOVERY_READ_ONLY_MESSAGE = "This discovery turn cannot propose, queue, approve, apply, Undo or complete a workflow. Demand bounded target metadata first; a subsequent ordinary turn uses the existing authorization workflow.";

type EarlyReply = AgentToolReply | Promise<AgentToolReply> | undefined;
type NativeRule = (deps: ChatAgentDeps, call: NativeToolCall) => EarlyReply;
type SealPreparation = { readonly ok: true; readonly wait: SealWait } | { readonly ok: false; readonly reply: AgentToolReply };

interface SealingCall {
  readonly wait: SealWait;
  readonly openQueuePlanId: string | null;
}

const NATIVE_RULES: readonly NativeRule[] = [
  (_deps, { name, input }) => (input.discoveryOnly && !discoveryToolAllowed(name) ? toolError("DISCOVERY_READ_ONLY", DISCOVERY_READ_ONLY_MESSAGE) : undefined),
  (deps, { name, input }) => (input.discoveryOnly && name === "ae_status" ? deps.planView.statusToolResult() : undefined),
  (_deps, { name, input }) => foreignWorkflowRefusal(name, input),
  (deps, { name, args, input }) => (isCollectionTool(name) ? runChatCollectionTool(deps, name, args, input) : undefined),
  (deps, { name, args, input }) => (input.discoveryOnly ? callTool(name, args, deps.planView.toolContext(deps.planState.normalizedLatest())) : undefined),
];

function nativePreflight(deps: ChatAgentDeps, call: NativeToolCall): EarlyReply {
  for (const rule of NATIVE_RULES) {
    const answer = rule(deps, call);
    if (answer) return answer;
  }
  return undefined;
}

async function prepareSeal(deps: ChatAgentDeps, { name, args, input }: NativeToolCall): Promise<SealPreparation> {
  if (!isSealTool(name)) return { ok: true, wait: { seconds: 0, startedAt: 0 } };
  const wait = { seconds: deps.applyRuntime.settleWaitSeconds(name, args), startedAt: Date.now() };
  const settled = await deps.applyRuntime.settleInFlightBatch(deps.planView.sealingPlanId(input.requestId), wait.seconds, input.signal);
  return settled.ok ? { ok: true, wait } : { ok: false, reply: settled.refusal };
}

function nativeToolContext(deps: ChatAgentDeps, { name, input }: NativeToolCall, snapshot: ReturnType<ChatAgentDeps["planState"]["normalizedLatest"]>): ReturnType<ChatAgentDeps["planView"]["toolContext"]> {
  const context = deps.planView.toolContext(snapshot);
  if (name === "ae_status") context.statusMemory = deps.chatSupport.statusMemoryFor(input.requestId);
  context.requestAsksLayerStyle = requestNamesLayerStyle(input);
  return context;
}

function scopedNativeCall(deps: ChatAgentDeps, call: NativeToolCall): AgentToolReply {
  return runScopedAware(call.name, deps.planState.normalizedLatest(), scopedCaller(deps.planState, (snapshot) => callTool(call.name, call.args, nativeToolContext(deps, call, snapshot))));
}

function holdForReview(deps: ChatAgentDeps, { name, args, input }: NativeToolCall): void {
  if (isSealTool(name) && args.review === true) deps.state.reviewHeldRequests.add(input.requestId);
}

function autoApplyDecision(deps: ChatAgentDeps, { input }: NativeToolCall): boolean {
  return input.autoApply && !deps.state.reviewHeldRequests.has(input.requestId);
}

async function deliverUndoRequest(deps: ChatAgentDeps, name: string, reply: AgentToolSuccess): Promise<void> {
  if (!UNDO_TOOLS.has(name)) return;
  const panel = String(deps.planView.pipeline().panel ?? "");
  await deps.delivery.deliverUndo(reply, panel === "idle" ? AGENT_DEFAULT_WAIT_SECONDS[name] ?? 0 : 0);
}

async function settleNativeReply(deps: ChatAgentDeps, call: NativeToolCall, sealing: SealingCall, reply: AgentToolSuccess): Promise<AgentToolReply> {
  const { name, args, input } = call;
  await deps.delivery.deliverPanelRequest(name, reply, deps.applyRuntime.settleWaitSeconds(name, args));
  holdForReview(deps, call);
  const autoApply = autoApplyDecision(deps, call);
  if (PLAN_CARD_TOOLS.has(name)) markApplyDecision(reply, autoApply);
  const replaced = await handleSealResult({ deps, reply, name, wait: sealing.wait, openQueuePlanId: sealing.openQueuePlanId, input, autoApply });
  if (replaced) return replaced;
  await deliverUndoRequest(deps, name, reply);
  return reply;
}

/** Runs the tool the native way: refused early for a discovery turn or a caller that is not the owner, the collection tools answered, then the call itself under the seal's wait, with its progress recorded and its plan card, seal and Undo delivered. Only the status read collapses, and only within the turn asking for it. A scoped graph read never displaces the whole project for validation: the plan is tried against it, then the whole read, exactly as for an external client. The panel toggle, a review the user asked for, and a hold the agent placed each keep the panel from committing without a click; nothing the agent passes can grant more. Undo is the panel's button, so a successful call is only a request until it is handed over. */
export async function runNativeAgentTool(deps: ChatAgentDeps, call: NativeToolCall): Promise<AgentToolReply> {
  const early = nativePreflight(deps, call);
  if (early) return early;
  const { name, args, input } = call;
  const focusNote = await deps.focus.beforeTool(name, true, args);
  const prepared = await prepareSeal(deps, call);
  if (!prepared.ok) return prepared.reply;
  const openQueuePlanId = deps.state.openQueuePlanId;
  const reply = scopedNativeCall(deps, call);
  if (focusNote && reply.ok) Object.assign(reply, { focusNote });
  recordToolProgress(deps, { name, requestId: input.requestId, openQueuePlanId }, reply);
  if (reply.ok) return settleNativeReply(deps, call, { wait: prepared.wait, openQueuePlanId }, reply);
  holdForReview(deps, call);
  return reply;
}
