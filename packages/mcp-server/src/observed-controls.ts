/** Controls of an effect as already read from a layer in the current snapshot, for an effect whose control schema the host profile does not hold. */
import { extractEffects, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";

const OBSERVED_CONTROL_LIMIT = 40;

interface ObservedControl { path: string; matchName: string; displayName: string; valueType: PropertySnapshot["valueType"]; canSetValue: boolean; value: PropertySnapshot["value"]; source: "observed" }

function leaves(properties: readonly PropertySnapshot[], out: ObservedControl[]): void {
  for (const property of properties) {
    if (out.length >= OBSERVED_CONTROL_LIMIT) return;
    if (property.children?.length) leaves(property.children, out);
    else out.push({ path: property.path, matchName: property.matchName, displayName: property.displayName, valueType: property.valueType, canSetValue: property.canSetValue, value: property.value, source: "observed" });
  }
}

/** The first instance of the effect found in the snapshot, flattened to leaf controls; empty when no layer carries it. */
export function observedEffectControls(snapshot: ProjectSnapshot | undefined, matchName: string): ObservedControl[] {
  if (!snapshot) return [];
  for (const composition of snapshot.compositions) for (const layer of composition.layers) {
    const effect = extractEffects(layer).find((candidate) => candidate.matchName === matchName);
    if (!effect) continue;
    const out: ObservedControl[] = [];
    leaves(effect.properties, out);
    return out;
  }
  return [];
}
