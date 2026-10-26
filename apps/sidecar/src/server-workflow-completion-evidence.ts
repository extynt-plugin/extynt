// The frames the sidecar takes itself for a job: capture and observe, where to look for a still, for motion and for a review, and completion retried once the frames are in.
import { decode, fallback, isJsonArray, jsonObject, type JsonObject, object, optional, string, type JsonValue, wireJson } from "@extynt/decode";
import type { WorkflowId, WorkflowState } from "@extynt/workflow";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { ToolArguments, ToolPayload } from "./agent-types.js";
import { appliedOperations, lackingFrameKinds, ownCompletion, type OwnCompletion, type OwnCompletionDeps } from "./server-workflow-auto-complete.js";
import { recordSidecarAction } from "./server-workflow-sidecar-actions.js";

/** Runs one agent tool the way the model would, so a capture and its observation are recorded as the model's would be. */
export type RunTool = (name: string, args: ToolArguments) => Promise<{ ok: boolean; data?: ToolPayload }>;

/** Where to look: a composition and a time within it. */
export interface FrameTarget { readonly compositionId: string; readonly time: number }

type FrameKind = "visual" | "temporal";
type AppliedOperations = ReturnType<typeof appliedOperations>;
interface SpreadRange { readonly times: readonly number[]; readonly last: number; readonly count: number; readonly duration: number }

const FRAME_CLAIM_SECONDS = 3;
const FRAME_WAIT_SECONDS = 15;
const MAX_COMPLETION_FRAMES = 4;
const DISTINCT_SECONDS = 0.1;
const REVIEW_FRAMES_MIN = 2;
const REVIEW_FRAMES_MAX = 4;
const MAX_KEYFRAME_DEPTH = 4;
const FRAME_EDGE = 0.05;
const PLACEMENT_KEYS = ["inPoint", "outPoint", "startTime", "time"] as const;

const captured = object({ captureId: string() });
const statusOnly = object({ status: string() });
const composition = object({ target: optional(fallback(object({ compositionId: optional(fallback(string(), undefined)) }), undefined)), compositionId: optional(fallback(string(), undefined)) });

function isKeyed(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(time: JsonValue | undefined): time is number {
  return typeof time === "number" && Number.isFinite(time) && time >= 0;
}

function payloadJson(operation: { readonly payload: ActionPlanV2Operation }): JsonValue | undefined {
  const wire = decode(wireJson, operation.payload);
  return wire.ok ? wire.value : undefined;
}

function dataObject(data: ToolPayload | undefined): JsonObject | undefined {
  const decoded = decode(jsonObject, data);
  return decoded.ok ? decoded.value : undefined;
}

function roundMillis(time: number): number {
  return Math.round(time * 1000) / 1000;
}

function firstKeyframeTimes(record: JsonObject): number[] {
  const keys = record.keyframes;
  return isJsonArray(keys) ? keys.map((key) => (isKeyed(key) ? key.time : undefined)).filter(validTime) : [];
}

function createdIds(state: WorkflowState, jobId: WorkflowId): Map<string, string> {
  const bindings = (state.jobs[jobId]?.batchIds ?? []).flatMap((batchId) => state.batches[batchId]?.execution.receipt?.createdBindings ?? []);
  return new Map(bindings.map((binding) => [binding.placeholder, binding.createdId]));
}

/** The composition an operation names, in its target or at its top level, or undefined when it names none. */
export function namedComposition(payload: JsonValue | undefined): string | undefined {
  const decoded = decode(composition, payload);
  const id = decoded.ok ? decoded.value.target?.compositionId ?? decoded.value.compositionId : undefined;
  return id || undefined;
}

function latestObservedComposition(state: WorkflowState, jobId: WorkflowId): string | undefined {
  const rows = Object.values(state.observations).filter((row) => row.jobId === jobId && row.compositionId);
  return rows.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0]?.compositionId;
}

function jobComposition(state: WorkflowState, jobId: WorkflowId, operations: AppliedOperations, active: string | null): string | undefined {
  const observed = latestObservedComposition(state, jobId);
  if (observed) return observed;
  const created = createdIds(state, jobId);
  const named = operations.map((operation) => namedComposition(payloadJson(operation))).filter((id): id is string => id !== undefined).map((id) => created.get(id) ?? id).reverse().find((id) => !id.startsWith("__new__:"));
  return named ?? active ?? undefined;
}

function stillTime(keys: readonly number[], duration: number, clamp: (time: number) => number): number {
  return keys.at(-1) ?? clamp(duration / 2);
}

