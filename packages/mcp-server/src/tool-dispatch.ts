// The tool dispatcher: each tool name maps to the one handler that answers it, either from the host profile alone or from a loaded project snapshot.
import type { ToolContext } from "./contracts.js";
import { prepareBlurMotion } from "./blur-motion.js";
import { freshEditContext, proposeCustomPlan, resolveSemanticCapability } from "./edit-tools.js";
import type { JsonObject } from "@extynt/decode";
import { nativeOperationDescribeTool, nativeOperationListTool, searchNativeOperationsTool } from "./native-operation-tools.js";
import { addToPlan } from "./plan-add.js";
import { amendPlan } from "./plan-amend.js";
import { completePlan } from "./plan-complete.js";
import { createPlan } from "./plan-create.js";
import { approvePlan, cancelPlan, getReceipt, listPlans, planStatus, presentPlan, recallPlan } from "./plan-tools.js";
import { undoAgentWork, undoPlan } from "./plan-undo.js";
import { hostCapabilityDetailTool, hostCapabilitySearchTool, hostFontSearchTool, hostProfileStatusTool, hostProfileSummaryTool } from "./profile-tools.js";
import { queueAdd, queueFinish, queueFix } from "./queue.js";
import { keyframeAssistantTool } from "./solver-assistant-tool.js";
import { arcPathTool, staggerTool } from "./solver-tools.js";
import { bootstrapContextTool } from "./tool-bootstrap.js";
import { buildKitTool, captureFrameTool, capturedFrameTool } from "./tool-capture.js";
import { currentContextTool, findObjectsTool, projectOverviewTool, refreshSnapshotTool, selectionTool, statusTool } from "./tool-project.js";
import {
  dependenciesTool, describeCapabilityTool, effectControlsTool, effectsAndExpressionsTool, inspectCompositionTool, inspectLayerTool,
  inventoryDiffTool, listCapabilitiesTool, measureTool, needsFullCoverage, projectIssuesTool, searchCapabilitiesTool,
} from "./tool-read.js";
import { hostHandler, snapshotHandler } from "./tool-handle.js";
import type { HostHandler } from "./tool-handle.js";
import {
  AE_CAPTURE_COMPOSITION_FRAME, AE_DESCRIBE_NATIVE_OPERATION, AE_FIND_PROJECT_OBJECTS, AE_GET_BOOTSTRAP_CONTEXT, AE_GET_CAPTURE_FRAME,
  AE_GET_CURRENT_CONTEXT, AE_GET_PROJECT_OVERVIEW, AE_GET_SELECTION, AE_INSPECT_COMPOSITION, AE_INSPECT_LAYER, AE_LIST_EFFECTS_AND_EXPRESSIONS,
  AE_LIST_NATIVE_OPERATIONS, AE_LIST_PROJECT_ISSUES, AE_MEASURE_LAYER, AE_OBSERVE_FRAME, AE_REFRESH_SNAPSHOT, AE_SEARCH_NATIVE_OPERATIONS, AE_STATUS, AE_TRACE_DEPENDENCIES,
} from "./tool-specs-read.js";
import {
  AE_DESCRIBE_CAPABILITY, AE_DESCRIBE_HOST_CAPABILITY, AE_GET_EFFECT_CONTROLS, AE_GET_HOST_PROFILE_STATUS, AE_GET_HOST_PROFILE_SUMMARY, AE_GET_INVENTORY_DIFF,
  AE_GET_FRESH_EDIT_CONTEXT, AE_LIST_CAPABILITIES, AE_RESOLVE_CAPABILITY, AE_SEARCH_CAPABILITIES, AE_SEARCH_FONTS, AE_SEARCH_HOST_CAPABILITIES,
} from "./tool-specs-host.js";
import {
  AE_AMEND_PLAN, AE_APPROVE_PLAN, AE_CANCEL_PLAN, AE_CREATE_VECTOR_ARTWORK, AE_GET_PLAN_STATUS, AE_GET_RECEIPT, AE_LIST_PLANS, AE_PLAN_ADD, AE_PLAN_COMPLETE,
  AE_PLAN_CREATE, AE_PREPARE_CHANGE, AE_PRESENT_PLAN, AE_PROPOSE_PLAN, AE_QUEUE_ADD, AE_QUEUE_FINISH, AE_QUEUE_FIX, AE_RECALL_PLAN, AE_UNDO_AGENT_WORK, AE_UNDO_PLAN, AE_WORKFLOW_COMPLETE,
} from "./tool-specs-plan.js";
import { AE_SOLVE_ARC_PATH, AE_SOLVE_KEYFRAME_ASSISTANT, AE_SOLVE_STAGGER } from "./tool-specs-solver.js";
import { toolError } from "./tool-result.js";
import type { SnapshotHandler, ToolRequest, ToolResult } from "./tool-result.js";
import { createVectorArtworkPlan } from "./tool-vector.js";
import { offerVariants } from "./variant-offer.js";
import { AE_OFFER_VARIANTS } from "./variant-tool-definitions.js";

