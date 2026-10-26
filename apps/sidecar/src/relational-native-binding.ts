/**
 * Binds a native apply that carries a relational parameter change to its evidence before the bridge reserves it: the
 * approved read set, the pre-apply snapshot and the desired request must all name the same control, observation and panel.
 * SQL binds evidence; approval remains the authority.
 */
import { bindApproval, metadataReadSet, type MetadataReadSet } from "@extynt/action-plan";
import type { StoredPlan } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { CollectionService } from "./collection-service.js";
import type { DesiredParameterPlan } from "./graph-control-types.js";
import type { GraphRecord } from "./graph-record.js";
import type { Opaque } from "./snapshot-view.js";

/** The slice of the sidecar state the binding reads. */
export interface RelationalApplyState {
  collection: CollectionService;
  plans: Map<string, StoredPlan>;
  preApply?: { planId: string; snapshot: ProjectSnapshot } | undefined;
  inFlight?: { kind: string; id: string } | undefined;
}
function approvalMatches(approval: NonNullable<StoredPlan["approvalCapability"]>, record: StoredPlan, before: ProjectSnapshot, readSet: MetadataReadSet): boolean {
  if (approval.planId !== record.plan.planId || approval.snapshotFingerprint !== before.fingerprint) return false;
  if (approval.selectionFingerprint !== before.selectionFingerprint || approval.freshness.revision !== before.freshness.revision) return false;
  return approval.planDigest === readSet.planDigest && approval.readSetDigest === readSet.digest;
}
/** The read set the plan's approval was given for, when the approval still names this plan and the pre-apply snapshot. */
export function approvedParameterReadSet(record: StoredPlan, before: ProjectSnapshot): MetadataReadSet | undefined {
  const approval = record.approvalCapability, readSet = metadataReadSet(record.plan, before);
  if (!approval || !readSet || readSet.schemaVersion !== "blur-control-read-set/1") return undefined;
  return approvalMatches(approval, record, before, readSet) ? readSet : undefined;
}
interface NativeParameterAdmission { state: RelationalApplyState; owner: string; requestId: string; kind: Opaque; now: number }
interface TrackedApply { record: StoredPlan; marker: NonNullable<StoredPlan["relationalParameter"]>; before: ProjectSnapshot; request: GraphRecord }
function trackedApply(input: NativeParameterAdmission, record: StoredPlan, desired: DesiredParameterPlan): TrackedApply {
  const before = input.state.preApply;
  if (desired.state !== "present" || !record.relationalParameter || before?.planId !== record.plan.planId) throw Error("RELATIONAL_APPLY_BINDING_REFUSED");
  return { record, marker: record.relationalParameter, before: before.snapshot, request: desired.request };
}
function pendingApply(input: NativeParameterAdmission): TrackedApply | undefined {
  const flight = input.state.inFlight;
  if (input.kind !== "mutation" || flight?.kind !== "apply_plan") return undefined;
  const record = input.state.plans.get(flight.id);
  if (!record) return undefined;
  const desired = input.state.collection.desiredParameterPlan(flight.id);
  if (!record.relationalParameter && desired.state !== "present") return undefined;
  return trackedApply(input, record, desired);
}
function requireReadSet(tracked: TrackedApply, now: number): MetadataReadSet {
  const { record, before } = tracked, readSet = approvedParameterReadSet(record, before), capability = record.approvalCapability;
  if (!readSet || record.status !== "applying") throw Error("RELATIONAL_APPLY_BINDING_REFUSED");
  if (!capability) throw Error("RELATIONAL_APPLY_BINDING_REFUSED");
  const approval = bindApproval(record.plan, before, capability, new Date(now).toISOString());
  if (!("approvalId" in approval)) throw Error("RELATIONAL_APPLY_BINDING_REFUSED");
  return readSet;
}
function requireRequestEvidence(tracked: TrackedApply, owner: string, readSet: MetadataReadSet): void {
  const { request, marker, before } = tracked;
  if (request.controlInstanceId !== marker.controlInstanceId || request.sourceObservationId !== marker.sourceObservationId) throw Error("RELATIONAL_APPLY_BINDING_REFUSED");
  if (request.panelInstanceId !== owner || request.collectionSessionId !== before.coverage?.collectionSessionId) throw Error("RELATIONAL_APPLY_BINDING_REFUSED");
  if (request.desiredValue !== readSet.targets[0]?.desiredValue) throw Error("RELATIONAL_APPLY_BINDING_REFUSED");
}
/** Called before durable native reservation: throws RELATIONAL_APPLY_BINDING_REFUSED when the evidence does not bind. */
export function bindRelationalNativeApply(input: NativeParameterAdmission): void {
  const tracked = pendingApply(input);
  if (!tracked) return;
  const readSet = requireReadSet(tracked, input.now), marker = tracked.marker;
  requireRequestEvidence(tracked, input.owner, readSet);
  const bound = input.state.collection.bindDesiredApply({ planId: tracked.record.plan.planId, ticket: input.requestId, panelInstanceId: input.owner,
    readSetDigest: readSet.digest, stamp: readSet.stamp, sourceObservationId: marker.sourceObservationId, controlInstanceId: marker.controlInstanceId });
  if (bound.ok !== true) throw Error("RELATIONAL_APPLY_BINDING_REFUSED");
}
