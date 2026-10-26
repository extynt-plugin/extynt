// Checks of a value against a probed effect control, and the effects ensure_effect refuses.
import type { JsonValue } from "@extynt/decode";

import type { ControlSchema, HostCapabilityProfile } from "./catalogue-model.js";
import { menuChoices } from "./menu-labels.js";

const COLOR_MIN_CHANNELS = 3;
const COLOR_MAX_CHANNELS = 4;

function colorError(control: ControlSchema, value: readonly JsonValue[]): string | null {
  const wrongLength = value.length < COLOR_MIN_CHANNELS || value.length > COLOR_MAX_CHANNELS;
  const wrongChannel = value.some((channel) => typeof channel !== "number" || channel < 0 || channel > 1);
  return wrongLength || wrongChannel ? `${control.displayName} is a color: use [r, g, b] or [r, g, b, a] with 0-1 channels.` : null;
}

function arrayError(control: ControlSchema, value: readonly JsonValue[]): string | null {
  if (control.valueType === "color") return colorError(control, value);
  if (control.valueType === "vector" && control.dimensions && value.length !== control.dimensions) return `${control.displayName} takes ${control.dimensions} numbers (got ${value.length}).`;
  if (control.valueType === "number" || control.valueType === "enum") return `${control.displayName} takes one number, not an array.`;
  return null;
}

function booleanError(control: ControlSchema): string | null {
  if (control.valueType === "number" && control.min === 0 && control.max === 1) return null;
  if (control.valueType !== "number" && control.valueType !== "enum") return null;
  return `${control.displayName} takes a number${control.menu ? " (menu item)" : ""}, not a boolean.`;
}

function vectorNumberError(control: ControlSchema): string | null {
  if ((control.valueType !== "vector" && control.valueType !== "color") || !control.dimensions) return null;
  return `${control.displayName} takes an array of ${control.valueType === "color" ? "3-4 channels" : `${control.dimensions} numbers`}.`;
}

function menuError(control: ControlSchema, value: number): string | null {
  if (!control.menu || (Number.isInteger(value) && value >= 1 && value <= control.menu.length)) return null;
  return `${control.displayName} is a menu: use 1-${control.menu.length}: ${menuChoices(control.menu, control.defaultValue)}.`;
}

function rangeError(control: ControlSchema, value: number): string | null {
  const belowMin = typeof control.min === "number" && value < control.min;
  const aboveMax = typeof control.max === "number" && value > control.max;
  return belowMin || aboveMax ? `${control.displayName} accepts ${control.min ?? "-inf"}-${control.max ?? "inf"} (got ${value}).` : null;
}

function numberError(control: ControlSchema, value: number): string | null {
  return vectorNumberError(control) ?? menuError(control, value) ?? rangeError(control, value);
}

/** Why a value is out of range or the wrong kind for a probed effect control, as a message; null when it fits or the control is not probed. Takes the value as the caller holds it; a value that is not JSON is simply not one of the checked kinds. */
export function effectControlValueError(profile: HostCapabilityProfile | undefined, effectMatchName: string, controlMatchName: string, value: JsonValue): string | null {
  const entry = profile?.entries.find((candidate) => candidate.matchName === effectMatchName && candidate.kind === "effect");
  const control = entry?.controls?.find((candidate) => candidate.matchName === controlMatchName);
  if (!control) return null;
  if (Array.isArray(value)) return arrayError(control, value);
  if (typeof value === "boolean") return booleanError(control);
  return typeof value === "number" ? numberError(control, value) : null;
}

/**
 * Effects ensure_effect refuses, from live evidence: extynt cannot confirm them, or they need host setup a script cannot
 * provide. Effects that merely open a dialog are user assisted instead. Dropdown Control (live After Effects 26.2.1) is
 * added under a per-instance Pseudo/@@ matchName, so ensure_effect could only report failure after the effect was added.
 */
export const EFFECT_HOST_CAVEATS: Readonly<Record<string, { code: string; message: string }>> = {
  "ADBE Dropdown Control": { code: "EFFECT_INSTANCE_UNIDENTIFIABLE", message: "Dropdown Control is added under a per-instance Pseudo/@@ name that cannot be matched afterwards, so extynt cannot confirm it and would leave the effect added on a reported failure. Add it by hand in After Effects." },
  "CINEMA 4D Effect": { code: "EFFECT_NEEDS_HOST_SETUP", message: "The Cinema 4D effect only works on a layer made from .c4d footage with its composition open in the viewer, and exposes no controls when added by script; set it up by hand." },
};
