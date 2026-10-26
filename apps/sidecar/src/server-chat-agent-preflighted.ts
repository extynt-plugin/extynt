// Everything a workflow tool call goes through after the design-first split: the workflow preflight, the tools the sidecar answers itself, the design and batch gates, then the native tool and what the sidecar does with a settled batch.
import { batchNodeGate } from "./workflow-batch-nodes.js";
import { runnerIn, type AgentToolCall, type TurnToolRunner } from "./server-chat-agent-call.js";
import { runNativeAgentTool } from "./server-chat-agent-native.js";
import { workflowToolPreflight } from "./server-chat-agent-preflight.js";
import { routeAfterPreflight } from "./server-chat-agent-routing.js";
import type { AgentToolReply, ChatAgentDeps } from "./server-chat-agent-types.js";
import { continueDesignBuild } from "./server-workflow-design-continue.js";
import { recordCreatedLayers, workflowDesignGate } from "./server-workflow-design.js";
import { closeSettledStage } from "./server-workflow-implicit-stage.js";
import { measureSettledFrame } from "./server-workflow-seal-receipt.js";
import { recordSeedAction } from "./server-workflow-sidecar-actions.js";

async function gateReply(deps: ChatAgentDeps, call: AgentToolCall, tools: TurnToolRunner): Promise<AgentToolReply | undefined> {
  const { name, args, input, state } = call;
  const run = runnerIn(tools, state);
  return workflowToolPreflight(deps, call) ?? (await routeAfterPreflight(deps, call, run)) ?? (state.designer ? undefined : await workflowDesignGate(deps, { name, args, run }, input)) ?? batchNodeGate(deps, name, args);
}

/** The call proper. Each step runs only when the one before it answered nothing: workflow preflight, the tools the sidecar answers itself, then the design and batch gates; the native tool follows, and a batch it settled closes its stage, is measured by a frame and carries on a design build. */
export async function runPreflightedTool(deps: ChatAgentDeps, call: AgentToolCall, tools: TurnToolRunner): Promise<AgentToolReply> {
  const early = await gateReply(deps, call, tools);
  if (early) return early;
  const { name, args, input, state } = call;
  const run = runnerIn(tools, state);
  const reply = await runNativeAgentTool(deps, call);
  closeSettledStage(state, reply);
  if (await measureSettledFrame(reply, run)) recordSeedAction(deps.state, input.workflowJobId, "took and measured a frame of the batch it just sealed (receipt.frame)");
  recordCreatedLayers(state, { name, args }, reply);
  return (await continueDesignBuild(deps, { name, input, state, result: reply }, run)) ?? reply;
}
