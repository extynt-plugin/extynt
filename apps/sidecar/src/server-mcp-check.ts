// The ae_check_request tool: what a request still lacks at the current project, from the project itself and the work external clients applied this session.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { StoredPlan } from "@extynt/mcp-server";
import type { PlanSource } from "./host/facts.js";
import { missingFeatures, requestedFeatures } from "./request-coverage.js";
import { frameFindingSentence, standingFrameFindings } from "./server-workflow-frame-gate.js";
import { boundedFrameChecks, type FrameCheckRow } from "./verify/frame-check.js";

interface RequestCheck { complete: boolean; missing: string[]; offFrame: string[]; next: string }
type RequestCheckInput = { plans: ReadonlyMap<string, StoredPlan>; sources: ReadonlyMap<string, PlanSource>; latest: ProjectSnapshot; request: string; compositionId?: string };

const STANDING_STATUSES: ReadonlySet<StoredPlan["status"]> = new Set(["applied", "applied_unverified", "verified"]);
const FINDING_LIMIT = 6;

function appliedAgentPlans(plans: ReadonlyMap<string, StoredPlan>, sources: ReadonlyMap<string, PlanSource>): StoredPlan[] {
  return [...plans.values()].filter((record) => sources.get(record.plan.planId) === "agent" && STANDING_STATUSES.has(record.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function appliedOperationsOf(plans: readonly StoredPlan[]): Array<{ type: string; payload: StoredPlan["plan"]["operations"][number] }> {
  return plans.flatMap((record) => record.plan.operations.map((operation) => ({ type: operation.type, payload: operation })));
}

function nextStep(check: { missing: readonly string[]; offFrame: readonly string[]; coverageUnknown: boolean; applied: number; named: boolean }): { complete: boolean; next: string } {
  if (check.missing.length > 0) return { complete: false, next: `Add the missing features in one plan, then check again.${check.offFrame.length > 0 ? " Move the off-frame layers into the frame in that same plan." : ""}` };
  if (check.offFrame.length > 0) return { complete: false, next: "Move the off-frame layers into the frame with one plan (set Position), then check again." };
  if (check.coverageUnknown) return { complete: false, next: "This project read did not include layer properties, so the requested features cannot be confirmed here. Verify them with ae_inspect_layer, then give your final answer." };
  if (check.applied === 0 && !check.named) return { complete: false, next: "Nothing has been applied in this session and the request names no feature that is already present. Build it with a plan, then check again." };
  return { complete: true, next: "Everything requested is present and in frame; give your final answer." };
}

/** The operations of the plans an external client applied this session. */
export function heldOperations(plans: ReadonlyMap<string, StoredPlan>, sources: ReadonlyMap<string, PlanSource>): Array<{ type: string; payload: StoredPlan["plan"]["operations"][number] }> {
  return appliedOperationsOf(appliedAgentPlans(plans, sources));
}

/** What the request still lacks at the current project, from the project itself and the work external clients applied this session. Read only: it never counts against a job. */
export function checkRequest(input: RequestCheckInput): RequestCheck {
  const { latest, request } = input;
  const compositions = input.compositionId ? latest.compositions.filter((composition) => composition.id === input.compositionId) : latest.compositions;
  const scoped: ProjectSnapshot = { ...latest, compositions };
  const applied = appliedAgentPlans(input.plans, input.sources);
  const operations = appliedOperationsOf(applied);
  const rows: FrameCheckRow[] = applied.flatMap((record) => boundedFrameChecks(record.receipt?.frameChecks) ?? []);
  const findings = standingFrameFindings(scoped, rows);
  const missing = missingFeatures(request, scoped, operations);
  const offFrame = findings.slice(0, FINDING_LIMIT).map(frameFindingSentence);
  const step = nextStep({ missing, offFrame, coverageUnknown: latest.coverage?.properties === "unknown", applied: applied.length, named: requestedFeatures(request).length > 0 });
  return { complete: step.complete, missing, offFrame, next: step.next };
}

type CheckAnswer = { ok: true; fingerprint: string; data: RequestCheck } | { ok: false; code: string; message: string };

type CheckQuestion = { request: string | undefined; compositionId: string | undefined };

type HeldSession = { plans: ReadonlyMap<string, StoredPlan>; sources: ReadonlyMap<string, PlanSource>; latest: ProjectSnapshot | undefined };

const NO_SNAPSHOT: CheckAnswer = { ok: false, code: "NO_SNAPSHOT", message: "No project snapshot yet; call ae_refresh_snapshot first." };

function unanswerable(request: string, compositionId: string | undefined, latest: ProjectSnapshot | undefined): CheckAnswer | undefined {
  if (!request) return { ok: false, code: "INVALID_ARGUMENTS", message: "request is required: the user's request text." };
  if (!latest) return NO_SNAPSHOT;
  if (compositionId && !latest.compositions.some((composition) => composition.id === compositionId)) return { ok: false, code: "COMPOSITION_NOT_FOUND", message: `No composition ${compositionId} in the current project.` };
  return undefined;
}

/** The tool call itself: validates the question against the project last read and answers, or says why it cannot. */
export function answerCheckRequest(asked: CheckQuestion, held: HeldSession): CheckAnswer {
  const request = asked.request?.trim() ?? "";
  const compositionId = asked.compositionId || undefined;
  const { latest } = held;
  const refusal = unanswerable(request, compositionId, latest);
  if (refusal || !latest) return refusal ?? NO_SNAPSHOT;
  return { ok: true, fingerprint: latest.fingerprint, data: checkRequest({ plans: held.plans, sources: held.sources, latest, request, ...(compositionId ? { compositionId } : {}) }) };
}
