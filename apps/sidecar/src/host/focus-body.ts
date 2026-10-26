// A plugin `change` event as the focus report `acceptFocus` takes (its format is parsed by live-focus.ts).
import type { WatchState } from "@extynt/host-native";
import { MAX_FOCUS_NAMED, MAX_FOCUS_SELECTED } from "../live-focus.js";

interface FocusReport {
  schemaVersion: "0.1";
  projectPath: string | null;
  projectName: string;
  epoch: number;
  revision: number | null;
  activeCompositionId: string | null;
  activeCompositionName: string | null;
  selected: string[];
  selectedLayers: Array<{ id: string; index: number; name: string }>;
  observedAt: number;
  items?: number;
  time?: number;
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** The report for `state`, observed at `observedAt`. Ids the report format cannot carry are dropped rather than refusing the whole report. */
export function focusBodyOf(state: WatchState, observedAt: number): FocusReport {
  const selected = state.selection.filter((id) => ID.test(id)).slice(0, MAX_FOCUS_SELECTED), chosen = new Set(selected);
  const selectedLayers = state.selectedLayers.filter((layer) => chosen.has(layer.id)).slice(0, MAX_FOCUS_NAMED);
  return {
    schemaVersion: "0.1", projectPath: state.projectPath, projectName: state.projectName, epoch: state.epoch, revision: state.revision,
    activeCompositionId: state.activeCompId !== null && ID.test(state.activeCompId) ? state.activeCompId : null, activeCompositionName: state.activeCompName,
    selected, selectedLayers: selectedLayers.map((layer) => ({ id: layer.id, index: layer.index, name: layer.name })), observedAt,
    ...(state.items === null ? {} : { items: state.items }), ...(state.time === null ? {} : { time: state.time }),
  };
}
