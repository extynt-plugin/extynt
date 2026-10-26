// Approval binding: the one-time server-issued capability and the binding that ties an approval to one plan and one snapshot.
// It performs no host calls; the capability is minted only for a plan that validates against the snapshot it names.
import { randomUUID } from "node:crypto";
import type { ProjectSnapshot, SnapshotFreshness } from "@extynt/project-graph";
import { metadataReadSet } from "./metadata-readset.js";
import { ACTION_PLAN_SCHEMA, type ActionPlan } from "./plan-types.js";
import { validateActionPlan } from "./plan-validation.js";
import { invalid, type Refusal } from "./validation-primitives.js";

/** The one-time capability the server issues for one plan and one snapshot. */
export interface ApprovalCapability { token: string; panelSessionId: string; planId: string; snapshotFingerprint: string; selectionFingerprint: string; freshness: SnapshotFreshness; issuedAt: string; expiresAt: string; oneTime: true; planDigest?: string; readSetDigest?: string }

/** The approval a capability becomes once it is checked against the plan and snapshot. */
export interface ApprovalBinding { planId: string; snapshotFingerprint: string; selectionFingerprint: string; freshness: SnapshotFreshness; approvedAt: string; approvalId: string; panelSessionId: string; oneTime: true; readSetDigest?: string }

const MAX_SESSION_ID_LENGTH = 256;
const MAX_TOKEN_LENGTH = 128;
const MAX_TTL_MS = 86_400_000;
const DEFAULT_TTL_MS = 120_000;

/** What a capability is issued for; `now` and `ttlMs` default to the present moment and two minutes. */
export interface ApprovalRequest { plan: ActionPlan; snapshot: ProjectSnapshot; panelSessionId: string; now?: string; ttlMs?: number }

function requestError(panelSessionId: string, ttlMs: number, issuedAt: number): Refusal | undefined {
  if (!panelSessionId || panelSessionId.length > MAX_SESSION_ID_LENGTH) return invalid("INVALID_APPROVAL", "A bounded panel session is required.");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) return invalid("INVALID_APPROVAL", "Approval lifetime is outside the allowed bound.");
  return Number.isFinite(issuedAt) ? undefined : invalid("INVALID_APPROVAL", "Approval issue time is invalid.");
}

/** Issues a capability for a valid plan, or the refusal that explains why the plan, session, lifetime or time is not acceptable. */
export function issueApproval(request: ApprovalRequest): ApprovalCapability | Refusal {
  const { plan, snapshot, panelSessionId, now = new Date().toISOString(), ttlMs = DEFAULT_TTL_MS } = request;
  const validation = validateActionPlan(plan, snapshot);
  if (!validation.ok) return validation;
  const issuedAt = Date.parse(now);
  const refusal = requestError(panelSessionId, ttlMs, issuedAt);
  if (refusal) return refusal;
  return { token: randomUUID(), panelSessionId, planId: plan.planId, snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint, freshness: snapshot.freshness, issuedAt: now, expiresAt: new Date(issuedAt + ttlMs).toISOString(), oneTime: true, ...digestBinding(plan), ...readSetBinding(plan, snapshot) };
}

/** Binds a capability to the plan and snapshot it was issued for, or refuses when either changed, the capability is malformed or it expired. */
export function bindApproval(plan: ActionPlan, snapshot: ProjectSnapshot, capability: ApprovalCapability, now = new Date().toISOString()): ApprovalBinding | Refusal {
  const validation = validateActionPlan(plan, snapshot);
  if (!validation.ok) return validation;
  const capabilityError = capabilityBindingError(plan, snapshot, capability);
  if (capabilityError) return capabilityError;
  if (approvalExpired(capability.expiresAt, now)) return invalid("APPROVAL_EXPIRED", "The one-time approval capability has expired.");
  return { planId: plan.planId, snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint, freshness: snapshot.freshness, approvedAt: now, approvalId: capability.token, panelSessionId: capability.panelSessionId, oneTime: true, ...(capability.readSetDigest ? { readSetDigest: capability.readSetDigest } : {}) };
}

function capabilityBindingError(plan: ActionPlan, snapshot: ProjectSnapshot, capability: ApprovalCapability): Refusal | undefined {
  if (plan.schemaVersion !== ACTION_PLAN_SCHEMA && (plan.operations.length !== 1 || !plan.operations[0])) return invalid("UNSUPPORTED_PLAN", "Approval accepts one allowlisted operation at a time for legacy plans.");
  if (!isApprovalCapability(capability)) return invalid("INVALID_APPROVAL", "A server-issued one-time approval capability is required.");
  if (!isBoundCapability(capability, plan, snapshot)) return invalid("APPROVAL_MISMATCH", "Approval is not bound to this plan and current snapshot.");
  return undefined;
}

function isApprovalCapability(capability: ApprovalCapability): boolean {
  return !!capability && typeof capability === "object" && capability.oneTime === true && typeof capability.token === "string" && capability.token.length > 0 && capability.token.length <= MAX_TOKEN_LENGTH && typeof capability.panelSessionId === "string";
}

function isBoundCapability(capability: ApprovalCapability, plan: ActionPlan, snapshot: ProjectSnapshot): boolean {
  const readSet = metadataReadSet(plan, snapshot);
  if (capability.readSetDigest !== readSet?.digest) return false;
  const freshness = capability.freshness;
  if (!freshness || typeof freshness !== "object") return false;
  if (!capabilitySnapshotMatches(capability, plan, snapshot, freshness)) return false;
  return capability.planDigest === undefined || capability.planDigest === planDigestOf(plan);
}

function planDigestOf(plan: ActionPlan): string | undefined { return plan.digest || plan.planDigest || undefined; }

function digestBinding(plan: ActionPlan): { planDigest?: string } {
  const planDigest = planDigestOf(plan);
  return planDigest ? { planDigest } : {};
}

function approvalExpired(expiresAt: string, now: string): boolean { return !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(now); }

function readSetBinding(plan: ActionPlan, snapshot: ProjectSnapshot): { readSetDigest?: string } {
  const readSet = metadataReadSet(plan, snapshot);
  return readSet ? { readSetDigest: readSet.digest } : {};
}

function capabilitySnapshotMatches(capability: ApprovalCapability, plan: ActionPlan, snapshot: ProjectSnapshot, freshness: SnapshotFreshness): boolean {
  return capability.planId === plan.planId && capability.snapshotFingerprint === snapshot.fingerprint && capability.selectionFingerprint === snapshot.selectionFingerprint && freshness.revision === snapshot.freshness.revision;
}