function motionCandidates(keys: readonly number[], duration: number, clamp: (time: number) => number): number[] {
  const first = keys[0] ?? 0, end = stillTime(keys, duration, clamp);
  const at = (share: number): number | undefined => keys[Math.floor((keys.length - 1) * share)];
  return [first, at(0.5), end, at(0.25), at(0.75), (first + end) / 2, duration / 4, (duration * 3) / 4].filter((time): time is number => time !== undefined).map(clamp);
}

function frameTimes(times: readonly number[], duration: number, kinds: readonly FrameKind[], observed: readonly number[] = []): number[] {
  const last = Math.max(0, duration - FRAME_EDGE);
  const clamp = (time: number): number => roundMillis(Math.min(Math.max(time, 0), last));
  const keys = [...new Set(times.map(clamp))].sort((left, right) => left - right);
  if (!kinds.includes("temporal")) return [stillTime(keys, duration, clamp)];
  const picked: number[] = [...observed];
  for (const time of motionCandidates(keys, duration, clamp)) if (picked.every((other) => Math.abs(other - time) >= DISTINCT_SECONDS)) picked.push(time);
  return picked.slice(observed.length, observed.length + MAX_COMPLETION_FRAMES);
}

function observedStillTimes(state: WorkflowState, query: { readonly jobId: WorkflowId; readonly compositionId: string; readonly fingerprint: string | undefined }): number[] {
  return Object.values(state.observations).filter((row) => row.jobId === query.jobId && row.kind === "visual" && row.compositionId === query.compositionId && row.observedFingerprint === query.fingerprint).flatMap((row) => (row.time === undefined ? [] : [row.time]));
}

function framePlan(deps: OwnCompletionDeps, jobId: WorkflowId, kinds: readonly FrameKind[]): FrameTarget[] {
  const state = deps.state.workflowCoordinator.workflowStore.getState(), latest = deps.planState.normalizedLatest();
  const operations = appliedOperations(state, jobId);
  const compositionId = jobComposition(state, jobId, operations, latest?.activeCompositionId ?? null);
  const found = latest?.compositions.find((candidate) => candidate.id === compositionId);
  if (!compositionId || !found) return [];
  const observed = kinds.includes("temporal") ? observedStillTimes(state, { jobId, compositionId, fingerprint: latest?.fingerprint }) : [];
  return frameTimes(operations.flatMap((operation) => keyframeTimes(payloadJson(operation))), found.duration, kinds, observed).map((time) => ({ compositionId, time }));
}

function placementTimes(payload: JsonValue | undefined): number[] {
  return isKeyed(payload) ? PLACEMENT_KEYS.map((key) => payload[key]).filter(validTime) : [];
}

function spreadFrameTimes({ times, last, count, duration }: SpreadRange): number[] {
  const first = times[0], final = times.at(-1);
  const spans = first !== undefined && final !== undefined && times.length >= 2 && final - first >= DISTINCT_SECONDS;
  const [from, to] = spans ? [first, final] : [0, duration];
  const picked: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = roundMillis(Math.min(last, from + ((to - from) * (index + 0.5)) / count));
    if (picked.every((other) => Math.abs(other - time) >= DISTINCT_SECONDS)) picked.push(time);
  }
  return picked;
}

async function observeCaptured(run: RunTool, captureId: string): Promise<JsonObject | undefined> {
  let observed = await run("ae_observe_frame", { captureId, waitSeconds: FRAME_CLAIM_SECONDS });
  const status = observed.ok ? decode(statusOnly, observed.data) : undefined;
  if (status?.ok && status.value.status === "capturing") observed = await run("ae_observe_frame", { captureId, waitSeconds: FRAME_WAIT_SECONDS });
  return observed.ok ? dataObject(observed.data) : undefined;
}

/** Captures one frame and observes it; the measured frame, or nothing when no panel captured it in time. A capture no panel has picked up within the claim window is not coming, so the wait gives up rather than parks the turn. */
export async function captureAndObserve(run: RunTool, target: FrameTarget): Promise<JsonObject | undefined> {
  const capture = await run("ae_capture_composition_frame", { compositionId: target.compositionId, time: target.time });
  const id = capture.ok ? decode(captured, capture.data) : undefined;
  if (!id?.ok) return undefined;
  const measured = await observeCaptured(run, id.value.captureId);
  return measured?.summary ? measured : undefined;
}

