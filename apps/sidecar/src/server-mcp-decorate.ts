// What the sidecar adds to a tool's result before it is answered: the pipeline, the source of each plan, the catalogue progress and the refreshed snapshot.
import { jsonOf } from "@extynt/mcp-server";

import { catalogueProgressWithEngine } from "./catalogue-engine.js";
import { thumbTargetFor } from "./host/thumb-target.js";
import type { McpInput } from "./server-mcp-arguments.js";
import { isDataFields, isDataRows, planIdOf, type DataFields } from "./server-mcp-data.js";
import type { McpCall, McpToolsDeps } from "./server-mcp-model.js";
import type { McpResult, McpSuccess, ToolData } from "./server-mcp-result.js";
import { IN_FLIGHT_PLAN_STATUSES } from "./server-limits.js";

type Decoration = (deps: McpToolsDeps, result: McpSuccess, call: McpCall) => void;

const FINGERPRINT_REFRESHED_TOOLS: ReadonlySet<string> = new Set(["ae_approve_plan", "ae_undo_plan", "ae_undo_agent_work", "ae_get_plan_status"]);

function addPipelineWhileInFlight(deps: McpToolsDeps, data: DataFields, planId: string): void {
  const queuePosition = deps.planView.planQueuePosition(planId);
  Object.assign(data, { pipeline: deps.planView.pipeline(), ...(queuePosition ? { queuePosition } : {}) });
}

function decoratePlanStatus(deps: McpToolsDeps, result: McpSuccess): void {
  const data = result.data;
  if (!isDataFields(data)) return;
  const planId = planIdOf(data);
  const record = deps.state.plans.get(planId);
  if (record && IN_FLIGHT_PLAN_STATUSES.has(record.status)) addPipelineWhileInFlight(deps, data, planId);
  if (record?.rebasedOver) data.rebased = { overPlans: record.rebasedOver };
}

function couldBePictured(deps: McpToolsDeps, planId: string): boolean {
  const record = deps.state.plans.get(planId);
  return !!record && !!deps.state.latest && thumbTargetFor(jsonOf(record.plan.operations), deps.state.latest.snapshot) !== null;
}

function shownPresentation(presentation: ToolData | undefined, wanted: boolean): ToolData | undefined {
  if (!isDataFields(presentation) || !("shown" in presentation)) return presentation;
  const { shown, ...rest } = presentation;
  return wanted && isDataFields(shown) ? { ...rest, ...shown } : rest;
}

function withSource(deps: McpToolsDeps, row: ToolData, call: McpCall): ToolData {
  if (!isDataFields(row) || !("planId" in row)) return row;
  const planId = planIdOf(row);
  const presentation = shownPresentation(row.presentation, !call.agentOriginated);
  return { ...row, ...(presentation === undefined ? {} : { presentation }), source: deps.state.hostFacts.planSources.get(planId) ?? null, visual: couldBePictured(deps, planId) };
}

function decoratePlanSources(deps: McpToolsDeps, result: McpSuccess, call: McpCall): void {
  if (isDataRows(result.data)) result.data = result.data.map((row) => withSource(deps, row, call));
}

function decorateBootstrap(deps: McpToolsDeps, result: McpSuccess): void {
  const pipeline = deps.planView.pipeline();
  if (pipeline.panel !== "idle" && isDataFields(result.data)) result.data.pipeline = pipeline;
}

function decorateProfileStatus(deps: McpToolsDeps, result: McpSuccess): void {
  const data = result.data;
  if (!isDataFields(data) || data.status === "NOT_MODIFIED") return;
  data.catalogue = jsonOf(catalogueProgressWithEngine(deps.state.catalogue.progress(), deps.state.catalogueEngine));
  data.deepProbe = "automatic, on this machine: controls are probed in a scratch project after startup; see catalogue";
}

const DECORATIONS: ReadonlyMap<string, Decoration> = new Map<string, Decoration>([
  ["ae_get_plan_status", decoratePlanStatus],
  ["ae_list_plans", decoratePlanSources],
  ["ae_get_bootstrap_context", decorateBootstrap],
  ["ae_get_host_profile_status", decorateProfileStatus],
]);

/** Adds what the tool's result lacks: the pipeline beside a plan in flight, who asked for each listed plan and whether it has a picture, the catalogue progress, and the snapshot a refresh waited for. */
export async function decorateResult(deps: McpToolsDeps, call: McpCall, run: { result: McpResult; beforeSnapshotAt: string | undefined; beforeFingerprint: string | undefined }): Promise<void> {
  const { result, beforeSnapshotAt, beforeFingerprint } = run;
  if (!result.ok) return;
  DECORATIONS.get(call.input.name)?.(deps, result, call);
  if (call.input.name === "ae_refresh_snapshot") await deps.delivery.refreshSnapshot(result, call.waitSeconds, beforeSnapshotAt, beforeFingerprint);
}

/** A result that reports on plans carries the fingerprint of the project as it stands now, not as it stood when the call began. */
export function refreshFingerprint(deps: McpToolsDeps, input: McpInput, result: McpResult): void {
  if (!result.ok || !FINGERPRINT_REFRESHED_TOOLS.has(input.name)) return;
  const latest = deps.planState.normalizedLatest();
  if (latest) result.snapshotFingerprint = latest.fingerprint;
}
