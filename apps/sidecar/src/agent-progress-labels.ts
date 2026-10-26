// The plain-language label shown while each tool runs: it names the work, never the tool. The words live in the catalogue; this maps a tool to its key.
import type { Translate, UiKey } from "@extynt/ui-text";
import { ENGLISH_TEXT } from "./plan-text.js";

type ProgressKey = Extract<UiKey, `plan.progress.${string}`>;

const TOOL_PROGRESS_KEYS: ReadonlyMap<string, ProgressKey> = new Map<string, ProgressKey>([
  ["web_search", "plan.progress.webSearch"],
  ["ae_get_current_context", "plan.progress.getCurrentContext"],
  ["ae_find_project_objects", "plan.progress.findProjectObjects"],
  ["ae_inspect_composition", "plan.progress.inspectComposition"],
  ["ae_inspect_layer", "plan.progress.inspectLayer"],
  ["ae_list_effects_and_expressions", "plan.progress.listEffectsAndExpressions"],
  ["ae_trace_dependencies", "plan.progress.traceDependencies"],
  ["ae_list_project_issues", "plan.progress.listProjectIssues"],
  ["ae_search_host_capabilities", "plan.progress.searchHostCapabilities"],
  ["ae_search_fonts", "plan.progress.searchFonts"],
  ["ae_describe_host_capability", "plan.progress.describeHostCapability"],
  ["ae_read_effect_notes", "plan.progress.readEffectNotes"],
  ["ae_write_effect_note", "plan.progress.writeEffectNote"],
  ["ae_search_capabilities", "plan.progress.searchCapabilities"],
  ["ae_describe_capability", "plan.progress.describeCapability"],
  ["ae_search_native_operations", "plan.progress.searchNativeOperations"],
  ["ae_describe_native_operation", "plan.progress.describeNativeOperation"],
  ["ae_tool_schema", "plan.progress.toolSchema"],
  ["ae_select_workflow_stage", "plan.progress.selectWorkflowStage"],
  ["ae_workflow_checklist", "plan.progress.workflowChecklist"],
  ["ae_ask_user", "plan.progress.askUser"],
  ["ae_read_guide", "plan.progress.readGuide"],
  ["ae_consult_specialist", "plan.progress.consultSpecialist"],
  ["ae_propose_plan", "plan.progress.proposePlan"],
  ["ae_offer_variants", "plan.progress.offerVariants"],
  ["ae_create_vector_artwork", "plan.progress.createVectorArtwork"],
  ["ae_queue_design", "plan.progress.queueDesign"],
  ["ae_plan_create", "plan.progress.planCreate"],
  ["ae_plan_add", "plan.progress.planAdd"],
  ["ae_plan_complete", "plan.progress.planComplete"],
  ["ae_list_plans", "plan.progress.listPlans"],
  ["ae_get_receipt", "plan.progress.getReceipt"],
  ["ae_queue_add", "plan.progress.queueAdd"],
  ["ae_queue_fix", "plan.progress.queueFix"],
  ["ae_queue_finish", "plan.progress.queueFinish"],
  ["ae_undo_agent_work", "plan.progress.undoAgentWork"],
  ["ae_measure_layer", "plan.progress.measureLayer"],
  ["ae_solve_arc_path", "plan.progress.solveArcPath"],
  ["ae_solve_stagger", "plan.progress.solveStagger"],
  ["ae_solve_keyframe_assistant", "plan.progress.solveKeyframeAssistant"],
]);

/** What the user sees while a tool runs; "Working" for a tool with no label of its own. English unless a translator is given. */
export function toolProgressLabel(tool: string, translate: Translate = ENGLISH_TEXT): string {
  const key = TOOL_PROGRESS_KEYS.get(tool);
  return translate(key ?? "plan.progress.working");
}
