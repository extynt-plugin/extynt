// User assisted effects and controls: ones the agent may use, but that need the user in After Effects to finish.
import type { ControlSchema, HostProfileEntry, UserAssisted, UserAssistedReason } from "./catalogue-model.js";

/** Adobe-bundled effects known to open a modal dialog when added (live evidence), by matchName to the name After Effects shows. */
export const DIALOG_EFFECTS: Readonly<Record<string, string>> = {
  "ADBE Apply Color LUT": "Apply Color LUT",
  "ADBE Apply Color LUT2": "Apply Color LUT",
  "ADBE Basic Text2": "Basic Text",
  "ADBE Numbers2": "Numbers",
  "ADBE Path Text": "Path Text",
  mochaAECC: "Mocha AE",
};

/** Adobe-bundled effects that analyse the footage after they are added: no script property reports when that finishes, and some results need a button only the user can press. */
export const ANALYSIS_EFFECTS: Readonly<Record<string, string>> = {
  "ADBE SubspaceStabilizer": "Warp Stabilizer",
  "ADBE 3D Tracker": "3D Camera Tracker",
};

const ANALYSIS_NOTE = "Adding it only starts the analysis, which runs in the background in After Effects; no script can read whether it has finished or what it found, so never report it as stabilized or tracked. Tell the user to wait for the analysis banner in the Effect Controls panel to clear and to check the result; for 3D Camera Tracker, Create Camera and Create Null are buttons only they can press.";
const CONSEQUENCE = "Tell the user in your reply, naming the effect, that After Effects will show a dialog they must finish; if they cancel, the step fails and the plan is undone. An applied plan means they finished it; what they chose stays inside the effect, and a readback cannot show it, so never report it as unset.";
const LEAD: Readonly<Record<UserAssistedReason, string>> = {
  "opens-dialog": "opens a dialog when it is added",
  "observed-interactive": "held After Effects on a window while this machine was scanned, so it shows a dialog when added",
  "may-ask-options": "may ask for options when it is added",
  "analyzes-in-background": "analyses the footage in the background after it is added",
};

const MAYBE = "If After Effects shows a dialog while it applies, the user must finish it; if they cancel, the step fails and the plan is undone. Mention this only as a possibility.";

const REASON_NOTE: Readonly<Record<UserAssistedReason, string>> = { "opens-dialog": CONSEQUENCE, "observed-interactive": CONSEQUENCE, "may-ask-options": MAYBE, "analyzes-in-background": ANALYSIS_NOTE };

/** The one sentence the agent reads for a user assisted effect. */
export function userAssistedNote(displayName: string, reason: UserAssistedReason): string {
  return `User assisted: ${displayName} ${LEAD[reason]}. ${REASON_NOTE[reason]}`;
}

/** Why an effect is user assisted, from what is known before any scan evidence: the curated dialog list, then the census flag. */
export function staticAssistReason(matchName: string | undefined, hasOptionsDialog: boolean | undefined): UserAssistedReason | undefined {
  if (matchName && DIALOG_EFFECTS[matchName] !== undefined) return "opens-dialog";
  if (matchName && ANALYSIS_EFFECTS[matchName] !== undefined) return "analyzes-in-background";
  return hasOptionsDialog === true ? "may-ask-options" : undefined;
}

/** The entry marked user assisted: the flag, plus the note as a requirement so every listing that shows requirements shows it. */
export function markUserAssisted(entry: HostProfileEntry, reason: UserAssistedReason): HostProfileEntry {
  if (entry.userAssisted) return entry;
  const userAssisted: UserAssisted = { reason, note: userAssistedNote(entry.displayName, reason) };
  return { ...entry, userAssisted, requirements: [...new Set([...(entry.requirements ?? []), userAssisted.note])] };
}

/** A user assisted effect as a plan sees it. */
export interface UserAssistedEffect {
  readonly displayName: string;
  readonly note: string;
  readonly reason: UserAssistedReason;
}

function curatedAssistedEffect(matchName: string, profileName: string | undefined): UserAssistedEffect | undefined {
  const reason = staticAssistReason(matchName, undefined);
  const known = DIALOG_EFFECTS[matchName] ?? ANALYSIS_EFFECTS[matchName];
  if (reason === undefined || known === undefined) return undefined;
  const displayName = profileName ?? known;
  return { displayName, note: userAssistedNote(displayName, reason), reason };
}

/** The name and note for a plan's effect when it is user assisted, from the host profile or the curated dialog list; undefined otherwise. */
export function userAssistedEffect(profile: { entries: readonly HostProfileEntry[] } | undefined, matchName: string): UserAssistedEffect | undefined {
  const entry = profile?.entries.find((candidate) => candidate.kind === "effect" && candidate.matchName === matchName);
  if (entry?.userAssisted) return { displayName: entry.displayName, note: entry.userAssisted.note, reason: entry.userAssisted.reason };
  return curatedAssistedEffect(matchName, entry?.displayName);
}

/** True for a control After Effects exposes with no settable value (custom UI, a button, an Options panel), so only the user can change it. */
export function controlIsUserAssisted(control: ControlSchema): boolean {
  return control.valueType === "custom" || control.valueType === "none";
}
