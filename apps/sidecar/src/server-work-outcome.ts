// Which work is the newest the sidecar holds, said in the queue's vocabulary.
import { newestWorkRecord, workOutcomeView } from "@extynt/mcp-server";

import { fromEarlierSession } from "./server-pipeline-view.js";
import type { JsonObject } from "@extynt/decode";
import type { SidecarState } from "./server-state.js";

/** The newest work this session applied, in the queue's vocabulary, so apply claims stay tied to execution evidence. */
export function latestWork(state: Pick<SidecarState, "hostFacts" | "plans">): JsonObject | null {
  const newest = newestWorkRecord(state.plans.values());
  if (!newest) return null;
  const outcome = workOutcomeView(newest);
  const note = "Applied on an earlier After Effects session; its state in After Effects now is unknown.";
  return fromEarlierSession(state, newest) ? { ...outcome, status: "earlier_session", planStatus: newest.status, note } : outcome;
}