export type { SnapshotHandler, ToolBase, ToolFailure, ToolRequest, ToolResult } from "./tool-result.js";

const WORKFLOW_COORDINATOR_REQUIRED = "Workflow completion must be validated and committed by the sidecar workflow coordinator; the standalone MCP dispatcher cannot mark work complete.";

const HOST_HANDLERS: ReadonlyMap<string, HostHandler> = new Map<string, HostHandler>([
  hostHandler(AE_WORKFLOW_COMPLETE, () => toolError("WORKFLOW_COORDINATOR_REQUIRED", WORKFLOW_COORDINATOR_REQUIRED)),
  hostHandler(AE_GET_BOOTSTRAP_CONTEXT, bootstrapContextTool),
  hostHandler(AE_LIST_NATIVE_OPERATIONS, nativeOperationListTool),
  hostHandler(AE_DESCRIBE_NATIVE_OPERATION, nativeOperationDescribeTool),
  hostHandler(AE_SEARCH_NATIVE_OPERATIONS, searchNativeOperationsTool),
  hostHandler(AE_GET_HOST_PROFILE_SUMMARY, hostProfileSummaryTool),
  hostHandler(AE_GET_HOST_PROFILE_STATUS, hostProfileStatusTool),
  hostHandler(AE_SEARCH_HOST_CAPABILITIES, hostCapabilitySearchTool),
  hostHandler(AE_DESCRIBE_HOST_CAPABILITY, hostCapabilityDetailTool),
  hostHandler(AE_SEARCH_FONTS, hostFontSearchTool),
  hostHandler(AE_SOLVE_ARC_PATH, arcPathTool),
  hostHandler(AE_SOLVE_STAGGER, staggerTool),
  hostHandler(AE_SOLVE_KEYFRAME_ASSISTANT, keyframeAssistantTool),
]);

