// Annotates effect controls with the range After Effects reports for them, so a value reads as a share of its valid range.
import { controlIsUserAssisted, controlPosition, menuLabel, type ControlSchema, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { EffectSnapshot, PropertySnapshot } from "@extynt/project-graph";

interface ReportedRange {
  minimum: number | null; maximum: number | null; units: string | null;
  position: number | null; ofDefault: number | null; reason: string | null;
  source: "after-effects-valid-range";
}
type RangedProperty = PropertySnapshot & { reportedRange?: ReportedRange; valueLabel?: string; userAssisted?: string };
const CONTROL_ASSISTED_NOTE = "User assisted: no value a script can write; tell the user to set this control by hand in After Effects.";

function controlsByMatchName(controls: readonly ControlSchema[]): Map<string, ControlSchema> {
  const found = new Map<string, ControlSchema | null>();
  for (const control of controls) {
    if (control.valueType === "group") continue;
    found.set(control.matchName, found.has(control.matchName) ? null : control);
  }
  return new Map([...found].filter((entry): entry is [string, ControlSchema] => entry[1] !== null));
}
function reportedRange(property: PropertySnapshot, control: ControlSchema): ReportedRange | undefined {
  const minimum = control.min ?? null, maximum = control.max ?? null, units = control.units ?? null;
  if (minimum === null && maximum === null && units === null) return undefined;
  const result = controlPosition({ valueType: property.valueType === control.valueType ? control.valueType : null, value: property.value, minimum, maximum, defaultValue: control.defaultValue, menu: control.menu !== undefined });
  return { minimum, maximum, units, position: result.position, ofDefault: result.ofDefault, reason: result.reason, source: "after-effects-valid-range" };
}
function controlNotes(property: PropertySnapshot, control: ControlSchema): Partial<RangedProperty> {
  const range = reportedRange(property, control), valueLabel = menuLabel(control.menu, property.value);
  return { ...(range ? { reportedRange: range } : {}), ...(valueLabel ? { valueLabel } : {}), ...(controlIsUserAssisted(control) ? { userAssisted: CONTROL_ASSISTED_NOTE } : {}) };
}
function annotateProperty(property: PropertySnapshot, controls: ReadonlyMap<string, ControlSchema>): RangedProperty {
  const control = property.kind === "property" ? controls.get(property.matchName) : undefined;
  const notes = control ? controlNotes(property, control) : {};
  return Object.keys(notes).length ? { ...property, ...notes } : property;
}
/** Effects with each directly listed control carrying the range and unit label this machine's catalogue probe recorded for it, when it recorded any. Nothing is inferred: no probe, no annotation. */
export function annotateEffectRanges(effects: EffectSnapshot[], profile: HostCapabilityProfile | undefined): EffectSnapshot[] {
  if (!profile) return effects;
  return effects.map((effect) => {
    const entry = profile.entries.find((candidate) => candidate.kind === "effect" && candidate.matchName === effect.matchName);
    const assisted = entry?.userAssisted ? { userAssisted: entry.userAssisted.note } : {};
    if (!entry?.controls?.length) return entry?.userAssisted ? { ...effect, ...assisted } : effect;
    const controls = controlsByMatchName(entry.controls);
    return { ...effect, ...assisted, properties: effect.properties.map((property) => annotateProperty(property, controls)) };
  });
}
