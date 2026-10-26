// The v0.2 plan envelope: the fields around the operations, their bounds and conditions, and the checks that bind a plan to a snapshot.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isFreshness, readBounds, validateCondition } from "./plan-shape.js";
import type { PlanBounds } from "./plan-types.js";
import { arrayAt, invalid, isBoundedString, isBoundedText, isNonEmptyString, rejectUnknown, type Refusal } from "./validation-primitives.js";

const ROOT_FIELDS = ["schemaVersion", "planId", "snapshotFingerprint", "selectionFingerprint", "freshness", "summary", "operations", "requiresApproval", "intent", "provenance", "expiresAt", "bounds", "preconditions", "conflicts", "postconditions", "digest", "planDigest"];

/** A v0.2 plan whose envelope fields all have the right shape; the operations inside it are still unchecked. */
export type PlanEnvelope = {
  readonly record: JsonObject;
  readonly operations: readonly JsonValue[];
  readonly bounds: PlanBounds;
  readonly conditions: readonly JsonValue[];
  readonly snapshotFingerprint: string;
  readonly selectionFingerprint: string;
  readonly revision: string;
  readonly digest: string;
};

/** The envelope of a v0.2 plan, or the refusal for an unknown root field or an envelope that is malformed or carries no digest. */
export function readEnvelope(record: JsonObject): PlanEnvelope | Refusal {
  const unknown = rejectUnknown(record, ROOT_FIELDS);
  if (unknown) return unknown;
  const envelope = envelopeOf(record);
  return envelope ?? invalid("INVALID_PLAN", "v0.2 plans require bounded operations, typed conditions, freshness, and a digest.");
}

function envelopeOf(record: JsonObject): PlanEnvelope | undefined {
  const operations = arrayAt(record, "operations");
  const fields = envelopeFields(record);
  const conditions = conditionLists(record);
  const digest = [record.digest, record.planDigest].find((candidate) => typeof candidate === "string");
  if (!fields || !operations?.length || !conditions || typeof digest !== "string") return undefined;
  return { record, operations, conditions, digest, ...fields };
}

function envelopeFields(record: JsonObject): Pick<PlanEnvelope, "bounds" | "snapshotFingerprint" | "selectionFingerprint" | "revision"> | undefined {
  const { planId, snapshotFingerprint, selectionFingerprint, freshness, summary, bounds, requiresApproval } = record;
  const identified = isBoundedText(planId, 256) && isNonEmptyString(snapshotFingerprint) && isNonEmptyString(selectionFingerprint) && isFreshness(freshness) && isBoundedString(summary, 512) && requiresApproval === true;
  const declared = readBounds(bounds);
  if (!identified || declared === undefined) return undefined;
  return { bounds: declared, snapshotFingerprint, selectionFingerprint, revision: freshness.revision };
}

function conditionLists(record: JsonObject): JsonValue[] | undefined {
  const preconditions = arrayAt(record, "preconditions"), conflicts = arrayAt(record, "conflicts"), postconditions = arrayAt(record, "postconditions");
  return preconditions && conflicts && postconditions ? [...preconditions, ...conflicts, ...postconditions] : undefined;
}

/** The refusal for a digest pair that disagrees, more operations than declared, a stale snapshot or an expired plan. */
export function headerError(envelope: PlanEnvelope, snapshot: ProjectSnapshot | undefined): Refusal | undefined {
  const { record, operations, bounds } = envelope;
  if (record.planDigest !== undefined && record.digest !== undefined && record.planDigest !== record.digest) return invalid("INVALID_DIGEST", "planDigest and digest must agree when both are supplied.");
  if (operations.length > bounds.maxOperations) return invalid("BOUNDS_EXCEEDED", "The plan contains more operations than its declared bound.");
  return snapshotError(envelope, snapshot) ?? (planExpired(record.expiresAt) ? invalid("APPROVAL_EXPIRED", "The action plan has expired and must be regenerated.") : undefined);
}

function snapshotError({ snapshotFingerprint, selectionFingerprint, revision }: PlanEnvelope, snapshot: ProjectSnapshot | undefined): Refusal | undefined {
  if (!snapshot) return undefined;
  if (snapshotFingerprint !== snapshot.fingerprint) return invalid("STALE_SNAPSHOT", "Plan graph fingerprint does not match the current snapshot.");
  if (selectionFingerprint !== snapshot.selectionFingerprint) return invalid("STALE_SELECTION", "Plan selection fingerprint does not match the current selection.");
  return revision === snapshot.freshness.revision ? undefined : invalid("STALE_SNAPSHOT", "Plan freshness revision does not match the current snapshot.");
}

function planExpired(expiresAt: JsonValue | undefined): boolean { return expiresAt !== undefined && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()); }

/** The first refusal among the plan's preconditions, conflicts and postconditions. */
export function conditionsError({ conditions }: PlanEnvelope): Refusal | undefined {
  for (const condition of conditions) {
    const refusal = validateCondition(condition);
    if (refusal) return refusal;
  }
  return undefined;
}