/** Every keyframe time an operation names, at any depth a keyframe list sits (a property's keys, an animator's or a control's). */
export function keyframeTimes(value: JsonValue | undefined, depth = 0): number[] {
  if (depth > MAX_KEYFRAME_DEPTH) return [];
  if (isJsonArray(value)) return value.flatMap((entry) => keyframeTimes(entry, depth + 1));
  if (!isKeyed(value)) return [];
  const nested = Object.entries(value).filter(([key]) => key !== "keyframes").flatMap(([, entry]) => keyframeTimes(entry, depth + 1));
  return [...firstKeyframeTimes(value), ...nested];
}

/** One frame of the built scene where everything the job keyframed has landed: the check design-first holds animation for, taken without the model. True when it was measured. */
export async function takeJobFrame(deps: OwnCompletionDeps, jobId: WorkflowId, run: RunTool): Promise<boolean> {
  const [target] = framePlan(deps, jobId, ["visual"]);
  return target !== undefined && await captureAndObserve(run, target) !== undefined;
}

async function gatherCompletionEvidence(deps: OwnCompletionDeps, jobId: WorkflowId, run: RunTool): Promise<boolean> {
  const kinds = lackingFrameKinds(deps, jobId);
  if (!kinds.length) return false;
  let took = false;
  for (const target of framePlan(deps, jobId, kinds)) {
    if (!lackingFrameKinds(deps, jobId).length) break;
    took = (await captureAndObserve(run, target)) !== undefined || took;
  }
  const { workflowSidecarActions, options } = deps.state;
  if (took && workflowSidecarActions && options) recordSidecarAction({ workflowSidecarActions, options }, jobId, "took the frame(s) ae_workflow_complete was missing before checking completion");
  return took;
}

async function completeWithFrames(deps: OwnCompletionDeps, jobId: WorkflowId, attempt: () => OwnCompletion, run: RunTool): Promise<OwnCompletion> {
  const first = attempt();
  if (first.ok || first.code !== "COMPLETION_EVIDENCE_MISSING") return first;
  return await gatherCompletionEvidence(deps, jobId, run) ? attempt() : first;
}

/** The model's ae_workflow_complete, retried once with the frames the sidecar takes itself: they are taken inside the one call instead of in a refusal, a capture, an observe and a second call. */
export async function toolCompletionWithFrames<T extends { ok: boolean; error?: { code: string } }>(deps: OwnCompletionDeps, jobSeed: string | undefined, attempt: () => T, run: RunTool): Promise<T> {
  const first = attempt();
  if (first.ok || first.error?.code !== "COMPLETION_EVIDENCE_MISSING" || !jobSeed) return first;
  return await gatherCompletionEvidence(deps, deps.state.workflowCoordinator.jobIdForSeed(jobSeed), run) ? attempt() : first;
}

/** The sidecar's own completion with the frames it can take: what the end of a finished turn tries before a new provider cycle would. */
export function ownCompletionWithFrames(deps: OwnCompletionDeps, jobId: WorkflowId, run: RunTool): Promise<OwnCompletion> {
  return completeWithFrames(deps, jobId, () => ownCompletion(deps, jobId), run);
}

/** Where a review looks: frames spread inside the time range the covered batches' operations name (keyframes, in and out points), at the middle of equal parts of it, between two and four of them. When those operations name fewer than two moments, the frames spread evenly across the composition instead. */
export function reviewFramePlan(deps: OwnCompletionDeps, jobId: WorkflowId, batchIds: readonly string[], coveredItems: number): FrameTarget[] {
  const state = deps.state.workflowCoordinator.workflowStore.getState(), latest = deps.planState.normalizedLatest();
  const covered = new Set(batchIds), operations = appliedOperations(state, jobId), mine = operations.filter((operation) => covered.has(operation.batchId));
  const compositionId = jobComposition(state, jobId, mine.length ? mine : operations, latest?.activeCompositionId ?? null);
  const found = latest?.compositions.find((candidate) => candidate.id === compositionId);
  if (!compositionId || !found || found.duration <= 0) return [];
  const last = Math.max(0, found.duration - FRAME_EDGE);
  const times = mine.flatMap((operation) => [...keyframeTimes(payloadJson(operation)), ...placementTimes(payloadJson(operation))]).filter((time) => time <= last).sort((left, right) => left - right);
  const count = Math.min(REVIEW_FRAMES_MAX, Math.max(REVIEW_FRAMES_MIN, coveredItems));
  return spreadFrameTimes({ times, last, count, duration: found.duration }).map((time) => ({ compositionId, time }));
}
