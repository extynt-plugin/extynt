/**
 * The sidecar's list of changes to the open project (GET /v1/changes), held for the status bar ("Ready · 24 changes",
 * "Done · 2 partly applied") and the sheet's Changes. It reads when the sheet is shown and when the sidecar says something
 * changed; nothing polls. Undo state for each change is published to the shared state so every view agrees.
 */
import { changeRows, changesDecoder, type ChangeRow, type ChangesAnswer } from "./panel-changes.js";
import { sameJson } from "./same-json.js";
import { touchStatus } from "./panel-status-signal.js";
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import { dispatch } from "./ui-state.js";

let answer: ChangesAnswer | null = null;
let loading = false;
let again = false;

/** The last list of changes the sidecar gave, if any. */
export function changesAnswer(): ChangesAnswer | null {
  return answer;
}

/** What each change in the list shows now. */
export function changeRowsNow(): ChangeRow[] {
  return answer ? changeRows(answer, Date.now()) : [];
}

function take(next: ChangesAnswer): void {
  const previous = answer;
  answer = next;
  next.changes.forEach((change) => dispatch({ type: "undo", planId: change.planId, undo: { available: change.undo.available, reason: change.undo.reason || null, code: change.undo.code || null } }));
  if (previous === null || !sameJson(previous, next)) touchStatus();
}

/** Reads what the agent changed; a read already running is followed by one more. */
export function refreshChanges(): void {
  if (loading) {
    again = true;
    return;
  }
  loading = true;
  const path = "/v1/changes";
  send({ method: "GET", path, body: null, context: transportContext("GET", path, diagnosticId("changes")), decoder: changesDecoder }, (reply) => {
    loading = false;
    if (reply.ok) take(reply.value);
    if (again) {
      again = false;
      refreshChanges();
    }
  });
}
