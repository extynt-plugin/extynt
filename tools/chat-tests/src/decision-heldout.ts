// The bands a held-out suite is scored with: the sidecar's fitted bands from @extynt/decide, never refitted on the held-out cases.
import { fittedBands, type Bands } from "@extynt/decide";

const DECISION_OF_SUITE: Readonly<Record<string, string>> = { "property-choice": "property", "effect-pick": "effect", "control-resolution": "control", "font-description": "font" };

const DROPPED_SUFFIX = "-dropped";

export function shippedBands(name: string): Bands {
  const suite = name.endsWith(DROPPED_SUFFIX) ? name.slice(0, -DROPPED_SUFFIX.length) : name;
  return fittedBands(DECISION_OF_SUITE[suite] ?? suite) ?? { verify: 0, act: 0.7 };
}
