// The host and focus views the UI receives, derived from live sidecar state; shared by bootstrap and the event stream.
import { focusAnswer } from "./focus-overlay.js";
import { interfaceLanguageOf } from "./ui-language.js";
import { nativeMutationQuarantine } from "./native-mutation-lease.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import type { SidecarState } from "./server-state.js";
import { MAX_FOCUS_KINDS, MAX_FOCUS_LAYER_NAMES, type UiFocus, type UiHostView, type UiQuarantine } from "./ui-contract.js";

type UiViewState = Pick<SidecarState, "activePanelInstanceId" | "awaitingFreshSnapshotAfterPair" | "collection" | "hostFacts" | "hostLink" | "inFlight" | "liveFocus" | "nativeBridge" | "now" | "options">;

const MAX_LAYER_NAME_CHARS = 120;

function liveApplyLease(state: UiViewState, bridge: UiQuarantine): boolean {
  const flight = state.inFlight;
  return bridge?.code === "NATIVE_BRIDGE_RESERVED" && bridge.accessKind === "mutation" && !!flight && flight.nativeSettlement !== "unknown"
    && (flight.kind === "apply_plan" || flight.kind === "undo_plan") && state.nativeBridge.activeLogicalMatches(flight.kind, flight.id);
}

function quarantineOf(state: UiViewState): UiQuarantine {
  const bridge = state.nativeBridge.accessQuarantine();
  return (bridge && !liveApplyLease(state, bridge) ? bridge : null) ?? nativeMutationQuarantine(state.inFlight) ?? state.collection.nativeAccessQuarantine();
}

export function hostViewOf(state: UiViewState): UiHostView {
  return { host: state.hostLink.status(), hostInstanceId: state.activePanelInstanceId ?? null, nativeAccessQuarantine: quarantineOf(state), awaitingSnapshot: state.awaitingFreshSnapshotAfterPair, interfaceLanguage: interfaceLanguageOf(state) };
}

/** Kinds and fingerprint come from the overlaid latest read; both are empty when the report does not apply to it. */
export function focusViewOf(deps: Pick<HttpRoutesDeps, "dispatch" | "state">): UiFocus | null {
  const state = deps.state, focus = state.liveFocus;
  if (!focus) return null;
  const answer = focusAnswer(deps.dispatch.normalizedLatest(), focus, state.now().getTime());
  return {
    project: focus.projectName,
    compositionId: focus.activeCompositionId,
    compositionName: focus.activeCompositionName,
    selected: focus.selected.length,
    layerNames: focus.selectedLayers.slice(0, MAX_FOCUS_LAYER_NAMES).map((layer) => layer.name.slice(0, MAX_LAYER_NAME_CHARS)),
    at: focus.receivedAt,
    kinds: answer ? answer.view.selectedKinds.slice(0, MAX_FOCUS_KINDS) : [],
    selectionFingerprint: answer?.selectionFingerprint ?? null,
  };
}
