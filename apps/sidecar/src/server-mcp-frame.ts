// The measured frame an MCP approval carries, so an external client does not spend capture and observe calls guessing: the panel's own seal takes the same frame.
import { decode, fallback, type Infer, type JsonObject, jsonValue, number, object, string } from "@extynt/decode";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { planOperations, type StoredPlan } from "@extynt/mcp-server";

import { appliedCreatedBindings } from "./server-created-bindings.js";
import { captureAndObserve, keyframeTimes, type FrameTarget, type RunTool } from "./server-workflow-completion-evidence.js";
import { frameFindingSentence, standingFrameFindings } from "./server-workflow-frame-gate.js";
import { boundedFrameChecks } from "./verify/frame-check.js";

const FRAME_BLOCK_CHARS = 800;
const MAX_FRAMES = 2;
const MAX_FINDINGS = 3;
const DISTINCT_SECONDS = 0.1;
const LAST_FRAME_MARGIN_SECONDS = 0.05;
const APPLIED: ReadonlySet<StoredPlan["status"]> = new Set(["applied", "applied_unverified", "verified"]);

const operationView = object({
  target: fallback(object({ compositionId: fallback(string(), undefined) }), undefined),
  compositionId: fallback(string(), undefined),
  inPoint: fallback(number(), undefined),
  startTime: fallback(number(), undefined),
});

const observedSummary = object({
  summary: fallback(object({ contentFraction: fallback(jsonValue, undefined), contentBox: fallback(jsonValue, undefined), regionContent: fallback(jsonValue, undefined) }), undefined),
});

type OperationView = Infer<typeof operationView>;

interface FrameNote {
  readonly note: string;
}

interface FrameBlock {
  readonly composition: string;
  readonly times: readonly number[];
  readonly measured: readonly JsonObject[];
  readonly offFrame?: readonly string[];
  readonly note?: string;
}

/** True for the statuses that mean After Effects ran the plan, so there is something to picture. */
export function isAppliedStatus(status: StoredPlan["status"] | undefined): boolean {
  return status !== undefined && APPLIED.has(status);
}

function operationViews(record: StoredPlan): OperationView[] {
  return planOperations(record).flatMap((operation) => {
    const view = decode(operationView, operation);
    return view.ok ? [view.value] : [];
  });
}

function planComposition(record: StoredPlan, operations: readonly OperationView[], latest: ProjectSnapshot): string | undefined {
  const created = appliedCreatedBindings(record);
  const named = operations
    .map((operation) => operation.target?.compositionId ?? operation.compositionId)
    .filter((id): id is string => !!id)
    .map((id) => created[id] ?? id)
    .reverse()
    .find((id) => !id.startsWith("__new__:"));
  return named ?? latest.activeCompositionId ?? undefined;
}

function latestStart(operations: readonly OperationView[]): number {
  const starts = operations.flatMap((operation) => [operation.inPoint, operation.startTime]).filter((time): time is number => time !== undefined && time >= 0);
  return starts.length ? Math.max(...starts) : 0;
}

function clampTo(duration: number): (time: number) => number {
  const last = Math.max(0, duration - LAST_FRAME_MARGIN_SECONDS);
  return (time) => Math.round(Math.min(Math.max(time, 0), last) * 1000) / 1000;
}

function planFrameTargets(record: StoredPlan, latest: ProjectSnapshot): FrameTarget[] {
  const operations = operationViews(record);
  const compositionId = planComposition(record, operations, latest);
  const composition = latest.compositions.find((candidate) => candidate.id === compositionId);
  if (!compositionId || !composition) return [];
  const clamp = clampTo(composition.duration);
  const keys = [...new Set(keyframeTimes(planOperations(record)).map(clamp))].sort((left, right) => left - right);
  const settled = keys[keys.length - 1] ?? clamp(latestStart(operations));
  const median = keys.length > 1 ? keys[Math.floor((keys.length - 1) / 2)] : undefined;
  const times = median !== undefined && settled - median >= DISTINCT_SECONDS ? [median, settled] : [settled];
  return times.slice(0, MAX_FRAMES).map((time) => ({ compositionId, time }));
}

function measuredSummary(observed: JsonObject, time: number): JsonObject {
  const read = decode(observedSummary, observed);
  const summary = read.ok ? read.value.summary : undefined;
  const located = { contentFraction: summary?.contentFraction, contentBox: summary?.contentBox, regionContent: summary?.regionContent };
  const present = Object.entries(located).flatMap(([key, found]) => (found === undefined ? [] : [[key, found] as const]));
  return { time, ...Object.fromEntries(present) };
}

function withoutGrid(row: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "regionContent"));
}

function boundedFrame(block: FrameBlock): FrameBlock {
  if (JSON.stringify(block).length <= FRAME_BLOCK_CHARS) return block;
  const trimmed = { ...block, measured: block.measured.map(withoutGrid) };
  if (JSON.stringify(trimmed).length <= FRAME_BLOCK_CHARS) return trimmed;
  return { composition: block.composition, times: block.times, measured: trimmed.measured, note: "Frame block trimmed to fit; call ae_check_request for the off-frame findings." };
}

function offFrameSentences(record: StoredPlan, latest: ProjectSnapshot): string[] {
  const rows = boundedFrameChecks(record.receipt?.frameChecks) ?? [];
  return standingFrameFindings(latest, rows).slice(0, MAX_FINDINGS).map(frameFindingSentence);
}

async function captureFrames(run: RunTool, targets: readonly FrameTarget[]): Promise<JsonObject[]> {
  const measured: JsonObject[] = [];
  try {
    for (const target of targets) {
      const frame = await captureAndObserve(run, target);
      if (!frame) break;
      measured.push(measuredSummary(frame, target.time));
    }
  } catch {
    return measured;
  }
  return measured;
}

function rowTime(row: JsonObject): number {
  const time = row.time;
  return typeof time === "number" ? time : 0;
}

/**
 * The `frame` block for an applied plan's receipt: the times captured, the measured summary of each, and any off-frame finding. A capture that never lands (no panel, a capture failure) yields a note,
 * never an error, so the approval it rides on stands either way.
 */
export async function measureAppliedFrame(input: { record: StoredPlan; latest: ProjectSnapshot | undefined; run: RunTool }): Promise<FrameBlock | FrameNote> {
  const { record, latest, run } = input;
  if (!latest) return { note: "Not measured: no project snapshot to place a frame in. Capture with ae_capture_composition_frame." };
  const targets = planFrameTargets(record, latest);
  const first = targets[0];
  if (!first) return { note: "Not measured: the plan names no composition to picture. Capture with ae_capture_composition_frame." };
  const measured = await captureFrames(run, targets);
  if (!measured.length) return { note: "Not measured: no panel captured a frame in time (After Effects capture unavailable). Capture with ae_capture_composition_frame if you need to see it." };
  const offFrame = offFrameSentences(record, latest);
  return boundedFrame({ composition: first.compositionId, times: measured.map(rowTime), measured, ...(offFrame.length ? { offFrame } : {}) });
}

/** What the frame block says when the wait ended before the apply did. */
export const FRAME_SKIPPED_TIMEOUT: FrameNote = { note: "Not measured: the apply had not finished when the wait ended. Once ae_get_plan_status shows it applied, capture with ae_capture_composition_frame." };
