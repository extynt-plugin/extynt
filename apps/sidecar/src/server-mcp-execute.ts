// Running a tool from the catalogue against the snapshot it can trust, and what a successful run changes around it.
import { callTool } from "@extynt/mcp-server";

import { announcePlanTool } from "./plans-events.js";
import { runScopedAware, scopedCaller } from "./scoped-aware-tool.js";
import type { McpInput } from "./server-mcp-arguments.js";
import { cancelWorkflowTool } from "./server-mcp-cancel.js";
import { planIdOf } from "./server-mcp-data.js";
import type { McpToolsDeps } from "./server-mcp-model.js";
import type { McpResult, ToolData } from "./server-mcp-result.js";
import type { ProjectSnapshot } from "@extynt/project-graph";

const MUTATING_TOOLS: ReadonlySet<string> = new Set(["ae_create_vector_artwork", "ae_approve_plan", "ae_cancel_plan", "ae_present_plan"]);

function announceEffects(deps: McpToolsDeps, call: { input: McpInput; data: ToolData; agentOriginated: boolean }): void {
  const { input, data, agentOriginated } = call;
  if (MUTATING_TOOLS.has(input.name)) deps.transport.notifyChange();
  announcePlanTool(deps.state, { name: input.name, planId: planIdOf(data) || input.controls.planId, source: agentOriginated ? "agent" : "panel" });
}

/** Runs the tool. A successful run wakes the change waiters; one that touches the plan list also tells every panel stream to read it again, and a cancelled plan stops its workflow job. */
export function executeTool(deps: McpToolsDeps, input: McpInput, run: { snapshot: ProjectSnapshot | undefined; agentOriginated: boolean }): McpResult {
  const result = runScopedAware(input.name, run.snapshot, scopedCaller<McpResult>(deps.planState, (snapshot) => callTool(input.name, input.arguments, deps.planView.toolContext(snapshot, "external"))));
  if (result.ok) {
    announceEffects(deps, { input, data: result.data, agentOriginated: run.agentOriginated });
    if (input.name === "ae_cancel_plan") cancelWorkflowTool(deps, input);
  }
  deps.runtime.prunePlans();
  return result;
}
