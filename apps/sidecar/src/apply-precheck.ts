/**
 * The verdict on the read taken just before an approved plan runs. The panel posts that read with `?purpose=precheck&planId=`
 * and obeys the answer: the sidecar compares the project as read now with the one the plan was prepared against, and says
 * whether to go ahead. Nothing about the plan's identity is decided in the panel.
 */
import type { IncomingMessage } from "node:http";

import type { ActionPlan } from "@extynt/action-plan";
import { isLegacyFingerprint, type ProjectSnapshot } from "@extynt/project-graph";

type Admission = { ok: true } | { ok: false; code: string; text: string };

const PLAN_ID = /^[A-Za-z0-9._:-]{1,256}$/;

/** The plan a snapshot post is the precheck of, when its query says so. */
export function precheckPlanId(request: Pick<IncomingMessage, "url">): string | undefined {
  let query: URL;
  try { query = new URL(request.url ?? "", "http://sidecar.local"); } catch { return undefined; }
  const planId = query.searchParams.get("planId");
  return query.searchParams.get("purpose") === "precheck" && planId !== null && PLAN_ID.test(planId) ? planId : undefined;
}

const EARLIER_VERSION_TEXT = "This plan was made by an earlier version of extynt, which identified the project differently, so nothing was run. The panel has refreshed; propose the plan again against the current state.";

type PrecheckedPlan = Pick<ActionPlan, "snapshotFingerprint" | "selectionFingerprint"> & Partial<Pick<ActionPlan, "planId" | "schemaVersion" | "preconditions" | "operations">>;

/** What the sidecar knows about a job's own work: which job made a plan, and which plans moved the project from one read to another. */
export interface PrecheckJobs {
  jobIdForPlan(planId: string): string | undefined | null;
  lineageChain(from: string, to: string): string[] | null;
}

function demandsExactSelection(plan: PrecheckedPlan): boolean {
  return (plan.preconditions ?? []).some((condition) => typeof condition === "object" && condition.code === "EXACT_SELECTION");
}

function derivesOnly(plan: PrecheckedPlan): boolean {
  const operations = plan.operations ?? [];
  return operations.length > 0 && operations.every((operation) => operation.type === "derive_layer");
}

function bindsSelection(plan: PrecheckedPlan, jobs?: PrecheckJobs): boolean {
  if (plan.selectionFingerprint === undefined) return false;
  if (plan.planId !== undefined && jobs?.jobIdForPlan(plan.planId)) return demandsExactSelection(plan);
  if (plan.schemaVersion !== "0.2" || !derivesOnly(plan)) return true;
  return demandsExactSelection(plan);
}

function movedByOwnJob(plan: PrecheckedPlan, read: Pick<ProjectSnapshot, "fingerprint">, jobs?: PrecheckJobs): boolean {
  const jobId = plan.planId !== undefined ? jobs?.jobIdForPlan(plan.planId) : undefined;
  const chain = jobId && plan.snapshotFingerprint ? jobs?.lineageChain(plan.snapshotFingerprint, read.fingerprint) : null;
  return !!chain?.length && chain.every((id) => jobs?.jobIdForPlan(id) === jobId);
}

const PLAN_UNKNOWN: Admission = { ok: false, code: "PLAN_UNKNOWN", text: "The sidecar no longer holds this plan, so nothing was run. Propose the plan again." };

function staleSnapshot(plan: PrecheckedPlan, read: Pick<ProjectSnapshot, "fingerprint">, jobs?: PrecheckJobs): boolean {
  return !!plan.snapshotFingerprint && read.fingerprint !== plan.snapshotFingerprint && !movedByOwnJob(plan, read, jobs);
}

function refusalFor(plan: PrecheckedPlan, read: Pick<ProjectSnapshot, "fingerprint" | "selectionFingerprint">, jobs?: PrecheckJobs): Admission | undefined {
  if (isLegacyFingerprint(plan.snapshotFingerprint) || isLegacyFingerprint(plan.selectionFingerprint)) return { ok: false, code: "STALE_SNAPSHOT", text: EARLIER_VERSION_TEXT };
  if (staleSnapshot(plan, read, jobs)) return { ok: false, code: "STALE_SNAPSHOT", text: "The project changed between approval and apply, so nothing was run. The panel has refreshed; propose the plan again against the current state." };
  if (bindsSelection(plan, jobs) && read.selectionFingerprint !== plan.selectionFingerprint) return { ok: false, code: "SELECTION_CHANGED", text: "The open composition or the selected layers in After Effects changed after this plan was made, so nothing was run. The panel has read the current selection; ask again." };
  return undefined;
}

/** What a fresh read shows changed since the plan was made: the project, or only the selection. */
export function precheckAdmission(plan: PrecheckedPlan | undefined, read: Pick<ProjectSnapshot, "fingerprint" | "selectionFingerprint">, jobs?: PrecheckJobs): Admission {
  return plan ? refusalFor(plan, read, jobs) ?? { ok: true } : PLAN_UNKNOWN;
}
