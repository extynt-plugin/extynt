// Admitting an MCP tool call: who made it, whether it may run now and how long it may wait for After Effects.
import { jsonOf, MCP_SERVER_VERSION, PANEL_AGENT_ONLY_TOOLS } from "@extynt/mcp-server";

import { isCollectionTool } from "./collection-tools.js";
import { recordMcpCall } from "./server-activity.js";
import { isProposeApply } from "./server-mcp-apply.js";
import type { McpInput } from "./server-mcp-arguments.js";
import { answerCall, refuseCall, type McpCall, type McpExchange, type McpToolsDeps } from "./server-mcp-model.js";
import type { McpResponder } from "./server-mcp-result.js";
import type { Refusal } from "./server-route-body.js";
import { AGENT_DEFAULT_WAIT_SECONDS, AGENT_WAIT_MAX_SECONDS, MAX_AGENT_MAILBOX_ITEMS, MAILBOX_TOOLS } from "./server-limits.js";
import { headerId } from "./server-http-wire.js";

const PROFILE_TOOLS: ReadonlySet<string> = new Set(["ae_get_bootstrap_context", "ae_list_native_operations", "ae_search_native_operations", "ae_describe_native_operation", "ae_get_host_profile_summary", "ae_get_host_profile_status", "ae_search_host_capabilities", "ae_describe_host_capability", "ae_decision_model"]);
const GRAPH_PAGE_TOOLS: ReadonlySet<string> = new Set(["ae_read_graph_page", "ae_get_graph_page"]);
const GRAPH_PAGE_WAIT_SECONDS = 20;

interface Caller {
  readonly agentOriginated: boolean;
  readonly clientVersion: string | null;
}

function isProfileTool(name: string): boolean {
  return PROFILE_TOOLS.has(name) || isCollectionTool(name);
}

function defaultWaitSeconds(input: McpInput): number {
  const waitedTool = isProposeApply(input) ? "ae_approve_plan" : input.name;
  return AGENT_DEFAULT_WAIT_SECONDS[waitedTool] ?? (GRAPH_PAGE_TOOLS.has(input.name) ? GRAPH_PAGE_WAIT_SECONDS : 0);
}

function waitOf(input: McpInput, agentOriginated: boolean): { seconds: number; requested: boolean } {
  const requested = input.controls.waitSeconds;
  if (requested !== undefined) return { seconds: Math.max(0, Math.min(AGENT_WAIT_MAX_SECONDS, requested)), requested: true };
  return { seconds: agentOriginated ? defaultWaitSeconds(input) : 0, requested: false };
}

function versionSkewWarning(clientVersion: string | null): string | undefined {
  if (clientVersion === MCP_SERVER_VERSION) return undefined;
  const theirs = clientVersion ?? "a build too old to report its version";
  return `VERSION_SKEW: the agent's extynt MCP server is ${theirs} but this sidecar is ${MCP_SERVER_VERSION}. Quit and reopen the agent app so it starts the matching extynt MCP server.`;
}

function responderFor(deps: McpToolsDeps, exchange: McpExchange, warning: string | undefined): McpResponder {
  return (result) => {
    if (!result.ok) {
      answerCall(deps.transport, exchange, { statusCode: 422, value: jsonOf(result), outcome: "rejected", errorCode: result.error.code });
      return;
    }
    if (warning) result.warning = warning;
    answerCall(deps.transport, exchange, { statusCode: 200, value: jsonOf(result), outcome: "succeeded" });
  };
}

function awaitingProject(deps: McpToolsDeps, input: McpInput): Refusal | null {
  if (isProfileTool(input.name)) return null;
  if (deps.state.awaitingFreshSnapshotAfterPair) return { status: 409, code: "AWAITING_FRESH_SNAPSHOT", message: "This panel instance must publish a fresh After Effects snapshot before tools can plan, approve, or execute work." };
  return deps.state.latest ? null : { status: 409, code: "NO_SNAPSHOT", message: "Inspect a project before calling an After Effects tool." };
}

function panelAgentOnly(input: McpInput): Refusal | null {
  if (!PANEL_AGENT_ONLY_TOOLS.has(input.name)) return null;
  return { status: 422, code: "PANEL_AGENT_ONLY", message: `${input.name} belongs to the in-panel agent. Author with ae_propose_plan, then ae_approve_plan.` };
}

function mailboxRefusal(deps: McpToolsDeps, input: McpInput): Refusal | null {
  if (!MAILBOX_TOOLS.has(input.name) && !isProposeApply(input)) return null;
  if (deps.state.agentMailbox.length >= MAX_AGENT_MAILBOX_ITEMS) return { status: 429, code: "MAILBOX_FULL", message: "The paired panel has not claimed prior agent work; wait for it to catch up." };
  const pipeline = deps.planView.pipeline();
  return pipeline.panel === "offline" ? { status: 409, code: "HOST_OFFLINE", message: `${String(pipeline.hint)} Nothing was queued.` } : null;
}

function callerOf(exchange: McpExchange): Caller {
  const { headers } = exchange.request;
  return { agentOriginated: headers["x-ae-client"] === "agent", clientVersion: headerId(headers["x-ae-client-version"]) };
}

function noteAgentCall(deps: McpToolsDeps, input: McpInput, clientVersion: string | null): void {
  deps.state.lastAgentCall = { at: deps.state.now().toISOString(), client: clientVersion ?? "unknown", tool: input.name };
}

function answerStatus(deps: McpToolsDeps, exchange: McpExchange, caller: Caller): void {
  answerCall(deps.transport, exchange, { statusCode: 200, value: deps.planView.statusToolResult(caller), outcome: "succeeded" });
}

function refusalOf(deps: McpToolsDeps, input: McpInput, caller: Caller): Refusal | null {
  const early = awaitingProject(deps, input) ?? panelAgentOnly(input);
  if (early) return early;
  if (caller.agentOriginated) noteAgentCall(deps, input, caller.clientVersion);
  return mailboxRefusal(deps, input);
}

/** The call, ready to run, or undefined once it has been answered: `ae_status` is answered here, a call that cannot run now is refused, and an agent's call is recorded. */
export function admitCall(deps: McpToolsDeps, input: McpInput, exchange: McpExchange): McpCall | undefined {
  const caller = callerOf(exchange);
  const { agentOriginated, clientVersion } = caller;
  if (agentOriginated) recordMcpCall(deps.state, { tool: input.name, args: input.arguments, client: clientVersion ?? "agent", response: exchange.response, context: exchange.context }, () => deps.transport.notifyChange());
  if (input.name === "ae_status") {
    answerStatus(deps, exchange, caller);
    return undefined;
  }
  const refusal = refusalOf(deps, input, caller);
  if (refusal) {
    refuseCall(deps.transport, exchange, refusal);
    return undefined;
  }
  const wait = waitOf(input, agentOriginated);
  const warning = agentOriginated ? versionSkewWarning(clientVersion) : undefined;
  return { input, exchange, agentOriginated, waitSeconds: wait.seconds, waitRequested: wait.requested, answer: responderFor(deps, exchange, warning) };
}
