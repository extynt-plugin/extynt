// Records which operations an apply verified or contradicted on this host, so later plans can lean on the evidence.
import { array, decode, fallback, type Infer, object, string } from "@extynt/decode";
import { isVerifiedOutcome, PROPOSAL_OPERATION_LIMIT, type RuntimeOperationEvidence } from "@extynt/mcp-server";

import { profileDirectory, saveRuntimeEvidence } from "./profile-store.js";
import type { JsonValue } from "@extynt/decode";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";

/** Writes the host's runtime evidence. */
export interface RuntimeEvidenceCapability {
  recordRuntimeEvidence(outcomes: JsonValue | undefined, verification: JsonValue | undefined): void;
}

type RuntimeEvidenceDeps = {
  readonly state: Pick<SidecarState, "now" | "options" | "runtimeEvidence">;
  readonly planState: Pick<PlanStateCapability, "hostKey" | "hostLabel">;
};

type Verdict = "verified" | "mismatch" | "none";
type EvidenceRow = { operation: string | undefined; verdict: Verdict; basis: string | undefined };

const OPERATION_NAME = /^[a-z_]{1,64}$/;
const BASIS_CHARS = 96;

const outcomeRow = object({ type: fallback(string(), undefined), outcome: fallback(string(), undefined), basis: fallback(string(), undefined) });
const stepRow = object({ operation: fallback(string(), undefined), verificationState: fallback(string(), undefined), basis: fallback(string(), undefined) });

function outcomeRows(outcomes: JsonValue | undefined): EvidenceRow[] {
  const decoded = decode(array(fallback(outcomeRow, undefined)), outcomes);
  const rows: Array<Infer<typeof outcomeRow>> = decoded.ok ? decoded.value.filter((row) => row !== undefined) : [];
  return rows.slice(0, PROPOSAL_OPERATION_LIMIT).map((row) => ({
    operation: row.type,
    verdict: isVerifiedOutcome(row.outcome) ? "verified" : row.outcome === "readback_mismatch" ? "mismatch" : "none",
    basis: row.basis,
  }));
}

function stepRows(verification: JsonValue | undefined): EvidenceRow[] {
  const decoded = decode(object({ steps: fallback(array(fallback(stepRow, undefined)), undefined) }), verification);
  const steps = decoded.ok ? (decoded.value.steps ?? []).filter((step) => step !== undefined) : [];
  return steps.slice(0, PROPOSAL_OPERATION_LIMIT).map((step) => ({
    operation: step.operation,
    verdict: step.verificationState === "exact" ? "verified" : step.verificationState === "failed" ? "mismatch" : "none",
    basis: step.basis,
  }));
}

function evidenceRows(outcomes: JsonValue | undefined, verification: JsonValue | undefined): EvidenceRow[] {
  const fromOutcomes = outcomeRows(outcomes);
  return fromOutcomes.length ? fromOutcomes : stepRows(verification);
}

function failedEvidence(previous: RuntimeOperationEvidence | undefined, row: EvidenceRow, stamp: { at: string; hostVersion: string }): RuntimeOperationEvidence {
  const basis = row.basis === undefined ? "read-back-mismatch" : row.basis.slice(0, BASIS_CHARS);
  return { count: previous?.count ?? 0, lastVerifiedAt: previous?.lastVerifiedAt ?? "", hostVersion: stamp.hostVersion, lastFailedAt: stamp.at, failures: (previous?.failures ?? 0) + 1, lastFailureBasis: basis };
}

function updatedEvidence(previous: RuntimeOperationEvidence | undefined, row: EvidenceRow, stamp: { at: string; hostVersion: string }): RuntimeOperationEvidence {
  if (row.verdict === "mismatch") return failedEvidence(previous, row, stamp);
  return { ...previous, count: (previous?.count ?? 0) + 1, lastVerifiedAt: stamp.at, hostVersion: stamp.hostVersion };
}

function recordedOperation(row: EvidenceRow): string | undefined {
  return row.operation !== undefined && OPERATION_NAME.test(row.operation) && row.verdict !== "none" ? row.operation : undefined;
}

function recordRows(deps: RuntimeEvidenceDeps, key: string, rows: readonly EvidenceRow[]): boolean {
  const { state } = deps;
  const host = state.runtimeEvidence.hosts[key] ??= {};
  const at = state.now().toISOString();
  let changed = false;
  for (const row of rows) {
    const operation = recordedOperation(row);
    if (operation === undefined) continue;
    const previous = host[operation];
    host[operation] = updatedEvidence(previous, row, { at, hostVersion: previous?.hostVersion ?? deps.planState.hostLabel() ?? key });
    changed = true;
  }
  return changed;
}

/** Builds the runtime-evidence writer over the sidecar state. */
export function createRuntimeEvidence(deps: RuntimeEvidenceDeps): RuntimeEvidenceCapability {
  return {
    recordRuntimeEvidence(outcomes, verification) {
      const key = deps.planState.hostKey();
      const rows = key ? evidenceRows(outcomes, verification) : [];
      if (!key || !rows.length) return;
      if (recordRows(deps, key, rows)) saveRuntimeEvidence(deps.state.runtimeEvidence, deps.state.options.stateDirectory ?? profileDirectory());
    },
  };
}