const SNAPSHOT_HANDLERS: ReadonlyMap<string, SnapshotHandler> = new Map<string, SnapshotHandler>([
  snapshotHandler(AE_CAPTURE_COMPOSITION_FRAME, captureFrameTool),
  snapshotHandler(AE_GET_CAPTURE_FRAME, capturedFrameTool),
  snapshotHandler(AE_OBSERVE_FRAME, capturedFrameTool),
  ["ae_get_build_kit", buildKitTool],
  snapshotHandler(AE_GET_FRESH_EDIT_CONTEXT, ({ base, snapshot }) => freshEditContext(base, snapshot)),
  snapshotHandler(AE_RESOLVE_CAPABILITY, resolveSemanticCapability),
  snapshotHandler(AE_PREPARE_CHANGE, ({ base, snapshot, args, context }) => prepareBlurMotion(base, snapshot, args, context)),
  snapshotHandler(AE_CREATE_VECTOR_ARTWORK, ({ base, snapshot, args, context }) => createVectorArtworkPlan(base, snapshot, args, context)),
  snapshotHandler(AE_PROPOSE_PLAN, ({ base, snapshot, args, context }) => proposeCustomPlan(base, snapshot, args, context)),
  snapshotHandler(AE_OFFER_VARIANTS, ({ base, snapshot, args, context }) => offerVariants(base, snapshot, args, context)),
  snapshotHandler(AE_PLAN_CREATE, ({ base, snapshot, args, context }) => createPlan(base, snapshot, args, context)),
  snapshotHandler(AE_PLAN_ADD, ({ base, snapshot, args, context }) => addToPlan(base, snapshot, args, context)),
  snapshotHandler(AE_PLAN_COMPLETE, ({ base, snapshot, args, context }) => completePlan(base, snapshot, args, context)),
  snapshotHandler(AE_AMEND_PLAN, ({ base, args, context }) => amendPlan(base, args, context)),
  snapshotHandler(AE_QUEUE_ADD, ({ base, snapshot, args, context }) => queueAdd(base, snapshot, args, context)),
  snapshotHandler(AE_QUEUE_FIX, ({ base, args, context }) => queueFix(base, args, context)),
  snapshotHandler(AE_QUEUE_FINISH, ({ base, snapshot, context }) => queueFinish(base, snapshot, context)),
  snapshotHandler(AE_LIST_PLANS, ({ base, args, context }) => listPlans(base, args, context)),
  snapshotHandler(AE_PRESENT_PLAN, ({ base, args, context }) => presentPlan(base, args, context)),
  snapshotHandler(AE_GET_PLAN_STATUS, ({ base, args, context }) => planStatus(base, args, context)),
  snapshotHandler(AE_RECALL_PLAN, ({ base, args, context }) => recallPlan(base, args, context)),
  snapshotHandler(AE_GET_RECEIPT, ({ base, args, context }) => getReceipt(base, args, context)),
  snapshotHandler(AE_APPROVE_PLAN, ({ base, args, context }) => approvePlan(base, args, context)),
  snapshotHandler(AE_CANCEL_PLAN, ({ base, args, context }) => cancelPlan(base, args, context)),
  snapshotHandler(AE_UNDO_PLAN, ({ base, args, context }) => undoPlan(base, args, context)),
  snapshotHandler(AE_UNDO_AGENT_WORK, ({ base, args, context }) => undoAgentWork(base, args, context)),
  snapshotHandler(AE_STATUS, statusTool),
  snapshotHandler(AE_REFRESH_SNAPSHOT, refreshSnapshotTool),
  snapshotHandler(AE_GET_CURRENT_CONTEXT, currentContextTool),
  snapshotHandler(AE_GET_PROJECT_OVERVIEW, projectOverviewTool),
  snapshotHandler(AE_GET_SELECTION, selectionTool),
  snapshotHandler(AE_FIND_PROJECT_OBJECTS, findObjectsTool),
  snapshotHandler(AE_INSPECT_COMPOSITION, inspectCompositionTool),
  snapshotHandler(AE_INSPECT_LAYER, needsFullCoverage(inspectLayerTool)),
  snapshotHandler(AE_LIST_EFFECTS_AND_EXPRESSIONS, needsFullCoverage(effectsAndExpressionsTool)),
  snapshotHandler(AE_TRACE_DEPENDENCIES, needsFullCoverage(dependenciesTool)),
  snapshotHandler(AE_LIST_PROJECT_ISSUES, needsFullCoverage(projectIssuesTool)),
  snapshotHandler(AE_MEASURE_LAYER, needsFullCoverage(measureTool)),
  snapshotHandler(AE_LIST_CAPABILITIES, listCapabilitiesTool),
  snapshotHandler(AE_SEARCH_CAPABILITIES, searchCapabilitiesTool),
  snapshotHandler(AE_DESCRIBE_CAPABILITY, describeCapabilityTool),
  snapshotHandler(AE_GET_EFFECT_CONTROLS, effectControlsTool),
  snapshotHandler(AE_GET_INVENTORY_DIFF, inventoryDiffTool),
]);

const UNSUPPORTED = (): ToolResult => toolError("UNSUPPORTED_TOOL", "This adapter does not answer that tool; the sidecar does.");

/** Answers the tools that need no project snapshot, or `undefined` when the tool needs one. */
export function hostIndependentTool(name: string, args: JsonObject, context: ToolContext): ToolResult | undefined {
  const handler = HOST_HANDLERS.get(name);
  return handler?.({ name, args, context });
}

/** Answers one tool from a loaded snapshot. */
export function snapshotTool(request: ToolRequest): ToolResult {
  return (SNAPSHOT_HANDLERS.get(request.name) ?? UNSUPPORTED)(request);
}
