// The modal-risk decision: whether adding an effect will hold After Effects on a dialog, a background analysis or an options prompt the user must deal with.
import { choice } from "./spec.js";
import type { ChoiceSpec } from "./spec.js";

/** The effect asked about: its match name, the name its menu shows, and whether a scan saw it ask for options (null when no scan has). */
export type EffectUse = { readonly matchName: string; readonly displayName: string; readonly hasOptionsDialog: boolean | null };

/** The answers to what happens when an effect is added. */
export type ModalRisk = "opens-dialog" | "analyzes-in-background" | "may-ask-options" | "no-dialog";

const DIALOG_EFFECTS: ReadonlySet<string> = new Set(["ADBE Apply Color LUT", "ADBE Apply Color LUT2", "ADBE Basic Text2", "ADBE Numbers2", "ADBE Path Text", "mochaAECC"]);

const ANALYSIS_EFFECTS: ReadonlySet<string> = new Set(["ADBE SubspaceStabilizer", "ADBE 3D Tracker"]);

function riskOf(effect: EffectUse): ModalRisk {
  if (DIALOG_EFFECTS.has(effect.matchName)) return "opens-dialog";
  if (ANALYSIS_EFFECTS.has(effect.matchName)) return "analyzes-in-background";
  return effect.hasOptionsDialog === true ? "may-ask-options" : "no-dialog";
}

/** What adding the effect does that needs the user: a dialog they must finish, an analysis that runs on after the step, a possible options prompt, or nothing. */
export const MODAL_RISK: ChoiceSpec<EffectUse, ModalRisk> = choice<EffectUse, ModalRisk>({
  name: "modal-risk",
  instructions: [
    "An After Effects script adds the given effect to a layer. Decide what that does that needs the user at the screen.",
    "hasOptionsDialog is true when a scan of this computer saw the effect ask for options when added, false when it did not, null when unknown.",
  ].join(" "),
  labels: {
    "opens-dialog": "adding the effect opens a dialog the user must fill in or close, such as a text or file prompt",
    "analyzes-in-background": "adding the effect starts a long analysis of the footage that finishes later, such as stabilizing or tracking",
    "may-ask-options": "the scan saw the effect ask for options when added, so a dialog may appear",
    "no-dialog": "the effect is added with no dialog and no analysis",
  },
  deterministicOnly: true,
  deterministic: riskOf,
});
