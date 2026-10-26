// The advertised tool surface: every tool's definition in listing order, and the audience filters the sidecar and the CLI read.
import { DECISION_MODEL_TOOLS } from "./decision-model-tool-definitions.js";
import { EFFECT_NOTE_TOOLS } from "./effect-notes-tool-definitions.js";
import { RELATIONAL_TOOLS } from "./relational-tool-definitions.js";
import { VARIANT_TOOLS } from "./variant-tool-definitions.js";
import { GRAPH_TOOLS } from "./tool-specs-graph.js";
import { HOST_TOOLS } from "./tool-specs-host.js";
import { PLAN_TOOLS } from "./tool-specs-plan.js";
import { READ_TOOLS } from "./tool-specs-read.js";
import { SOLVER_TOOLS } from "./tool-specs-solver.js";
import type { ToolDefinition } from "./contracts.js";
import type { ToolEntry } from "./tool.js";

const TOOL_ENTRIES: ReadonlyArray<ToolEntry> = [...RELATIONAL_TOOLS, ...EFFECT_NOTE_TOOLS, ...DECISION_MODEL_TOOLS, ...VARIANT_TOOLS, ...GRAPH_TOOLS, ...READ_TOOLS, ...SOLVER_TOOLS, ...HOST_TOOLS, ...PLAN_TOOLS];

/** The definition of every tool, in listing order. */
export const TOOL_DEFINITIONS: ReadonlyArray<ToolDefinition> = TOOL_ENTRIES.map((entry) => entry.definition);

const AGENT_HIDDEN_TOOLS: ReadonlySet<string> = new Set(["ae_get_selection", "ae_get_fresh_edit_context", "ae_list_capabilities", "ae_prepare_change", "ae_present_plan"]);

/** Plan-lifecycle and demo tools the in-panel model never sees: it works through the queue, and the panel, CLI and external clients keep the rest callable. */
export const IN_PANEL_AGENT_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  "ae_propose_plan", "ae_plan_create", "ae_plan_add", "ae_plan_complete", "ae_amend_plan",
  "ae_list_plans", "ae_get_plan_status", "ae_approve_plan", "ae_cancel_plan",
  "ae_get_receipt", "ae_undo_plan", "ae_present_plan", "ae_prepare_change", "ae_get_fresh_edit_context", "ae_check_request", "ae_decision_model",
]);

/** The in-panel turn's own tools, never advertised to an external client: only that turn's seal reaches the panel's commit flow and only it opens the workflow job completion needs. */
export const PANEL_AGENT_ONLY_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_workflow_complete"]);

/** Callable by name but not listed to external clients: graph paging, plan building, bundled capability lookup, host-profile summaries and other tools no build or inspection needs. */
export const EXTERNAL_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  "ae_get_graph_page", "ae_read_graph_page", "ae_query_graph_cache", "ae_query_relational_graph",
  "ae_plan_create", "ae_plan_add", "ae_plan_complete", "ae_offer_variants", "ae_write_effect_note",
  "ae_prepare_parameter_change", "ae_undo_agent_work", "ae_resolve_capability", "ae_get_capture_frame",
  "ae_get_host_profile_summary", "ae_get_host_profile_status", "ae_get_inventory_diff", "ae_list_plans",
  "ae_get_effect_controls", "ae_search_capabilities", "ae_describe_capability", "ae_describe_control",
]);

/** The in-panel model's whole surface; the vision tools are the one part the sidecar decides, because only it knows whether the configured model can read an image. */
export function agentToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((definition) => !IN_PANEL_AGENT_HIDDEN_TOOLS.has(definition.name));
}

/** The tools whose results are shown as plan cards. */
export function planCardTools(): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((definition) => definition.planCard === true);
}

/** The tools a client is shown: all of them, or those an external agent sees. */
export function listTools(audience: "all" | "agent" = "all"): ToolDefinition[] {
  if (audience === "all") return [...TOOL_DEFINITIONS];
  return TOOL_DEFINITIONS.filter((definition) => ![AGENT_HIDDEN_TOOLS, PANEL_AGENT_ONLY_TOOLS, EXTERNAL_HIDDEN_TOOLS].some((hidden) => hidden.has(definition.name)));
}
