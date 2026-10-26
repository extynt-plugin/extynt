// The live focus laid over the last project read: the host's focus report says which composition is open and which layers are selected, and a project read says what the project holds.
import { selectionFingerprint, type CompositionSnapshot, type ProjectSnapshot } from "@extynt/project-graph";

import { chipLayers, focusFresh, sameFocusView, sameProject, type LiveFocus, type LiveFocusLayer } from "./live-focus.js";

interface FocusView {
  activeComposition: { id: string; name: string; width: number; height: number; layerCount: number } | null;
  selected: number;
  selectedKinds: string[];
  selectedLayers: LiveFocusLayer[];
  projectSaved: boolean;
}

/** What the context chip needs, straight from the focus report: it stays right before any project read has landed and while a scoped read holds other compositions. */
export interface FocusContext {
  projectName: string;
  projectSaved: boolean;
  compositionId: string | null;
  compositionName: string | null;
  selected: number;
  selectedLayers: LiveFocusLayer[];
  time: number | null;
  epoch: number | null;
  revision: number | null;
}

/** The context chip's view of a focus report. */
export function focusContextOf(focus: LiveFocus): FocusContext {
  return { projectName: focus.projectName, projectSaved: focus.projectPath !== null, compositionId: focus.activeCompositionId, compositionName: focus.activeCompositionName, selected: focus.selected.length, selectedLayers: chipLayers(focus), time: focus.time ?? null, epoch: focus.epoch, revision: focus.revision };
}

function overlayApplies(snapshot: ProjectSnapshot, focus: LiveFocus | null | undefined, now: number): focus is LiveFocus {
  if (!focus || snapshot.coverage || !focusFresh(focus, now) || !sameProject(focus, snapshot)) return false;
  return focus.activeCompositionId === null || snapshot.compositions.some((composition) => composition.id === focus.activeCompositionId);
}

function withSelection(composition: CompositionSnapshot, selected: ReadonlySet<string>): CompositionSnapshot {
  if (composition.layers.every((layer) => layer.isSelected === selected.has(layer.id))) return composition;
  return { ...composition, layers: composition.layers.map((layer) => layer.isSelected === selected.has(layer.id) ? layer : { ...layer, isSelected: selected.has(layer.id) }) };
}

/** The read with the open composition and selection of `focus`, when `focus` is a fresh report about the same project whose open composition the read holds (a scoped read is left alone). Its project fingerprint, revision and freshness are the read's own; only the layers whose flag differs are copied. */
export function overlayFocus(snapshot: ProjectSnapshot, focus: LiveFocus | null | undefined, now: number): ProjectSnapshot {
  if (!overlayApplies(snapshot, focus, now)) return snapshot;
  const active = focus.activeCompositionId, chosen = new Set(focus.selected);
  const compositions = snapshot.compositions.map((composition) => withSelection(composition, composition.id === active ? chosen : new Set<string>()));
  const next: ProjectSnapshot = { ...snapshot, compositions, activeCompositionId: active, selection: { compositionId: active, layerIds: [...focus.selected] } };
  return { ...next, selectionFingerprint: selectionFingerprint(next) };
}

/** The overlaid snapshot is rebuilt only when the read or the view changes; a pulse that repeats the same view reuses it. */
export function createFocusOverlay(): (snapshot: ProjectSnapshot, focus: LiveFocus | null | undefined, now: number) => ProjectSnapshot {
  let last: { base: ProjectSnapshot; focus: LiveFocus; value: ProjectSnapshot } | undefined;
  return (snapshot, focus, now) => {
    if (!overlayApplies(snapshot, focus, now)) return snapshot;
    if (last?.base === snapshot && sameFocusView(last.focus, focus)) return last.value;
    const value = overlayFocus(snapshot, focus, now);
    last = { base: snapshot, focus, value };
    return value;
  };
}

function selectedKinds(active: CompositionSnapshot | null, chosen: ReadonlySet<string>): string[] {
  const kinds = new Set<string>();
  for (const layer of active?.layers ?? []) if (chosen.has(layer.id)) kinds.add(String(layer.type || "layer"));
  return [...kinds].sort();
}

function activeCompositionView(active: CompositionSnapshot | null): FocusView["activeComposition"] {
  return active ? { id: active.id, name: active.name, width: active.width, height: active.height, layerCount: active.layers.length } : null;
}

/** The panel's rendering of the overlaid snapshot, with the fingerprint suggestions are keyed by; null when the overlay does not apply. */
export function focusAnswer(snapshot: ProjectSnapshot | undefined, focus: LiveFocus, now: number): { selectionFingerprint: string; view: FocusView } | null {
  if (!snapshot || !overlayApplies(snapshot, focus, now)) return null;
  const active = snapshot.compositions.find((composition) => composition.id === snapshot.activeCompositionId) ?? null;
  const view: FocusView = {
    activeComposition: activeCompositionView(active),
    selected: snapshot.selection.layerIds.length,
    selectedKinds: selectedKinds(active, new Set(snapshot.selection.layerIds)),
    selectedLayers: chipLayers(focus),
    projectSaved: snapshot.project.filePath !== null,
  };
  return { selectionFingerprint: snapshot.selectionFingerprint, view };
}
