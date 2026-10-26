// Re-binds an action plan to a newer snapshot so a plan queued behind another can still be applied.
import { computePlanDigest, validateActionPlan, type ActionPlan } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { decodeOrThrow, isJsonArray, isJsonObject, jsonObject, type JsonObject, type JsonValue, wireJson } from "@extynt/decode";

function rewrittenField(key: string, child: JsonValue, snapshot: ProjectSnapshot): JsonValue {
  if (key === "snapshotFingerprint" && typeof child === "string") return snapshot.fingerprint;
  if (key === "selectionFingerprint" && typeof child === "string") return snapshot.selectionFingerprint;
  return key === "freshness" ? child : rewritten(child, snapshot);
}

function rewritten(value: JsonValue, snapshot: ProjectSnapshot): JsonValue {
  if (isJsonArray(value)) return value.map((entry) => rewritten(entry, snapshot));
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrittenField(key, child, snapshot)]));
}

/** The plan with the snapshot identity it is bound to replaced by the snapshot's; the digest is recomputed so the receipt stays honest. */
export function rebasePlan(plan: ActionPlan, snapshot: ProjectSnapshot): ActionPlan {
  const body = decodeOrThrow(jsonObject, rewritten(decodeOrThrow(wireJson, plan), snapshot));
  const bound: JsonObject = { ...body, freshness: decodeOrThrow(wireJson, snapshot.freshness) };
  const rebound = typeof bound.digest === "string" ? { ...bound, digest: computePlanDigest(bound) } : bound;
  const validated = validateActionPlan(rebound, snapshot);
  if (!validated.ok) throw new Error(`Cannot rebase invalid action plan: ${validated.message}`);
  return validated.plan;
}
