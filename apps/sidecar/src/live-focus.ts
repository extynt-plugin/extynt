// What After Effects shows right now (open project, composition, selected layers) and how it compares with the last project read; pure comparison and bounds, no state and no I/O.
import type { ProjectSnapshot } from "@extynt/project-graph";

/** The most selected layer ids a focus report lists; a longer selection arrives cut off. */
export const MAX_FOCUS_SELECTED = 256;
/** The most selected layers a focus report names. */
export const MAX_FOCUS_NAMED = 64;
/** A report older than this says nothing about what After Effects shows now (a hidden or busy panel stops reporting). */
export const FOCUS_FRESH_MS = 15_000;
const MAX_CHIP_NAMES = 8;
const MAX_CHIP_NAME_LENGTH = 128;
const UNSAVED_NAME = /^untitled( project)?$/i;

/** A selected layer as the context chip names it. */
export interface LiveFocusLayer {
  readonly id: string;
  readonly index: number;
  readonly name: string;
}

/** The view After Effects last reported, with when the sidecar received it. `time` is not part of the view: scrubbing is not a different focus. */
export interface LiveFocus {
  readonly projectPath: string | null;
  readonly projectName: string;
  readonly epoch: number | null;
  readonly revision: number | null;
  readonly activeCompositionId: string | null;
  readonly activeCompositionName: string | null;
  readonly selected: readonly string[];
  readonly selectedLayers: readonly LiveFocusLayer[];
  readonly receivedAt: number;
  readonly observedAt?: number;
  readonly items?: number;
  readonly time?: number;
}

/** How the last read differs from After Effects' view: another project, another composition, other selected layers. */
export type FocusDifference = "project" | "composition" | "selection";

type Aged = Pick<LiveFocus, "receivedAt" | "observedAt">;

/** How old the view is, from when After Effects reported it and never later than when it arrived, so a repeated old report ages while a clock ahead of ours cannot make it look newer. */
export function focusAgeMs(focus: Aged, now: number): number {
  const observed = focus.observedAt === undefined ? focus.receivedAt : Math.min(focus.observedAt, focus.receivedAt);
  return Math.max(0, now - observed);
}

/** False once the view is older than FOCUS_FRESH_MS: it then says nothing about what After Effects shows now. */
export function focusFresh(focus: Aged, now: number): boolean {
  return focusAgeMs(focus, now) <= FOCUS_FRESH_MS;
}

function sameUnsavedName(left: string, right: string): boolean {
  return left === right || (UNSAVED_NAME.test(left) && UNSAVED_NAME.test(right));
}

/** The same project: its file path, or its name while unsaved ("Untitled" in a focus report, "Untitled Project" in a read), and the collection epoch when both sides know one. */
export function sameProject(focus: Pick<LiveFocus, "projectPath" | "projectName" | "epoch">, snapshot: Pick<ProjectSnapshot, "project"> & { hostStamp?: ProjectSnapshot["hostStamp"] | undefined }): boolean {
  const path = snapshot.project.filePath;
  const sameIdentity = focus.projectPath !== null || path !== null ? focus.projectPath === path : sameUnsavedName(focus.projectName, snapshot.project.name);
  return sameIdentity && (focus.epoch === null || !snapshot.hostStamp || focus.epoch === snapshot.hostStamp.epoch);
}

function sameSelection(focus: LiveFocus, snapshot: Pick<ProjectSnapshot, "selection">): boolean {
  const read = new Set(snapshot.selection.layerIds);
  const contained = focus.selected.every((id) => read.has(id));
  return focus.selected.length >= MAX_FOCUS_SELECTED ? contained : contained && focus.selected.length === read.size;
}

/** Null when the read matches what After Effects shows. A scoped read is bound to what it was asked about, not to the view. The project revision is never compared: the agent's own edits move it. */
export function focusDifference(focus: LiveFocus, snapshot: Pick<ProjectSnapshot, "project" | "hostStamp" | "activeCompositionId" | "selection" | "coverage">): FocusDifference | null {
  if (!sameProject(focus, snapshot)) return "project";
  if (snapshot.coverage) return null;
  if (focus.activeCompositionId !== snapshot.activeCompositionId) return "composition";
  return sameSelection(focus, snapshot) ? null : "selection";
}

/** True when two reports show the same project, composition and layers, whatever the revision. */
export function sameFocusView(a: LiveFocus, b: LiveFocus): boolean {
  return sameFocusProject(a, b) && a.activeCompositionId === b.activeCompositionId && a.selected.length === b.selected.length && a.selected.every((id, index) => id === b.selected[index]);
}

/** True when two reports are about the same project. */
export function sameFocusProject(a: LiveFocus, b: LiveFocus): boolean {
  return a.projectPath === b.projectPath && a.projectName === b.projectName && a.epoch === b.epoch;
}

/** What the agent is told when the re-read did not land in time. */
export function focusNote(difference: FocusDifference, focus: LiveFocus, snapshot: Pick<ProjectSnapshot, "project">): string {
  if (difference === "project") return `Project changed: After Effects now has "${focus.projectName}" open, but the last read is of "${snapshot.project.name}". A new read was asked for and has not arrived, so what you were given may be about the old project. Call ae_refresh_snapshot before planning from it.`;
  return `Selection may be out of date: After Effects shows a different ${difference === "composition" ? "composition" : "selection"} than the last read, and the new read did not arrive in time. Call ae_refresh_snapshot before planning from it.`;
}

/** The briefing with the focus note at its end, or the briefing alone when there is no note. */
export function briefedWithFocus(briefing: string, note: string | undefined): string {
  return note ? `${briefing}\n\n${note}` : briefing;
}

/** The segments with the note as its own uncached segment, so the cached half stays byte-stable. */
export function segmentsWithFocus<T extends { text: string }>(segments: T[], note: string | undefined): Array<T | { text: string }> {
  return note ? [...segments, { text: note }] : segments;
}

/** The selected layers' names for the context chip: the first few, each cut short. */
export function chipLayers(focus: Pick<LiveFocus, "selectedLayers">): LiveFocusLayer[] {
  return focus.selectedLayers.slice(0, MAX_CHIP_NAMES).map((layer) => ({ id: layer.id, index: layer.index, name: layer.name.slice(0, MAX_CHIP_NAME_LENGTH) }));
}
