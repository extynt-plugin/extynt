// What a demanded native read leaves behind for the agent: the observed page with its evidence, coverage and freshness.
import { presentFields } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { liveCurrent } from "./graph-freshness.js";
import type { CollectionJob, CollectionPage } from "./collection-job.js";

/** A demand's outcome: `observedAt` and `invalidated` drive freshness; the rest passes to the agent as reported. */
export interface DemandResult { fields: JsonObject; observedAt: number | undefined; invalidated: boolean; page: CollectionPage | undefined }

function demandFreshness(result: DemandResult, created: number, now: () => number, liveAt: number | undefined): string {
  const observedAt = result.observedAt ?? created, revisionKnown = result.page !== undefined && result.page.stamp.revision !== null;
  if (result.invalidated) return "stale";
  if (!revisionKnown) return "unknown";
  return liveCurrent(now() - observedAt, liveAt, now()) ? "observed" : "stale";
}

/** The result as the agent reads it, with its age and freshness computed now. */
export function observedDemandResult(result: DemandResult, created: number, now: () => number, liveAt: number | undefined): JsonObject {
  const age = Math.max(0, now() - (result.observedAt ?? created));
  return { ...result.fields, ...(result.invalidated ? { invalidated: true } : {}), ageMs: age, freshness: demandFreshness(result, created, now, liveAt) };
}

/** The result of a demand whose native page was accepted. */
export function collectionDemandObservation(input: { page: CollectionPage; job: CollectionJob; storage: JsonValue | undefined; observedAt: number }): DemandResult {
  const { page, job, storage, observedAt } = input;
  const fields = presentFields({
    state: "observed", observedAt,
    evidence: page.stamp.revision === null ? "observational-revision-unavailable" : "native-revision-bound-page",
    writeAuthorizing: false, page: page.raw, storage,
    coverage: { scope: presentFields({ ...job.target }), properties: job.target.kind === "values" ? "demanded-numeric-only" : "unknown", dependencyClosure: "unknown", absentOutsidePage: "unknown" },
    continuation: page.nextCursor === null ? null : { jobId: job.id },
    suggestedNext: page.nextCursor === null ? "Choose a returned stable target; demand only fields required by the intended operation." : "Continue with the returned jobId; the sidecar owns cursor and stamp reconciliation.",
  });
  return { fields, observedAt, invalidated: false, page };
}

/** The result of a demand that ended without a page, with the error code that ended it. */
export function failedDemand(code: string): DemandResult {
  return { fields: { state: "unknown", error: { code } }, observedAt: undefined, invalidated: false, page: undefined };
}
