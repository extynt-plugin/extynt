// The live focus: what After Effects shows right now, and the sidecar's check of its own read against it before the agent acts. A read that differs is re-requested and waited for, bounded; on a timeout the agent proceeds with a note.
import { type JsonObject } from "@extynt/decode";
import type { ReceiverOutcome } from "./receiver-types.js";
import { focusAgeMs, focusDifference, FOCUS_FRESH_MS, type FocusDifference } from "./live-focus.js";
import type { LiveFocusReport } from "./live-focus-report.js";
import { FocusGate, type FocusDeps, type FocusOutcome } from "./server-focus-gate.js";
import { acceptLiveFocus } from "./server-focus-intake.js";
import { FocusTools } from "./server-focus-tools.js";

export { queueSnapshotRefresh } from "./read-queue.js";
export type { FocusDeps, FocusOutcome } from "./server-focus-gate.js";

type FocusHealth =
  | { readonly present: false }
  | {
    readonly present: true;
    readonly ageMs: number;
    readonly receivedAgeMs: number;
    readonly fresh: boolean;
    readonly projectName: string;
    readonly snapshotProject: string | null;
    readonly activeCompositionId: string | null;
    readonly selectedCount: number;
    readonly matchesSnapshot: boolean | null;
    readonly difference: FocusDifference | null;
  };

/** The live focus as the rest of the sidecar uses it. */
export interface FocusCapability {
  ensureFocusCurrent(wait?: number, signal?: AbortSignal): Promise<FocusOutcome>;
  beforeTool(name: string, agent?: boolean, args?: JsonObject): Promise<string | undefined>;
  beforeTurn(turn: { signal?: AbortSignal; workflowCycle?: number }): Promise<string | undefined>;
  focusHealth(): FocusHealth;
  acceptFocus(report: LiveFocusReport): ReceiverOutcome;
}

function healthOf(deps: FocusDeps): FocusHealth {
  const { state } = deps;
  const focus = state.liveFocus;
  if (!focus) return { present: false };
  const now = state.now().getTime(), ageMs = focusAgeMs(focus, now), fresh = ageMs <= FOCUS_FRESH_MS, snapshot = deps.planState.normalizedLatest();
  const difference = fresh && snapshot ? focusDifference(focus, snapshot) : null;
  const comparable = fresh && snapshot !== undefined;
  return {
    present: true,
    ageMs,
    receivedAgeMs: Math.max(0, now - focus.receivedAt),
    fresh,
    projectName: focus.projectName,
    snapshotProject: snapshot?.project.name ?? null,
    activeCompositionId: focus.activeCompositionId,
    selectedCount: focus.selected.length,
    matchesSnapshot: comparable ? difference === null : null,
    difference,
  };
}

/** Builds the live focus from the session state, the latest normalised read and the transport. */
export function createFocus(deps: FocusDeps): FocusCapability {
  const gate = new FocusGate(deps), tools = new FocusTools(deps, gate);
  return {
    ensureFocusCurrent: (wait, signal) => gate.ensureFocusCurrent(wait, signal),
    beforeTool: (name, agent, args) => tools.beforeTool(name, agent, args),
    beforeTurn: (turn) => tools.beforeTurn(turn),
    focusHealth: () => healthOf(deps),
    acceptFocus: (report) => acceptLiveFocus(deps, report),
  };
}
