// Takes a decoded focus report in: stores it as the live focus, notes the revision it carries and answers the live view over it.
import { jsonOf } from "@extynt/mcp-server";
import { focusAnswer } from "./focus-overlay.js";
import { accepted } from "./receiver-outcome.js";
import type { ReceiverOutcome } from "./receiver-types.js";
import { tickReadScheduler } from "./read-scheduler.js";
import type { LiveStamp } from "./read-currency.js";
import type { FocusDeps } from "./server-focus-gate.js";
import { focusDifference, focusFresh, sameFocusProject, sameFocusView, type LiveFocus } from "./live-focus.js";
import { focusOf, type LiveFocusReport } from "./live-focus-report.js";

function observedAt(focus: LiveFocus): number {
  return focus.observedAt === undefined ? focus.receivedAt : Math.min(focus.observedAt, focus.receivedAt);
}

function keptItems(known: LiveStamp | null, epoch: number, revision: number): number | null {
  return known !== null && known.epoch === epoch && known.revision === revision ? known.items : null;
}

function noteStamp(deps: FocusDeps, focus: LiveFocus): void {
  const { state } = deps;
  if (focus.epoch === null || focus.revision === null) return;
  const at = observedAt(focus), known = state.liveStamp;
  if (known && known.at >= at) return;
  state.liveStamp = { epoch: focus.epoch, revision: focus.revision, items: focus.items ?? keptItems(known, focus.epoch, focus.revision), at };
}

function recordSwitch(deps: FocusDeps, previous: LiveFocus | null, focus: LiveFocus): void {
  const { state } = deps;
  const snapshot = deps.planState.normalizedLatest();
  const switched = (!previous || !sameFocusProject(previous, focus)) && snapshot && focusFresh(focus, state.now().getTime()) && focusDifference(focus, snapshot) === "project";
  if (switched) state.eventLog("focus.project-switched", { project: focus.projectName });
}

function store(deps: FocusDeps, focus: LiveFocus): void {
  const { state } = deps;
  const previous = state.liveFocus;
  state.liveFocus = focus;
  noteStamp(deps, focus);
  if (!previous || !sameFocusView(previous, focus)) state.eventLog("focus.changed", { composition: focus.activeCompositionId, selected: focus.selected.length });
  recordSwitch(deps, previous, focus);
  tickReadScheduler(state, "focus");
  deps.transport.notifyChange();
}

/** Stores the report and answers the live view over it, so selecting layers never needs a project read. A report already too old to mean anything (a repeated old body) is stored and shown, never compared or acted on. */
export function acceptLiveFocus(deps: FocusDeps, report: LiveFocusReport): ReceiverOutcome {
  const focus = focusOf(report, deps.state.now().getTime());
  store(deps, focus);
  const answer = focusAnswer(deps.planState.normalizedLatest(), focus, deps.state.now().getTime());
  return accepted(200, { ok: true, selectionFingerprint: answer?.selectionFingerprint ?? null, view: jsonOf(answer?.view ?? null) });
}
