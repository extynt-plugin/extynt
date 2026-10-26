// Live undo availability: on every revision event, each listed change is asked again whether Undo is still safe, using the stamp the event
// carries (the last read may be a moment behind), and the answers are published for the UI.
import type { ProjectSnapshot } from "@extynt/project-graph";
import { CHANGE_HISTORY_LIMIT, changeHistory } from "../server-change-history.js";
import type { ChangeUndo } from "../server-change-history.js";
import type { SidecarState } from "../server-state.js";
import { translatorOf } from "../ui-language.js";
import { readStampOf, type HostStamp } from "./facts.js";
import type { UiEvent } from "../ui-contract.js";
import type { HostEvents } from "./events.js";

interface UndoAvailability { planId: string; undo: ChangeUndo }

interface UndoAvailabilityDeps {
  state: Pick<SidecarState, "plans" | "hostFacts" | "latest" | "liveStamp" | "now" | "options">;
  current(): ProjectSnapshot | undefined;
}

function undoAvailability(deps: UndoAvailabilityDeps, live: HostStamp | null): UndoAvailability[] {
  const snapshot = deps.current(), facts = deps.state.hostFacts;
  const history = changeHistory({
    plans: deps.state.plans, project: snapshot ? snapshot.project : null, currentFingerprint: snapshot ? snapshot.fingerprint : null, limit: CHANGE_HISTORY_LIMIT,
    facts: { sources: facts.planSources, seenAt: facts.changesSeenAt, afterStamps: facts.afterStamps, live, readAt: readStampOf(deps.state.latest), translate: translatorOf(deps.state) },
  });
  return history.changes.map((change) => ({ planId: change.planId, undo: change.undo }));
}

function publishAvailability(deps: UndoAvailabilityDeps & { publish: (event: UiEvent) => void }, live: HostStamp): void {
  for (const change of undoAvailability(deps, live)) {
    const undo = change.undo.available ? { available: true, reason: null } : { available: false, reason: change.undo.reason, code: change.undo.code };
    deps.publish({ type: "undo", planId: change.planId, undo });
  }
}

/**
 * Recomputes undo availability on revision events, from the stamp the event carries, and again when a read of the project finishes: the revision
 * moved before the read that shows what the project is now, and Undo comes back (or stays gone) only once that read has landed.
 */
export function wireUndoAvailability(sources: Pick<HostEvents, "onChange"> & { onRead(listener: () => void): void }, deps: UndoAvailabilityDeps & { publish: (event: UiEvent) => void }): void {
  sources.onChange((watch, reasons) => {
    if (!reasons.includes("revision") || watch.revision === null) return;
    publishAvailability(deps, { epoch: watch.epoch, revision: watch.revision });
  });
  sources.onRead(() => {
    const live = deps.state.liveStamp;
    if (live) publishAvailability(deps, { epoch: live.epoch, revision: live.revision });
  });
}
