// The tools the sidecar answers itself, ahead of the tool catalogue: the build kit, capture lookups, the request check, frame observation, the graph reads and parameter changes.
import { jsonOf } from "@extynt/mcp-server";
import { getActiveComposition } from "@extynt/project-graph";
import type { ProjectSnapshot } from "@extynt/project-graph";

import { buildKit, recordFontSubstitution } from "./build-kit.js";
import { primeJobOpen, primeRequestMissing } from "./decision-prime.js";
import { resolveRequestTerms, resolvedLines } from "./decision-resolve.js";
import { isCollectionTool, runCollectionTool } from "./collection-tools.js";
import { runExternalParameterTool } from "./relational-routing.js";
import { answerDecisionModel } from "./server-mcp-decision.js";
import { answerCheckRequest, heldOperations } from "./server-mcp-check.js";
import { isCapturePending } from "./server-mcp-capture-receipt.js";
import { refuseCall, type McpCall, type McpToolsDeps } from "./server-mcp-model.js";

type SpecialAnswer = (deps: McpToolsDeps, call: McpCall, snapshotFingerprint: string | null) => Promise<void> | void;

async function answerBuildKit(deps: McpToolsDeps, call: McpCall, snapshotFingerprint: string | null): Promise<void> {
  const request = call.input.controls.request;
  if (request === undefined || request.trim() === "") {
    refuseCall(deps.transport, call.exchange, { status: 422, code: "BUILD_KIT_REQUEST_REQUIRED", message: "ae_get_build_kit needs request: the user's request, verbatim." });
    return;
  }
  await primeJobOpen(deps.state.decisions, { request, message: request });
  const snapshot = deps.planState.normalizedLatest();
  const active = snapshot ? getActiveComposition(snapshot) : undefined;
  const fonts = deps.state.hostProfile?.fontInventory;
  const kit = buildKit(request, active?.id ?? "", fonts, deps.planState.currentRuntimeEvidence());
  const terms = await resolveRequestTerms(deps.state.decisions, request, { profile: deps.state.hostProfile, snapshot, preferences: deps.state.preferences, aliases: deps.state.aliases });
  recordFontSubstitution(deps.state.fontSubstitutions, request, fonts);
  const resolved = resolvedLines(terms);
  call.answer({ ok: true, tool: call.input.name, snapshotFingerprint, data: { kit: resolved.length === 0 ? kit : `${kit}\n${resolved.join("\n")}` } });
}

async function answerCaptureLookup(deps: McpToolsDeps, call: McpCall, snapshotFingerprint: string | null): Promise<void> {
  const { captureId } = call.input.controls;
  const { captures } = deps.state;
  if (call.waitSeconds > 0 && captures.has(captureId)) await deps.transport.waitUntil(() => !isCapturePending(captures.get(captureId)?.status), call.waitSeconds);
  const capture = captures.get(captureId);
  if (!capture) {
    refuseCall(deps.transport, call.exchange, { status: 422, code: "CAPTURE_NOT_FOUND", message: "No bounded capture exists for that ID." });
    return;
  }
  const pipeline = isCapturePending(capture.status) ? { pipeline: deps.planView.pipeline() } : {};
  call.answer({ ok: true, tool: call.input.name, snapshotFingerprint, data: { captureId, status: capture.status, receipt: jsonOf(capture.receipt ?? null), ...pipeline } });
}

async function answerCheck(deps: McpToolsDeps, call: McpCall): Promise<void> {
  const { request, compositionId } = call.input.controls;
  if (request !== undefined) await primeJobOpen(deps.state.decisions, { request, message: request });
  const held = { plans: deps.state.plans, sources: deps.state.hostFacts.planSources, latest: deps.planState.normalizedLatest() };
  if (request !== undefined) await primeRequestMissing(deps.state.decisions, request, heldOperations(held.plans, held.sources));
  const answer = answerCheckRequest({ request, compositionId }, held);
  if (answer.ok) call.answer({ ok: true, tool: call.input.name, snapshotFingerprint: answer.fingerprint, data: jsonOf(answer.data) });
  else refuseCall(deps.transport, call.exchange, { status: 422, code: answer.code, message: answer.message });
}

async function answerObservation(deps: McpToolsDeps, call: McpCall): Promise<void> {
  const observed = await deps.chatSupport.observeFrame(call.input.arguments, call.waitSeconds);
  if (observed.ok) call.answer(observed);
  else refuseCall(deps.transport, call.exchange, { status: 422, code: observed.error.code, message: observed.error.message });
}

async function answerCollectionTool(deps: McpToolsDeps, call: McpCall): Promise<void> {
  call.answer(await runCollectionTool(deps, call.input.name, call.input.arguments, { wait: call.waitSeconds }));
}

const SPECIAL_TOOLS: ReadonlyMap<string, SpecialAnswer> = new Map<string, SpecialAnswer>([
  ["ae_check_request", answerCheck],
  ["ae_decision_model", answerDecisionModel],
  ["ae_get_capture_frame", answerCaptureLookup],
  ["ae_get_build_kit", answerBuildKit],
  ["ae_observe_frame", answerObservation],
]);

/** Answers the call when it is one of the sidecar's own tools; false leaves it to the tool catalogue. */
export async function answerSpecialTool(deps: McpToolsDeps, call: McpCall, snapshotFingerprint: string | null): Promise<boolean> {
  const answer = isCollectionTool(call.input.name) ? answerCollectionTool : SPECIAL_TOOLS.get(call.input.name);
  if (!answer) return false;
  await answer(deps, call, snapshotFingerprint);
  return true;
}

/** Answers `ae_prepare_parameter_change`, which an external client authors through the relational routing rather than the tool catalogue. */
export async function answerParameterTool(deps: McpToolsDeps, call: McpCall, snapshot: ProjectSnapshot | undefined): Promise<boolean> {
  if (call.input.name !== "ae_prepare_parameter_change") return false;
  const { state } = deps;
  const routed = { collection: state.collection, snapshot, panelInstanceId: state.activePanelInstanceId, now: state.now().getTime() };
  const result = await runExternalParameterTool(routed, call.input.arguments, deps.planView.toolContext(snapshot, "external"));
  if (result.ok) deps.transport.notifyChange();
  deps.runtime.prunePlans();
  call.answer(result);
  return true;
}
