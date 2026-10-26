// The MCP tool surface of the sidecar: one call in, one bounded result out. Panel command delivery lives in the delivery capability.
import type { PlanSource } from "./host/facts.js";
import type { McpInput } from "./server-mcp-arguments.js";
import { approvePlanInProcess, type InProcessApproval } from "./server-mcp-approval.js";
import { callMcpTool } from "./server-mcp-call.js";
import type { McpExchange, McpToolsDeps } from "./server-mcp-model.js";

/** What the routes and the host lane call into. */
export interface McpToolsCapability {
  callMcpTool(input: McpInput, exchange: McpExchange): Promise<void>;
  approvePlanInProcess(planId: string, source: PlanSource): Promise<InProcessApproval>;
}

/** Builds the tool capability over the sidecar's shared state. */
export function createMcpTools(deps: McpToolsDeps): McpToolsCapability {
  return {
    callMcpTool: (input, exchange) => callMcpTool(deps, input, exchange),
    approvePlanInProcess: (planId, source) => approvePlanInProcess(deps, planId, source),
  };
}
